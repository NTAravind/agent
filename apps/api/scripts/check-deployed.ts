/**
 * Live end-to-end check of the Phase 9 + Phase 10 + Phase 11 routes against a
 * deployed API.
 *
 *   npx tsx --env-file=.env.local scripts/check-deployed.ts [base-url]
 *
 * Defaults to the production deployment from the mobile app's env. Verifies
 * task lists, tasks, recurring events, push tokens, note editing, routines and
 * agent groups, then removes every row it created.
 */
import { supabaseAdmin } from "../lib/supabase/server";

const BASE = process.argv[2] ?? "https://agent-tau-taupe.vercel.app";

const checks: Array<{ name: string; ok: boolean; detail?: string }> = [];
function check(name: string, ok: boolean, detail?: string) {
  checks.push({ name, ok, detail });
  console.log(`${ok ? "✔" : "✖"} ${name}${detail ? ` — ${detail}` : ""}`);
}

/** Mints an access token for a user of the project's Supabase instance. */
async function mintAccessToken(userId: string): Promise<string | null> {
  const supabaseUrl = process.env.SUPABASE_URL;
  const serviceKey = process.env.SUPABASE_SERVICE_ROLE_KEY;
  const anonKey = process.env.SUPABASE_ANON_KEY;
  if (!supabaseUrl || !serviceKey || !anonKey) return null;

  const usersResponse = await fetch(`${supabaseUrl}/auth/v1/admin/users?per_page=50`, {
    headers: { apikey: serviceKey, Authorization: `Bearer ${serviceKey}` },
  });
  const usersBody = (await readJson(usersResponse)) as
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
    body: JSON.stringify({ type: "magiclink", email: user.email, options: { createUser: false } }),
  });
  const link = (await readJson(linkResponse)) as { email_otp?: string };
  if (!link.email_otp) return null;

  const verifyResponse = await fetch(`${supabaseUrl}/auth/v1/verify`, {
    method: "POST",
    headers: { apikey: anonKey, "Content-Type": "application/json" },
    body: JSON.stringify({ type: "magiclink", email: user.email, token: link.email_otp }),
  });
  if (!verifyResponse.ok) return null;
  const verified = (await readJson(verifyResponse)) as { access_token?: string };
  return verified.access_token ?? null;
}

/** Parses a JSON body, tolerating an HTML error page (a route missing from the build). */
async function readJson(response: Response): Promise<unknown> {
  const text = await response.text();
  try {
    return JSON.parse(text);
  } catch {
    return { error: { code: "non_json", message: text.slice(0, 120) } };
  }
}

async function main() {
  const userId = process.env.CHECK_USER_ID ?? process.env.ALLOWED_USER_ID;
  if (!userId) throw new Error("CHECK_USER_ID / ALLOWED_USER_ID is not set.");

  const admin = supabaseAdmin();
  const taskIds: string[] = [];
  const eventIds: string[] = [];
  const listIds: string[] = [];
  const routineIds: string[] = [];
  const groupAgentIds: string[] = [];
  const groupIds: string[] = [];
  const groupThreadIds: string[] = [];
  const groupRunIds: string[] = [];
  const deployedChildRunIds: string[] = [];
  const token = await mintAccessToken(userId);
  if (!token) throw new Error("Could not mint an access token.");

  const H = { Authorization: `Bearer ${token}`, "Content-Type": "application/json" };
  console.log(`checking ${BASE}\n`);

  try {
    const listRes = await fetch(`${BASE}/api/task-lists`, {
      method: "POST",
      headers: H,
      body: JSON.stringify({ name: `Deployed check ${Date.now()}` }),
    });
    const listBody = (await readJson(listRes)) as { taskList?: { id: string } };
    if (listBody.taskList?.id) listIds.push(listBody.taskList.id);
    check("POST /api/task-lists", listRes.status === 201, `HTTP ${listRes.status}`);

    const taskRes = await fetch(`${BASE}/api/tasks`, {
      method: "POST",
      headers: H,
      body: JSON.stringify({
        listId: listBody.taskList?.id,
        title: "Deployed task",
        dueAt: "2026-11-25T03:30:00.000Z",
        priority: 1,
      }),
    });
    const taskBody = (await readJson(taskRes)) as { task?: { id: string } };
    if (taskBody.task?.id) taskIds.push(taskBody.task.id);
    check("POST /api/tasks", taskRes.status === 201, `HTTP ${taskRes.status}`);

    const getTasks = await fetch(`${BASE}/api/tasks`, { headers: H });
    const getTasksBody = (await readJson(getTasks)) as { tasks?: unknown[] };
    check(
      "GET /api/tasks",
      getTasks.status === 200 && Array.isArray(getTasksBody.tasks),
      `${getTasksBody.tasks?.length ?? 0} tasks`,
    );

    const eventRes = await fetch(`${BASE}/api/events`, {
      method: "POST",
      headers: H,
      body: JSON.stringify({
        title: "Deployed weekly",
        startsAt: "2026-11-23T04:30:00.000Z",
        endsAt: "2026-11-23T05:00:00.000Z",
        rrule: "FREQ=WEEKLY;BYDAY=MO",
        reminders: [{ minutesBefore: 15 }],
      }),
    });
    const eventBody = (await readJson(eventRes)) as { event?: { id: string } };
    if (eventBody.event?.id) eventIds.push(eventBody.event.id);
    check("POST /api/events (weekly)", eventRes.status === 201, `HTTP ${eventRes.status}`);

    const range = await fetch(
      `${BASE}/api/events?from=2026-11-20T00:00:00.000Z&to=2026-12-21T00:00:00.000Z`,
      { headers: H },
    );
    const rangeBody = (await readJson(range)) as { events?: Array<{ startsAt: string }> };
    check(
      "GET /api/events expands the weekly rule",
      range.status === 200 && (rangeBody.events?.length ?? 0) >= 4,
      `${rangeBody.events?.length ?? 0} occurrences, first ${rangeBody.events?.[0]?.startsAt}`,
    );

    const pushRes = await fetch(`${BASE}/api/push-tokens`, {
      method: "POST",
      headers: H,
      body: JSON.stringify({ expoToken: "ExponentPushToken[deployedcheck]", platform: "ios" }),
    });
    check("POST /api/push-tokens", pushRes.status === 201, `HTTP ${pushRes.status}`);
    await fetch(
      `${BASE}/api/push-tokens?expoToken=${encodeURIComponent("ExponentPushToken[deployedcheck]")}`,
      { method: "DELETE", headers: H },
    );

    const notePath = `deployed-check-${Date.now()}.md`;
    const noteRes = await fetch(`${BASE}/api/notes/${encodeURIComponent(notePath)}`, {
      method: "PUT",
      headers: { Authorization: `Bearer ${token}`, "Content-Type": "text/markdown" },
      body: "# Deployed check\n\nhello",
    });
    check("PUT /api/notes/:path", noteRes.status === 200 || noteRes.status === 201, `HTTP ${noteRes.status}`);

    const noteDelete = await fetch(`${BASE}/api/notes/${encodeURIComponent(notePath)}`, {
      method: "DELETE",
      headers: { Authorization: `Bearer ${token}` },
    });
    check("DELETE /api/notes/:path", noteDelete.status === 200, `HTTP ${noteDelete.status}`);

    const noAuth = await fetch(`${BASE}/api/tasks`);
    check("GET /api/tasks without a token is 401", noAuth.status === 401, `HTTP ${noAuth.status}`);

    // --- Phase 10: routines -------------------------------------------------
    const routineRes = await fetch(`${BASE}/api/routines`, {
      method: "POST",
      headers: H,
      body: JSON.stringify({
        name: "Deployed routine",
        prompt: "Summarize my open tasks.",
        schedule: { frequency: "weekly", days_of_week: ["MO"], time: "09:00" },
        tz: "Asia/Kolkata",
      }),
    });
    const routineBody = (await readJson(routineRes)) as {
      routine?: { id: string; status: string; scheduleLabel: string; nextRuns: string[] };
    };
    const routineId = routineBody.routine?.id;
    if (routineId) routineIds.push(routineId);
    check(
      "POST /api/routines creates a draft",
      routineRes.status === 201 && routineBody.routine?.status === "draft",
      routineRes.status === 404
        ? "HTTP 404 — the deployed build does not have /api/routines yet (redeploy the API)"
        : `HTTP ${routineRes.status} — ${routineBody.routine?.scheduleLabel}`,
    );
    check(
      "the routine previews the next occurrences at 09:00 IST",
      (routineBody.routine?.nextRuns?.length ?? 0) === 3 &&
        Boolean(routineBody.routine?.nextRuns?.[0]?.endsWith("T03:30:00.000Z")),
      (routineBody.routine?.nextRuns ?? []).join(", "),
    );

    if (routineId) {
      const activateRes = await fetch(`${BASE}/api/routines/${routineId}/activate`, {
        method: "POST",
        headers: H,
      });
      const activateBody = (await readJson(activateRes)) as {
        routine?: { status: string; nextRunAt: string | null };
      };
      check(
        "POST /api/routines/:id/activate",
        activateRes.status === 200 && activateBody.routine?.status === "active",
        `HTTP ${activateRes.status} — next ${activateBody.routine?.nextRunAt}`,
      );

      const listRes = await fetch(`${BASE}/api/routines`, { headers: H });
      const listBody = (await readJson(listRes)) as { routines?: unknown[] };
      check(
        "GET /api/routines",
        listRes.status === 200 && Array.isArray(listBody.routines),
        `${listBody.routines?.length ?? 0} routines`,
      );

      const noAuthRoutines = await fetch(`${BASE}/api/routines`);
      check(
        "GET /api/routines without a token is 401",
        noAuthRoutines.status === 401,
        `HTTP ${noAuthRoutines.status}`,
      );
    }

    // --- Phase 11: agent groups ---------------------------------------------
    const agentNames = ["Deployed Group Lead", "Deployed Group Member"];
    const { data: deployedAgents, error: deployedAgentError } = await admin
      .from("agents")
      .insert(
        agentNames.map((name) => ({
          user_id: userId,
          name,
          avatar: { type: "emoji", value: "🧪", color: "#7F9DFF" },
        })),
      )
      .select("id");
    if (deployedAgentError) {
      check("create deployed-check agents", false, deployedAgentError.message);
    } else {
      groupAgentIds.push(
        ...(deployedAgents ?? []).map((agent) => agent.id as string),
      );
    }

    const [leadAgentId, memberAgentId] = groupAgentIds;
    if (leadAgentId && memberAgentId) {
      const groupRes = await fetch(`${BASE}/api/groups`, {
        method: "POST",
        headers: H,
        body: JSON.stringify({
          name: "Deployed Group",
          description: "Temporary deployed-check group",
          leadAgentId,
          memberIds: [memberAgentId],
          mode: "handoff",
          maxHops: 5,
          tokenBudget: 12_000,
        }),
      });
      const groupBody = (await readJson(groupRes)) as {
        group?: { id: string; leadAgentId: string; members?: unknown[] };
      };
      const groupId = groupBody.group?.id;
      if (groupId) groupIds.push(groupId);
      check(
        "POST /api/groups creates an owned group",
        groupRes.status === 201 &&
          groupBody.group?.leadAgentId === leadAgentId &&
          Array.isArray(groupBody.group?.members),
        groupRes.status === 404
          ? "HTTP 404 — the deployed build does not have /api/groups yet (redeploy the API)"
          : `HTTP ${groupRes.status}`,
      );

      if (groupId) {
        const listGroupsRes = await fetch(`${BASE}/api/groups`, { headers: H });
        const listGroupsBody = (await readJson(listGroupsRes)) as {
          groups?: Array<{ id: string }>;
        };
        check(
          "GET /api/groups lists the new group",
          listGroupsRes.status === 200 &&
            (listGroupsBody.groups ?? []).some((group) => group.id === groupId),
          `HTTP ${listGroupsRes.status}`,
        );

        const membersRes = await fetch(`${BASE}/api/groups/${groupId}/members`, {
          method: "PUT",
          headers: H,
          body: JSON.stringify({
            leadAgentId: memberAgentId,
            memberIds: [leadAgentId],
          }),
        });
        const membersBody = (await readJson(membersRes)) as {
          group?: { leadAgentId: string; members?: Array<{ role: string }> };
        };
        check(
          "PUT /api/groups/:id/members replaces membership",
          membersRes.status === 200 &&
            membersBody.group?.leadAgentId === memberAgentId &&
            (membersBody.group?.members ?? []).filter((member) => member.role === "lead")
              .length === 1,
          `HTTP ${membersRes.status}`,
        );

        const groupThreadRes = await fetch(`${BASE}/api/threads`, {
          method: "POST",
          headers: H,
          body: JSON.stringify({ title: "Deployed Group Chat", groupId }),
        });
        const groupThreadBody = (await readJson(groupThreadRes)) as {
          thread?: { id: string; group_id?: string | null };
        };
        const groupThreadId = groupThreadBody.thread?.id;
        if (groupThreadId) groupThreadIds.push(groupThreadId);
        check(
          "POST /api/threads creates a group thread",
          groupThreadRes.status === 201 && groupThreadBody.thread?.group_id === groupId,
          `HTTP ${groupThreadRes.status}`,
        );

        const groupRunRes = await fetch(`${BASE}/api/agents/run`, {
          method: "POST",
          headers: H,
          body: JSON.stringify({
            groupId,
            threadId: groupThreadId,
            goal: "@Deployed Group Member verify the group route",
            tz: "Asia/Kolkata",
          }),
        });
        const groupRunBody = (await readJson(groupRunRes)) as {
          runId?: string;
          status?: string;
          groupId?: string;
        };
        const groupRunId = groupRunBody.runId;
        if (groupRunId) groupRunIds.push(groupRunId);
        check(
          "POST /api/agents/run queues a group run",
          groupRunRes.status === 202 &&
            groupRunBody.status === "queued" &&
            groupRunBody.groupId === groupId,
          `HTTP ${groupRunRes.status}`,
        );

        if (groupRunId) {
          // The ordinary chat route must never stream a group conversation.
          const chatOnGroupThreadRes = await fetch(`${BASE}/api/chat`, {
            method: "POST",
            headers: H,
            body: JSON.stringify({
              threadId: groupThreadId,
              messages: [
                {
                  id: "deployed-check-1",
                  role: "user",
                  parts: [{ type: "text", text: "hello" }],
                },
              ],
            }),
          });
          const chatOnGroupThreadBody = (await readJson(chatOnGroupThreadRes)) as {
            error?: { code?: string };
          };
          check(
            "POST /api/chat refuses a group thread",
            chatOnGroupThreadRes.status === 409 &&
              chatOnGroupThreadBody.error?.code === "group_thread",
            `HTTP ${chatOnGroupThreadRes.status}`,
          );

          // A second parent run must not start while the first is in flight.
          const concurrentParentRes = await fetch(`${BASE}/api/agents/run`, {
            method: "POST",
            headers: H,
            body: JSON.stringify({
              groupId,
              threadId: groupThreadId,
              goal: "A second parent must not start while the first is in flight",
            }),
          });
          check(
            "POST /api/agents/run refuses a second concurrent parent",
            concurrentParentRes.status === 409,
            `HTTP ${concurrentParentRes.status}`,
          );

          const groupRunDetailRes = await fetch(`${BASE}/api/runs/${groupRunId}`, {
            headers: H,
          });
          const groupRunDetailBody = (await readJson(groupRunDetailRes)) as {
            run?: { group_id?: string | null };
            children?: unknown[];
          };
          check(
            "GET /api/runs/:id exposes the group parent and child timeline",
            groupRunDetailRes.status === 200 &&
              groupRunDetailBody.run?.group_id === groupId &&
              Array.isArray(groupRunDetailBody.children),
            `HTTP ${groupRunDetailRes.status}`,
          );

          // Deterministic member-turn fixture: the timeline assertions must
          // not depend on a model call.
          const { data: deployedChild, error: deployedChildError } = await admin
            .from("agent_runs")
            .insert({
              user_id: userId,
              goal: "Verify the group route",
              thread_id: groupThreadId,
              agent_id: memberAgentId,
              parent_run_id: groupRunId,
              group_id: groupId,
              group_depth: 0,
              status: "succeeded",
              tokens_used: 42,
              result: { answer: "The route works." },
            })
            .select("id")
            .single();
          if (deployedChildError || !deployedChild) {
            check("create the deployed child-turn fixture", false, deployedChildError?.message);
          } else {
            const deployedChildId = deployedChild.id as string;
            deployedChildRunIds.push(deployedChildId);
            await admin.from("messages").insert({
              user_id: userId,
              thread_id: groupThreadId,
              role: "assistant",
              model: null,
              parts: [{ type: "text", text: "Handing this to the lead." }],
              from_agent_id: memberAgentId,
              to_agent_id: leadAgentId,
              handoff: {
                from: memberAgentId,
                to: leadAgentId,
                task: "Summarise the deployed group route",
              },
              run_id: deployedChildId,
            });

            const childDetailRes = await fetch(`${BASE}/api/runs/${groupRunId}`, {
              headers: H,
            });
            const childDetailBody = (await readJson(childDetailRes)) as {
              children?: Array<{ id: string; agent_id?: string | null; group_depth?: number }>;
            };
            const deployedChildRow = (childDetailBody.children ?? []).find(
              (child) => child.id === deployedChildId,
            );
            check(
              "GET /api/runs/:id exposes the member child turn",
              childDetailRes.status === 200 &&
                deployedChildRow?.agent_id === memberAgentId &&
                deployedChildRow?.group_depth === 0,
              `HTTP ${childDetailRes.status}`,
            );

            const { data: deployedHandoffRows } = await admin
              .from("messages")
              .select("from_agent_id, to_agent_id, handoff")
              .eq("run_id", deployedChildId)
              .eq("role", "assistant");
            const deployedHandoff = (deployedHandoffRows ?? [])[0] as
              | {
                  from_agent_id?: string | null;
                  to_agent_id?: string | null;
                  handoff?: { from?: string; to?: string; task?: string } | null;
                }
              | undefined;
            check(
              "the member turn records from_agent_id and a {from,to,task} handoff",
              deployedHandoff?.from_agent_id === memberAgentId &&
                deployedHandoff?.to_agent_id === leadAgentId &&
                deployedHandoff?.handoff?.from === memberAgentId &&
                deployedHandoff?.handoff?.to === leadAgentId &&
                deployedHandoff?.handoff?.task === "Summarise the deployed group route",
              JSON.stringify(deployedHandoff),
            );
          }

          // A group with a live run cannot be deleted.
          const deleteWhileRunningRes = await fetch(`${BASE}/api/groups/${groupId}`, {
            method: "DELETE",
            headers: H,
          });
          check(
            "DELETE /api/groups/:id refuses a group with a live run",
            deleteWhileRunningRes.status === 409,
            `HTTP ${deleteWhileRunningRes.status}`,
          );

          // Cancel first: an active parent is a 409 for the delete.
          const cancelGroupRunRes = await fetch(`${BASE}/api/runs/${groupRunId}/cancel`, {
            method: "POST",
            headers: H,
          });
          check(
            "POST /api/runs/:id/cancel cancels the group run",
            cancelGroupRunRes.status === 200,
            `HTTP ${cancelGroupRunRes.status}`,
          );
        }

        const deleteGroupRes = await fetch(`${BASE}/api/groups/${groupId}`, {
          method: "DELETE",
          headers: H,
        });
        const deleteGroupBody = (await readJson(deleteGroupRes)) as {
          deleted?: boolean;
        };
        check(
          "DELETE /api/groups/:id removes the group",
          deleteGroupRes.status === 200 && deleteGroupBody.deleted === true,
          `HTTP ${deleteGroupRes.status}`,
        );

        // The deleted group must be gone from the database, not just hidden
        // by the API.
        const { data: leftGroup } = await admin
          .from("agent_groups")
          .select("id")
          .eq("id", groupId ?? "")
          .maybeSingle();
        const { data: leftMembers } = await admin
          .from("group_members")
          .select("agent_id")
          .eq("group_id", groupId ?? "");
        check(
          "the deleted group and its membership rows are gone",
          !leftGroup && (leftMembers ?? []).length === 0,
        );
      }

      const noAuthGroups = await fetch(`${BASE}/api/groups`);
      check(
        "GET /api/groups without a token is 401",
        noAuthGroups.status === 401,
        `HTTP ${noAuthGroups.status}`,
      );
    }
  } finally {
    if (taskIds.length) await admin.from("tasks").delete().in("id", taskIds);
    if (eventIds.length) await admin.from("calendar_events").delete().in("id", eventIds);
    if (listIds.length) await admin.from("task_lists").delete().in("id", listIds);
    if (routineIds.length) {
      await admin.from("agent_runs").delete().in("routine_id", routineIds);
      await admin.from("routines").delete().in("id", routineIds);
    }
    const allGroupRunIds = [...groupRunIds, ...deployedChildRunIds];
    if (allGroupRunIds.length) {
      // Cancel first: a live run keeps its children alive.
      await admin
        .from("agent_runs")
        .update({ status: "cancelled", finished_at: new Date().toISOString() })
        .in("id", allGroupRunIds)
        .in("status", ["queued", "running", "awaiting_approval", "paused"]);
      await admin.from("run_events").delete().in("run_id", allGroupRunIds);
      await admin.from("approvals").delete().in("run_id", allGroupRunIds);
    }
    if (groupThreadIds.length) {
      await admin.from("messages").delete().in("thread_id", groupThreadIds);
      await admin.from("agent_runs").delete().in("thread_id", groupThreadIds);
      await admin.from("threads").delete().in("id", groupThreadIds);

      // The cleanup must actually be complete.
      const { data: leftRuns } = await admin
        .from("agent_runs")
        .select("id")
        .in("thread_id", groupThreadIds);
      const { data: leftMessages } = await admin
        .from("messages")
        .select("id")
        .in("thread_id", groupThreadIds);
      const { data: leftThreads } = await admin
        .from("threads")
        .select("id")
        .in("id", groupThreadIds);
      check(
        "the cleanup removed every group row",
        (leftRuns ?? []).length === 0 &&
          (leftMessages ?? []).length === 0 &&
          (leftThreads ?? []).length === 0,
        `runs=${(leftRuns ?? []).length} messages=${(leftMessages ?? []).length}`,
      );
    }
    if (allGroupRunIds.length) {
      await admin.from("agent_runs").delete().in("id", allGroupRunIds);
    }
    if (groupIds.length) {
      // Membership first, then the group: the FK cascades either way, but
      // this order leaves no window where an orphan row can survive.
      await admin.from("group_members").delete().in("group_id", groupIds);
      await admin.from("agent_groups").delete().in("id", groupIds).eq("user_id", userId);
    }
    if (groupAgentIds.length) {
      await admin.from("agents").delete().in("id", groupAgentIds).eq("user_id", userId);
    }
    await admin.from("notes").delete().eq("user_id", userId).like("path", "deployed-check-%");
    await admin.from("push_tokens").delete().eq("user_id", userId).like("expo_token", "%deployedcheck%");
    console.log("\ncleanup done");
  }

  const failed = checks.filter((entry) => !entry.ok);
  console.log(`${checks.length - failed.length}/${checks.length} checks passed.`);
  if (failed.length) process.exitCode = 1;
}

main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
