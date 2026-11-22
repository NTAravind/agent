/**
 * Live acceptance check for Agent Groups (Phase 11).
 *
 *   npx tsx --env-file=.env.local scripts/check-groups-live.ts
 *
 * Unlike `check-groups.ts` (which never calls a model), this script drives a
 * real three-member group through **two visible handoffs** and checks the
 * durable result: the member child runs, their `{from,to,task}` handoff
 * markers, the group chat messages, and the lead's final answer.
 *
 * It consumes provider quota. The model is configurable through
 * `GROUP_CHECK_MODEL` (default: `groq:gpt-oss-120b`) and the last member's
 * model through `GROUP_CHECK_EDITOR_MODEL` (default: the same model).
 */
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

/** The first mobile-enabled model that is not a private provider. */
async function pickModel(): Promise<string | null> {
  const admin = supabaseAdmin();
  const { data } = await admin
    .from("provider_models")
    .select("app_id, provider, mobile_enabled")
    .eq("mobile_enabled", true);
  const preferred = process.env.GROUP_CHECK_MODEL;
  if (preferred) return preferred;
  const groq = (data ?? []).find(
    (row) => row.provider === "groq" && row.app_id === "groq:gpt-oss-120b",
  );
  if (groq) return groq.app_id as string;
  return ((data ?? [])[0]?.app_id as string | undefined) ?? null;
}

async function main() {
  const userId = process.env.CHECK_USER_ID;
  if (!userId) throw new Error("CHECK_USER_ID is not set.");
  const token = await mintAccessToken(userId);
  if (!token) throw new Error("Could not mint an access token for the check user.");

  const admin = supabaseAdmin();
  const model = await pickModel();
  if (!model) throw new Error("No mobile-enabled model is available for the check.");
  // The editor may use a different model: it is the last member, and its
  // model is the one the group's finalization falls back to when the lead's
  // provider is rate-limited.
  const editorModel = process.env.GROUP_CHECK_EDITOR_MODEL ?? model;

  const agentIds: string[] = [];
  let groupId: string | null = null;
  let threadId: string | null = null;
  let runId: string | null = null;

  const members = [
    {
      name: "Phase 11 Live Researcher",
      model,
      instructions:
        "You are the Researcher of a three-member agent group. Your first and only action must be one call to the handoff_to tool. Do not write an answer yourself and do not call any other tool. Call handoff_to with agent exactly 'Phase 11 Live Writer' and a task that starts with 'Draft request:' and tells the Writer to write a two-sentence draft and then hand that draft to the group member named 'Phase 11 Live Editor' using the handoff_to tool.",
    },
    {
      name: "Phase 11 Live Writer",
      model,
      instructions:
        "You are the Writer of a three-member agent group. Your first and only action must be one call to the handoff_to tool. Do not write an answer yourself and do not call any other tool. Call handoff_to with agent exactly 'Phase 11 Live Editor' and a task that starts with 'Draft:' followed by the two-sentence draft you were asked to write.",
    },
    {
      name: "Phase 11 Live Editor",
      model: editorModel,
      instructions:
        "You are the Editor of a three-member agent group and the last member. Do not call any tool. Write the final answer for the group from the task you received: a short readiness verdict and the two key points.",
    },
  ];

  try {
    for (const member of members) {
      const { data, error } = await admin
        .from("agents")
        .insert({
          user_id: userId,
          name: member.name,
          system_prompt: member.instructions,
          model: member.model,
          avatar: { type: "emoji", value: "🧪", color: "#7F9DFF" },
        })
        .select("id")
        .single();
      if (error || !data) throw new Error(`Could not create the check agent: ${error?.message}`);
      agentIds.push(data.id as string);
    }
    const [researcherId, writerId, editorId] = agentIds as [string, string, string];

    const created = await request("/api/groups", {
      method: "POST",
      token,
      body: JSON.stringify({
        name: "Phase 11 Live Crew",
        description: "Temporary live acceptance group",
        leadAgentId: researcherId,
        memberIds: [writerId, editorId],
        mode: "handoff",
        maxHops: 4,
        tokenBudget: 40_000,
      }),
    });
    const createdGroup = created.body.group as { id?: string } | undefined;
    groupId = createdGroup?.id ?? null;
    check("the live group was created", created.status === 201 && Boolean(groupId), `status=${created.status}`);
    if (!groupId) throw new Error("Could not create the live group.");

    const threadResponse = await request("/api/threads", {
      method: "POST",
      token,
      body: JSON.stringify({ title: "Phase 11 Live Chat", groupId }),
    });
    const thread = threadResponse.body.thread as { id?: string } | undefined;
    threadId = thread?.id ?? null;
    check("the live group thread was created", threadResponse.status === 201 && Boolean(threadId));

    console.log(`\nRunning the live group with model ${model} (this consumes quota)…\n`);
    const runResponse = await request("/api/agents/run", {
      method: "POST",
      token,
      body: JSON.stringify({
        groupId,
        threadId,
        inline: true,
        goal: "Assess whether the release is ready and summarise it in two sentences.",
        tz: "Asia/Kolkata",
      }),
    });
    runId = (runResponse.body.runId as string | undefined) ?? null;
    check(
      "the live group run finished",
      Boolean(runId) && ["succeeded", "failed"].includes(String(runResponse.body.status)),
      `status=${runResponse.status} body=${JSON.stringify(runResponse.body).slice(0, 300)}`,
    );

    const { data: parentRun } = await admin
      .from("agent_runs")
      .select("id, status, result, error, tokens_used")
      .eq("id", runId ?? "")
      .maybeSingle();
    check(
      "the parent run succeeded",
      (parentRun as { status?: string } | null)?.status === "succeeded",
      `status=${(parentRun as { status?: string } | null)?.status} error=${(parentRun as { error?: string } | null)?.error ?? "none"}`,
    );

    const { data: children } = await admin
      .from("agent_runs")
      .select("id, agent_id, status, result, tokens_used, group_depth")
      .eq("parent_run_id", runId ?? "")
      .order("created_at", { ascending: true });
    const childRows = (children ?? []) as Array<{
      id: string;
      agent_id: string | null;
      status: string;
      result: { handoff?: { from?: string; to?: string; task?: string } } | null;
    }>;
    check(
      "the group produced at least two member turns",
      childRows.length >= 2,
      `children=${childRows.length}`,
    );

    const handoffs = childRows
      .map((child) => child.result?.handoff)
      .filter((handoff): handoff is { from?: string; to?: string; task?: string } =>
        Boolean(handoff),
      );
    check(
      "at least two member turns ended in a handoff",
      handoffs.length >= 2,
      `handoffs=${handoffs.length}`,
    );
    check(
      "the handoffs name the next member and carry a task",
      handoffs.every(
        (handoff) =>
          typeof handoff.from === "string" &&
          typeof handoff.to === "string" &&
          typeof handoff.task === "string" &&
          handoff.task.length > 0,
      ),
      JSON.stringify(handoffs.map((handoff) => ({ from: handoff.from, to: handoff.to }))),
    );

    const { data: handoffMessages } = await admin
      .from("messages")
      .select("from_agent_id, to_agent_id, handoff, run_id")
      .eq("thread_id", threadId ?? "")
      .eq("role", "assistant");
    const markerRows = (handoffMessages ?? []).filter(
      (row) => (row as { handoff?: unknown }).handoff,
    );
    check(
      "the group chat shows the handoff markers",
      markerRows.length >= 2,
      `markers=${markerRows.length}`,
    );
    check(
      "the handoff markers record the direction",
      markerRows.every(
        (row) =>
          typeof (row as { from_agent_id?: string | null }).from_agent_id === "string" &&
          typeof (row as { to_agent_id?: string | null }).to_agent_id === "string",
      ),
    );

    const { data: finalMessages } = await admin
      .from("messages")
      .select("parts")
      .eq("thread_id", threadId ?? "")
      .eq("role", "assistant");
    const finalTexts = (finalMessages ?? []).flatMap(
      (row) => (row as { parts?: Array<{ text?: string; kind?: string }> }).parts ?? [],
    );
    check(
      "the lead published a final answer in the group chat",
      finalTexts.some((part) => part.kind === "group-final" && Boolean(part.text?.trim())),
      `parts=${JSON.stringify(finalTexts.map((part) => part.kind ?? "text")).slice(0, 200)}`,
    );
  } finally {
    if (threadId) {
      const { data: threadRuns } = await admin
        .from("agent_runs")
        .select("id")
        .eq("thread_id", threadId);
      const runIds = [runId, ...((threadRuns ?? []) as Array<{ id: string }>).map((row) => row.id)]
        .filter((id): id is string => Boolean(id));
      if (runIds.length > 0) {
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

      const { data: leftRuns } = await admin
        .from("agent_runs")
        .select("id")
        .eq("thread_id", threadId);
      const { data: leftMessages } = await admin
        .from("messages")
        .select("id")
        .eq("thread_id", threadId);
      check(
        "the cleanup removed every group row",
        (leftRuns ?? []).length === 0 && (leftMessages ?? []).length === 0,
        `runs=${(leftRuns ?? []).length} messages=${(leftMessages ?? []).length}`,
      );
    }
    if (groupId) await admin.from("agent_groups").delete().eq("id", groupId).eq("user_id", userId);
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
