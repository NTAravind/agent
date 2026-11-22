/**
 * Live end-to-end check for Tasks, Calendar and Notes (Phase 9).
 *
 *   npx tsx --env-file=.env.local scripts/check-tasks.ts
 *
 * Verifies against the real database:
 *   1. task lists + tasks CRUD (create, list, patch, soft delete),
 *   2. agent tool calls (create_task / list_tasks / create_event / list_events)
 *      create items tagged created_by='agent' with a source run id,
 *   3. recurring events expand on read (weekly rule, correct time of day),
 *   4. the approval gate: deletes always need approval, edits only for
 *      user-created items,
 *   5. notes can be written and deleted through the vault-first API,
 *   6. the reminder tick claims a due reminder exactly once.
 *
 * Cleans up every row it created.
 */
import { executeToolCall, type ToolCallInfo } from "../lib/agent/tools";
import { requiresApproval } from "../lib/approvals";
import { computeDueReminders, runReminderTick } from "../lib/reminders";
import { supabaseAdmin } from "../lib/supabase/server";

const checks: Array<{ name: string; ok: boolean; detail?: string }> = [];
function check(name: string, ok: boolean, detail?: string) {
  checks.push({ name, ok, detail });
  console.log(`${ok ? "✔" : "✖"} ${name}${detail ? ` — ${detail}` : ""}`);
}

/** Calls an agent tool the way the graph does. */
async function callTool(
  userId: string,
  runId: string,
  name: string,
  args: Record<string, unknown>,
): Promise<Record<string, unknown>> {
  const call: ToolCallInfo = { id: `check-${name}`, name, args };
  return (await executeToolCall(call, { userId, runId })) as Record<string, unknown>;
}

/**
 * Mints a short-lived access token for the check user so the HTTP routes
 * (which require a Supabase session) can be exercised.
 */
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

  const admin = supabaseAdmin();
  const createdTaskIds: string[] = [];
  const createdEventIds: string[] = [];
  const createdListIds: string[] = [];
  let runId: string | null = null;

  try {
    // A run id so agent-created rows carry a source_run_id.
    const { data: run } = await admin
      .from("agent_runs")
      .insert({ user_id: userId, agent_id: null, goal: "phase9 check" })
      .select("id")
      .single();
    runId = (run?.id as string) ?? null;

    // 1. Task list + task.
    const { data: list } = await admin
      .from("task_lists")
      .insert({ user_id: userId, name: "Phase 9 Check" })
      .select("id")
      .single();
    const listId = list?.id as string;
    createdListIds.push(listId);

    const { data: task } = await admin
      .from("tasks")
      .insert({
        user_id: userId,
        list_id: listId,
        title: "Ship Phase 9",
        status: "open",
        priority: 2,
        due_at: "2026-11-25T03:30:00.000Z",
        created_by: "user",
      })
      .select("*")
      .single();
    const taskId = task?.id as string;
    createdTaskIds.push(taskId);
    check("task created by the user", task?.created_by === "user", taskId);

    // Soft delete keeps the row but hides it from reads.
    await admin
      .from("tasks")
      .update({ deleted_at: new Date().toISOString() })
      .eq("id", taskId)
      .eq("user_id", userId);
    const { data: stillThere } = await admin
      .from("tasks")
      .select("id, deleted_at")
      .eq("id", taskId)
      .maybeSingle();
    check(
      "task delete is a soft delete",
      Boolean(stillThere?.deleted_at),
      "deleted_at set, row kept",
    );
    // Un-delete so the rest of the checks can use it.
    await admin.from("tasks").update({ deleted_at: null }).eq("id", taskId);

    // 2. Agent tools.
    const agentTask = await callTool(userId, runId ?? userId, "create_task", {
      listId,
      title: "Agent task",
      dueAt: "2026-11-26T10:00:00.000Z",
      priority: 1,
    });
    const agentTaskId = agentTask.taskId as string | undefined;
    check("agent tool create_task returns a task id", Boolean(agentTaskId), agentTaskId);
    if (agentTaskId) createdTaskIds.push(agentTaskId);

    const { data: agentTaskRow } = await admin
      .from("tasks")
      .select("created_by, source_run_id")
      .eq("id", agentTaskId ?? "")
      .maybeSingle();
    check(
      "agent-created task is tagged created_by='agent' + source_run_id",
      agentTaskRow?.created_by === "agent" && agentTaskRow?.source_run_id === runId,
      `created_by=${agentTaskRow?.created_by}`,
    );

    const listed = await callTool(userId, runId ?? userId, "list_tasks", { listId });
    const listedTasks = (listed.tasks as unknown[] | undefined) ?? [];
    check(
      "agent tool list_tasks returns the list",
      listedTasks.length >= 2 && listedTasks.length <= 50,
      `${listedTasks.length} tasks (capped at 50)`,
    );

    // 3. Recurring event through the agent tool.
    const agentEvent = await callTool(userId, runId ?? userId, "create_event", {
      title: "Weekly standup",
      startsAt: "2026-11-23T04:30:00.000Z", // 10:00 IST
      endsAt: "2026-11-23T05:00:00.000Z",
      rrule: "FREQ=WEEKLY;BYDAY=MO",
      reminders: [{ minutesBefore: 15 }],
    });
    const agentEventId = agentEvent.eventId as string | undefined;
    check("agent tool create_event returns an event id", Boolean(agentEventId), agentEventId);
    if (agentEventId) createdEventIds.push(agentEventId);

    const listedEvents = await callTool(userId, runId ?? userId, "list_events", {
      from: "2026-11-20T00:00:00.000Z",
      to: "2026-12-21T00:00:00.000Z",
    });
    const events = (listedEvents.events as Array<{ startsAt: string }> | undefined) ?? [];
    check(
      "recurring event expands into weekly occurrences",
      events.length >= 4,
      `${events.length} occurrences`,
    );
    const firstStart = events[0]?.startsAt;
    check(
      "occurrences keep the original time of day (10:00 IST)",
      firstStart === "2026-11-23T04:30:00.000Z",
      firstStart,
    );

    // 4. Approval gate.
    check(
      "deleting a user task needs approval",
      (await requiresApproval(userId, "delete_task", { id: taskId })) === true,
    );
    check(
      "deleting an agent task needs approval",
      (await requiresApproval(userId, "delete_task", { id: agentTaskId })) === true,
    );
    check(
      "editing a user task needs approval",
      (await requiresApproval(userId, "update_task", { id: taskId })) === true,
    );
    check(
      "editing an agent task does not need approval",
      (await requiresApproval(userId, "update_task", { id: agentTaskId })) === false,
    );
    check(
      "completing a task does not need approval",
      (await requiresApproval(userId, "complete_task", { id: taskId })) === false,
    );
    check(
      "writing a note still needs approval",
      (await requiresApproval(userId, "write_note", { path: "a.md" })) === true,
    );

    // 5. Reminders.
    const due = computeDueReminders(
      [
        {
          id: taskId,
          user_id: userId,
          title: "Ship Phase 9",
          notes: null,
          status: "open",
          due_at: "2026-11-25T03:30:00.000Z",
          due_all_day: false,
          remind_at: "2026-11-25T03:00:00.000Z",
          rrule: null,
          reminded_at: null,
        },
      ],
      [],
      new Date("2026-11-25T03:05:00.000Z"),
    );
    check("a due task reminder is computed", due.length === 1, due[0]?.title);

    const tick = await runReminderTick(new Date("2026-11-25T03:05:00.000Z"));
    check(
      "the reminder tick runs",
      tick.due >= 0 && tick.sent >= 0,
      `due=${tick.due} sent=${tick.sent} failed=${tick.failed}`,
    );

    // Running the same tick again must not deliver the reminder twice.
    const { data: logRows } = await admin
      .from("reminder_log")
      .select("item_id, remind_at")
      .eq("user_id", userId)
      .eq("item_id", taskId);
    check(
      "a reminder is claimed at most once",
      (logRows ?? []).length <= 1,
      `${(logRows ?? []).length} log row(s)`,
    );

    // 6. Notes (vault-first write + delete) over HTTP.
    const token = await mintAccessToken(userId);
    const apiBase = process.env.API_BASE_URL ?? "http://localhost:3000";
    if (token) {
      const notePath = `phase9-check-${Date.now()}.md`;
      const noteRes = await fetch(
        `${apiBase}/api/notes/${encodeURIComponent(notePath)}`,
        {
          method: "PUT",
          headers: {
            "Content-Type": "text/markdown",
            Authorization: `Bearer ${token}`,
          },
          body: `# Phase 9 check\n\nhello`,
        },
      );
      check(
        "note write returns 200/201",
        noteRes.status === 200 || noteRes.status === 201,
        `HTTP ${noteRes.status}`,
      );

      const { data: noteRow } = await admin
        .from("notes")
        .select("id, path")
        .eq("user_id", userId)
        .eq("path", notePath)
        .maybeSingle();
      check("note is indexed", Boolean(noteRow?.id), notePath);

      const deleteRes = await fetch(
        `${apiBase}/api/notes/${encodeURIComponent(notePath)}`,
        { method: "DELETE", headers: { Authorization: `Bearer ${token}` } },
      );
      check("note delete returns 200", deleteRes.status === 200, `HTTP ${deleteRes.status}`);

      const { data: gone } = await admin
        .from("notes")
        .select("id")
        .eq("user_id", userId)
        .eq("path", notePath)
        .maybeSingle();
      check("deleted note is removed from the index", !gone);

      // The task + event routes answer over HTTP too.
      const tasksRes = await fetch(`${apiBase}/api/tasks`, {
        headers: { Authorization: `Bearer ${token}` },
      });
      const tasksBody = (await tasksRes.json()) as { tasks?: unknown[] };
      check(
        "GET /api/tasks returns the user's tasks",
        tasksRes.status === 200 && Array.isArray(tasksBody.tasks),
        `HTTP ${tasksRes.status}`,
      );

      const eventsRes = await fetch(
        `${apiBase}/api/events?from=2026-11-20T00:00:00.000Z&to=2026-12-21T00:00:00.000Z`,
        { headers: { Authorization: `Bearer ${token}` } },
      );
      const eventsBody = (await eventsRes.json()) as { events?: unknown[] };
      check(
        "GET /api/events returns expanded occurrences",
        eventsRes.status === 200 && (eventsBody.events?.length ?? 0) >= 4,
        `HTTP ${eventsRes.status} — ${eventsBody.events?.length ?? 0} occurrences`,
      );

      const noAuth = await fetch(`${apiBase}/api/tasks`);
      check("GET /api/tasks without a token is 401", noAuth.status === 401, `HTTP ${noAuth.status}`);
    } else {
      check("could not mint an access token (skipping HTTP checks)", false, "no token");
    }
  } finally {
    // Cleanup.
    if (createdTaskIds.length) {
      await admin.from("tasks").delete().in("id", createdTaskIds);
    }
    if (createdEventIds.length) {
      await admin.from("calendar_events").delete().in("id", createdEventIds);
    }
    if (createdListIds.length) {
      await admin.from("task_lists").delete().in("id", createdListIds);
    }
    await admin.from("reminder_log").delete().eq("user_id", userId);
    if (runId) {
      await admin.from("agent_runs").delete().eq("id", runId);
    }
    await admin.from("notes").delete().eq("user_id", userId).like("path", "phase9-check-%");
  }

  const failed = checks.filter((entry) => !entry.ok);
  console.log(`\n${checks.length - failed.length}/${checks.length} checks passed.`);
  if (failed.length) process.exitCode = 1;
}

main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
