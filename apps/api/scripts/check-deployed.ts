/**
 * Live end-to-end check of the Phase 9 + Phase 10 routes against a deployed API.
 *
 *   npx tsx --env-file=.env.local scripts/check-deployed.ts [base-url]
 *
 * Defaults to the production deployment from the mobile app's env. Verifies
 * task lists, tasks, recurring events, push tokens, note editing and the
 * routine routes, then removes every row it created.
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
async function readJson(response: Response): Promise<any> {
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
  } finally {
    if (taskIds.length) await admin.from("tasks").delete().in("id", taskIds);
    if (eventIds.length) await admin.from("calendar_events").delete().in("id", eventIds);
    if (listIds.length) await admin.from("task_lists").delete().in("id", listIds);
    if (routineIds.length) {
      await admin.from("agent_runs").delete().in("routine_id", routineIds);
      await admin.from("routines").delete().in("id", routineIds);
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
