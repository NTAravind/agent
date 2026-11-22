/**
 * Live end-to-end check for Agent Groups (Phase 11).
 *
 *   npx tsx --env-file=.env.local scripts/check-groups.ts
 *
 * Verifies the real API and database:
 *   1. group CRUD and whole-set membership replacement,
 *   2. lead/member invariants and rejection of an unknown member,
 *   3. group-thread creation and durable group-run entry,
 *   4. the ordinary chat route refuses a group thread (409 group_thread),
 *   5. a group run refuses agentId/model, a concurrent parent and a sleeping
 *      member,
 *   6. the parent timeline exposes a member child turn and the handoff marker
 *      is persisted as {from,to,task},
 *   7. the user's group/message rows are visible through the RLS client,
 *   8. unauthenticated requests are rejected,
 *   9. a group with a live run cannot be deleted.
 *
 * The run is queued, not executed: provider quotas are intentionally not a
 * prerequisite for this persistence/API check. The child turn is a
 * deterministic fixture written through the service role, so the timeline
 * assertions never depend on a model call. Every row is cancelled and then
 * removed, and the cleanup verifies that nothing is left behind.
 */
import { randomUUID } from "node:crypto";

import { createClient } from "@supabase/supabase-js";

import { supabaseAdmin } from "../lib/supabase/server";

const checks: Array<{ name: string; ok: boolean; detail?: string }> = [];
function check(name: string, ok: boolean, detail?: string) {
  checks.push({ name, ok, detail });
  console.log(`${ok ? "✔" : "✖"} ${name}${detail ? ` — ${detail}` : ""}`);
}

const baseUrl = (process.env.API_BASE_URL ?? "http://localhost:3000").replace(/\/$/, "");

async function request(
  path: string,
  init: RequestInit & { token?: string } = {},
): Promise<{ status: number; body: Record<string, unknown> }> {
  const { token, headers, ...rest } = init;
  const response = await fetch(`${baseUrl}${path}`, {
    ...rest,
    headers: {
      ...(rest.body ? { "Content-Type": "application/json" } : {}),
      ...(token ? { Authorization: `Bearer ${token}` } : {}),
      ...(headers ?? {}),
    },
  });
  const text = await response.text();
  let body: Record<string, unknown> = {};
  try {
    body = text ? (JSON.parse(text) as Record<string, unknown>) : {};
  } catch {
    body = { raw: text };
  }
  return { status: response.status, body };
}

/** Mints a short-lived access token for the check user. */
async function mintAccessToken(userId: string): Promise<string | null> {
  const supabaseUrl = process.env.SUPABASE_URL;
  const serviceKey = process.env.SUPABASE_SERVICE_ROLE_KEY;
  const anonKey = process.env.SUPABASE_ANON_KEY;
  if (!supabaseUrl || !serviceKey || !anonKey) return null;

  const usersResponse = await fetch(`${supabaseUrl}/auth/v1/admin/users`, {
    headers: { apikey: serviceKey, Authorization: `Bearer ${serviceKey}` },
  });
  if (!usersResponse.ok) return null;
  const usersBody = (await usersResponse.json()) as
    | Array<{ id: string; email?: string }>
    | { users?: Array<{ id: string; email?: string }> };
  const users = Array.isArray(usersBody) ? usersBody : (usersBody.users ?? []);
  const user = users.find((entry) => entry.id === userId);
  if (!user?.email) return null;

  const linkResponse = await fetch(`${supabaseUrl}/auth/v1/admin/generate_link`, {
    method: "POST",
    headers: {
      apikey: serviceKey,
      Authorization: `Bearer ${serviceKey}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({
      type: "magiclink",
      email: user.email,
      options: { createUser: false },
    }),
  });
  if (!linkResponse.ok) return null;
  const link = (await linkResponse.json()) as { email_otp?: string };
  if (!link.email_otp) return null;

  const verifyResponse = await fetch(`${supabaseUrl}/auth/v1/verify`, {
    method: "POST",
    headers: { apikey: anonKey, "Content-Type": "application/json" },
    body: JSON.stringify({ type: "magiclink", email: user.email, token: link.email_otp }),
  });
  if (!verifyResponse.ok) return null;
  const verified = (await verifyResponse.json()) as { access_token?: string };
  return verified.access_token ?? null;
}

async function main() {
  const userId = process.env.CHECK_USER_ID;
  if (!userId) throw new Error("CHECK_USER_ID is not set.");
  const token = await mintAccessToken(userId);
  if (!token) throw new Error("Could not mint an access token for the check user.");

  const admin = supabaseAdmin();
  const agentIds: string[] = [];
  let groupId: string | null = null;
  let threadId: string | null = null;
  let runId: string | null = null;
  let childRunId: string | null = null;

  try {
    const unauthenticated = await request("/api/groups");
    check("groups require authentication", unauthenticated.status === 401, `status=${unauthenticated.status}`);

    for (const suffix of ["Lead", "Researcher", "Reviewer"]) {
      const { data, error } = await admin
        .from("agents")
        .insert({
          user_id: userId,
          name: `Phase 11 Check ${suffix}`,
          avatar: { type: "emoji", value: "🧪", color: "#7F9DFF" },
        })
        .select("id")
        .single();
      if (error || !data) throw new Error(`Could not create the check agent: ${error?.message}`);
      agentIds.push(data.id as string);
    }
    const [leadId, researcherId, reviewerId] = agentIds as [string, string, string];

    const created = await request("/api/groups", {
      method: "POST",
      token,
      body: JSON.stringify({
        name: "Phase 11 Check Crew",
        description: "Temporary live-check group",
        leadAgentId: leadId,
        memberIds: [researcherId, reviewerId],
        mode: "handoff",
        maxHops: 5,
        tokenBudget: 12_000,
      }),
    });
    const createdGroup = created.body.group as
      | { id: string; leadAgentId: string; members: Array<{ agentId: string; role: string }> }
      | undefined;
    groupId = createdGroup?.id ?? null;
    check("group creation succeeds", created.status === 201 && Boolean(groupId), `status=${created.status}`);
    check(
      "the lead is included exactly once",
      createdGroup?.leadAgentId === leadId &&
        createdGroup?.members.filter((member) => member.role === "lead").length === 1,
    );

    const listed = await request("/api/groups", { token });
    const listedGroups = listed.body.groups as Array<{ id: string }> | undefined;
    check(
      "the new group appears in the list",
      listed.status === 200 && (listedGroups ?? []).some((group) => group.id === groupId),
    );

    const patched = await request(`/api/groups/${groupId}`, {
      method: "PATCH",
      token,
      body: JSON.stringify({ name: "Phase 11 Check Crew Updated", mode: "roundtable" }),
    });
    const patchedGroup = patched.body.group as { name?: string; mode?: string } | undefined;
    check(
      "group metadata can be updated",
      patched.status === 200 &&
        patchedGroup?.name === "Phase 11 Check Crew Updated" &&
        patchedGroup?.mode === "roundtable",
    );

    const replaced = await request(`/api/groups/${groupId}/members`, {
      method: "PUT",
      token,
      body: JSON.stringify({ leadAgentId: reviewerId, memberIds: [leadId, researcherId] }),
    });
    const replacedGroup = replaced.body.group as
      | { leadAgentId: string; members: Array<{ agentId: string; role: string }> }
      | undefined;
    check(
      "membership replacement keeps one lead",
      replaced.status === 200 &&
        replacedGroup?.leadAgentId === reviewerId &&
        replacedGroup?.members.filter((member) => member.role === "lead").length === 1,
    );

    const rejected = await request(`/api/groups/${groupId}/members`, {
      method: "PUT",
      token,
      body: JSON.stringify({ leadAgentId: randomUUID(), memberIds: [randomUUID()] }),
    });
    check("unknown members are rejected", rejected.status === 400, `status=${rejected.status}`);

    const threadResponse = await request("/api/threads", {
      method: "POST",
      token,
      body: JSON.stringify({ title: "Phase 11 Group Chat", groupId }),
    });
    const thread = threadResponse.body.thread as { id?: string; group_id?: string } | undefined;
    threadId = thread?.id ?? null;
    check(
      "a group thread is created with its group id",
      threadResponse.status === 201 && thread?.group_id === groupId,
      JSON.stringify(thread),
    );

    // The ordinary chat route must never stream a group conversation.
    const chatOnGroupThread = await request("/api/chat", {
      method: "POST",
      token,
      body: JSON.stringify({
        threadId,
        messages: [{ id: "check-1", role: "user", parts: [{ type: "text", text: "hello" }] }],
      }),
    });
    const chatError = chatOnGroupThread.body.error as { code?: string } | undefined;
    check(
      "the ordinary chat route refuses a group thread",
      chatOnGroupThread.status === 409 && chatError?.code === "group_thread",
      `status=${chatOnGroupThread.status} body=${JSON.stringify(chatOnGroupThread.body)}`,
    );

    // A group run owns its agent and model: an explicit one is a client bug.
    const conflictingBody = await request("/api/agents/run", {
      method: "POST",
      token,
      body: JSON.stringify({
        groupId,
        threadId,
        agentId: leadId,
        goal: "This body mixes a group run with a single agent run",
      }),
    });
    check(
      "a group run refuses an explicit agentId",
      conflictingBody.status === 400,
      `status=${conflictingBody.status} body=${JSON.stringify(conflictingBody.body)}`,
    );

    const conflictingModel = await request("/api/agents/run", {
      method: "POST",
      token,
      body: JSON.stringify({
        groupId,
        threadId,
        model: "google:gemini-3.8-flash",
        goal: "This body mixes a group run with an explicit model",
      }),
    });
    check(
      "a group run refuses an explicit model",
      conflictingModel.status === 400,
      `status=${conflictingModel.status}`,
    );

    const runResponse = await request("/api/agents/run", {
      method: "POST",
      token,
      body: JSON.stringify({
        groupId,
        threadId,
        goal: `@Researcher check the release notes and report back`,
        tz: "Asia/Kolkata",
      }),
    });
    runId = (runResponse.body.runId as string | undefined) ?? null;
    check(
      "a group message enters the durable run pipeline",
      runResponse.status === 202 && Boolean(runId) && runResponse.body.status === "queued",
      `status=${runResponse.status} body=${JSON.stringify(runResponse.body)}`,
    );

    // One live parent per group: a second one is refused.
    const concurrentParent = await request("/api/agents/run", {
      method: "POST",
      token,
      body: JSON.stringify({
        groupId,
        threadId,
        goal: "A second parent run must not start while the first is in flight",
      }),
    });
    check(
      "a second concurrent parent run is refused",
      concurrentParent.status === 409,
      `status=${concurrentParent.status} body=${JSON.stringify(concurrentParent.body)}`,
    );

    const { data: parentRun } = await admin
      .from("agent_runs")
      .select("id, group_id, thread_id, parent_run_id, status")
      .eq("id", runId ?? "")
      .maybeSingle();
    check(
      "the parent run is linked to the group and thread",
      parentRun?.group_id === groupId &&
        parentRun?.thread_id === threadId &&
        parentRun?.parent_run_id === null,
    );

    const { data: messages } = await admin
      .from("messages")
      .select("role, parts, run_id")
      .eq("thread_id", threadId ?? "")
      .eq("role", "user");
    check(
      "the user's group message is persisted",
      (messages ?? []).some((message) =>
        (message.parts as Array<{ text?: string }>).some((part) =>
          part.text?.includes("@Researcher"),
        ),
      ),
    );
    check(
      "the user's group message is linked to its run",
      (messages ?? []).some((message) => message.run_id === runId),
    );

    // Deterministic member-turn fixture: the timeline assertions must not
    // depend on a model call. The child row and its handoff marker are
    // written the way the group graph writes them.
    const { data: childRun, error: childError } = await admin
      .from("agent_runs")
      .insert({
        user_id: userId,
        goal: "Check the release notes and report back",
        thread_id: threadId,
        agent_id: researcherId,
        parent_run_id: runId,
        group_id: groupId,
        group_depth: 0,
        status: "succeeded",
        model: "google:gemini-3.8-flash",
        tokens_used: 42,
        result: { answer: "The release notes look good." },
      })
      .select("id")
      .single();
    if (childError || !childRun) {
      throw new Error(`Could not create the child fixture: ${childError?.message}`);
    }
    childRunId = childRun.id as string;

    await admin.from("messages").insert({
      user_id: userId,
      thread_id: threadId,
      role: "assistant",
      model: null,
      parts: [{ type: "text", text: "Handing this to the Reviewer." }],
      from_agent_id: researcherId,
      to_agent_id: reviewerId,
      handoff: {
        from: researcherId,
        to: reviewerId,
        task: "Review the release notes",
      },
      run_id: childRunId,
    });

    const detailResponse = await request(`/api/runs/${runId}`, { token });
    const detail = detailResponse.body as {
      run?: { group_id?: string | null; parent_run_id?: string | null };
      children?: Array<{ id: string; agent_id?: string | null; group_depth?: number }>;
    };
    const fixtureChild = (detail.children ?? []).find((child) => child.id === childRunId);
    check(
      "the parent timeline exposes the member child turn",
      detailResponse.status === 200 &&
        detail.run?.group_id === groupId &&
        fixtureChild?.agent_id === researcherId &&
        fixtureChild?.group_depth === 0,
      `status=${detailResponse.status}`,
    );

    const { data: handoffRows } = await admin
      .from("messages")
      .select("from_agent_id, to_agent_id, handoff, run_id")
      .eq("run_id", childRunId)
      .eq("role", "assistant");
    const handoffRow = (handoffRows ?? [])[0] as
      | { from_agent_id?: string | null; to_agent_id?: string | null; handoff?: { from?: string; to?: string; task?: string } | null }
      | undefined;
    check(
      "the member turn records from_agent_id and a {from,to,task} handoff",
      handoffRow?.from_agent_id === researcherId &&
        handoffRow?.to_agent_id === reviewerId &&
        handoffRow?.handoff?.from === researcherId &&
        handoffRow?.handoff?.to === reviewerId &&
        handoffRow?.handoff?.task === "Review the release notes",
      JSON.stringify(handoffRow),
    );

    // RLS client check: the signed-in user can read their own group and
    // membership rows without the service role.
    const rls = createClient(
      process.env.SUPABASE_URL as string,
      process.env.SUPABASE_ANON_KEY as string,
      {
        auth: { persistSession: false, autoRefreshToken: false },
        global: { headers: { Authorization: `Bearer ${token}` } },
      },
    );
    const { data: visibleGroup } = await rls
      .from("agent_groups")
      .select("id")
      .eq("id", groupId ?? "")
      .maybeSingle();
    const { data: visibleMembers } = await rls
      .from("group_members")
      .select("agent_id")
      .eq("group_id", groupId ?? "");
    check(
      "the RLS client sees only the owned group membership",
      visibleGroup?.id === groupId && (visibleMembers ?? []).length === 3,
    );

    // A group with a live run cannot be deleted.
    const deleteWhileRunning = await request(`/api/groups/${groupId}`, {
      method: "DELETE",
      token,
    });
    check(
      "a group with a live run cannot be deleted",
      deleteWhileRunning.status === 409,
      `status=${deleteWhileRunning.status}`,
    );

    // Cancel the run before deleting the group: an active parent is a 409.
    const cancelled = await request(`/api/runs/${runId}/cancel`, { method: "POST", token });
    check("the live group run can be cancelled", cancelled.status === 200, `status=${cancelled.status}`);

    // A sleeping member cannot be routed to.
    await request(`/api/agents/${reviewerId}/sleep`, { method: "POST", token });
    const sleepingRun = await request("/api/agents/run", {
      method: "POST",
      token,
      body: JSON.stringify({
        groupId,
        threadId,
        goal: "A sleeping member must not accept a turn",
      }),
    });
    const sleepingMessage = (sleepingRun.body.error as { message?: string } | undefined)?.message ?? "";
    check(
      "a sleeping member refuses the group run",
      sleepingRun.status === 409 && /asleep/i.test(sleepingMessage),
      `status=${sleepingRun.status} body=${JSON.stringify(sleepingRun.body)}`,
    );
    await request(`/api/agents/${reviewerId}/wake`, { method: "POST", token });

    const deleted = await request(`/api/groups/${groupId}`, { method: "DELETE", token });
    check("group deletion succeeds", deleted.status === 200 && deleted.body.deleted === true);
    const deletedGroupId = groupId;
    groupId = null;

    // The deleted group must be gone from the database, not just hidden by
    // the API.
    const { data: leftGroup } = await admin
      .from("agent_groups")
      .select("id")
      .eq("id", deletedGroupId ?? "")
      .maybeSingle();
    const { data: leftMembers } = await admin
      .from("group_members")
      .select("agent_id")
      .eq("group_id", deletedGroupId ?? "");
    check(
      "the deleted group and its membership rows are gone",
      !leftGroup && (leftMembers ?? []).length === 0,
    );
  } finally {
    if (threadId) {
      const { data: threadRuns } = await admin
        .from("agent_runs")
        .select("id")
        .eq("thread_id", threadId);
      const runIds = [runId, childRunId, ...((threadRuns ?? []) as Array<{ id: string }>).map((row) => row.id)]
        .filter((id): id is string => Boolean(id));
      if (runIds.length > 0) {
        // Cancel first: a live run would otherwise keep its children alive.
        await admin
          .from("agent_runs")
          .update({ status: "cancelled", finished_at: new Date().toISOString() })
          .in("id", runIds)
          .in("status", ["queued", "running", "awaiting_approval", "paused"]);
        await admin.from("run_events").delete().in("run_id", runIds);
        await admin.from("approvals").delete().in("run_id", runIds);
      }
      await admin.from("messages").delete().eq("thread_id", threadId);
      await admin.from("agent_runs").delete().eq("thread_id", threadId);
      await admin.from("threads").delete().eq("id", threadId);

      // The cleanup must actually be complete.
      const { data: leftRuns } = await admin
        .from("agent_runs")
        .select("id")
        .eq("thread_id", threadId);
      const { data: leftMessages } = await admin
        .from("messages")
        .select("id")
        .eq("thread_id", threadId);
      const { data: leftThread } = await admin
        .from("threads")
        .select("id")
        .eq("id", threadId);
      check(
        "the cleanup removed every group row",
        (leftRuns ?? []).length === 0 &&
          (leftMessages ?? []).length === 0 &&
          (leftThread ?? []).length === 0,
        `runs=${(leftRuns ?? []).length} messages=${(leftMessages ?? []).length}`,
      );
    }
    if (groupId) {
      // Membership first, then the group: the FK cascades either way, but
      // this order leaves no window where an orphan row can survive.
      await admin.from("group_members").delete().eq("group_id", groupId);
      await admin.from("agent_groups").delete().eq("id", groupId).eq("user_id", userId);
    }
    if (agentIds.length > 0) await admin.from("agents").delete().in("id", agentIds).eq("user_id", userId);
  }

  const failed = checks.filter((entry) => !entry.ok);
  console.log(`\n${checks.length - failed.length}/${checks.length} checks passed.`);
  if (failed.length > 0) process.exitCode = 1;
}

main().catch((error: unknown) => {
  console.error(error);
  process.exitCode = 1;
});
