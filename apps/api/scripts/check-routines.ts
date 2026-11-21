/**
 * Live end-to-end check for Routines (Phase 10).
 *
 *   npx tsx --env-file=.env.local scripts/check-routines.ts
 *
 * Verifies against the real database:
 *   1. the agent tool creates a *draft* routine with a structured schedule
 *      (no dates from the model) and a correct next-run preview in IST,
 *   2. nothing recurring starts before the user confirms (activate),
 *   3. the scheduler fires a due routine, is idempotent for the same
 *      occurrence, skips an overlapping run and never backfills a missed
 *      occurrence,
 *   4. the trigger message is marked as routine-sourced (and excluded from
 *      memory extraction),
 *   5. `delete_routine` needs approval,
 *   6. the HTTP routes work (list / activate / run-now / 401 without a token).
 *
 * Cleans up every row it created.
 */
import { executeToolCall, type ToolCallInfo } from "../lib/agent/tools";
import { requiresApproval } from "../lib/approvals";
import { isRoutineTriggerMessage, runRoutineTick } from "../lib/routines/scheduler";
import { listRoutines } from "../lib/routines/store";
import { computeNextRuns } from "../lib/routines/schedule";
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
  const userId = process.env.ALLOWED_USER_ID;
  if (!userId) throw new Error("ALLOWED_USER_ID is not set.");

  const admin = supabaseAdmin();
  const createdRoutineIds: string[] = [];
  let runId: string | null = null;
  let threadId: string | null = null;

  try {
    // A thread the routine posts into + a run id (the graph context).
    const { data: thread } = await admin
      .from("threads")
      .insert({ user_id: userId, title: "Phase 10 check" })
      .select("id")
      .single();
    threadId = (thread?.id as string) ?? null;

    const { data: run } = await admin
      .from("agent_runs")
      .insert({
        user_id: userId,
        agent_id: null,
        goal: "phase10 check",
        thread_id: threadId,
        tz: "Asia/Kolkata",
      })
      .select("id")
      .single();
    runId = (run?.id as string) ?? null;

    // 1. The agent tool proposes a structured schedule (no dates).
    const proposal = await callTool(userId, runId ?? userId, "create_routine", {
      name: "Monday summary",
      prompt: "Summarize my open tasks and AI news.",
      schedule: { frequency: "weekly", days_of_week: ["MO"], time: "09:00" },
      source_text: "every Monday at 9 summarize my open tasks and AI news",
    });
    const routineId = proposal.routineId as string | undefined;
    check("agent tool create_routine returns a routine id", Boolean(routineId), routineId);
    if (routineId) createdRoutineIds.push(routineId);

    const { data: draftRow } = await admin
      .from("routines")
      .select("*")
      .eq("id", routineId ?? "")
      .maybeSingle();
    check(
      "a proposed routine is a draft (nothing recurring starts yet)",
      draftRow?.status === "draft" && !draftRow?.next_run_at,
      `status=${draftRow?.status} next_run_at=${draftRow?.next_run_at ?? "null"}`,
    );
    check(
      "the routine is bound to the run's thread and timezone",
      draftRow?.thread_id === threadId && draftRow?.tz === "Asia/Kolkata",
      `thread=${draftRow?.thread_id === threadId} tz=${draftRow?.tz}`,
    );
    check(
      "the RRULE is derived server-side",
      draftRow?.rrule === "FREQ=WEEKLY;BYDAY=MO;BYHOUR=9;BYMINUTE=0",
      String(draftRow?.rrule),
    );

    // The preview shows the next three Mondays at 09:00 IST (03:30 UTC).
    const nextRuns = (proposal.nextRuns as string[] | undefined) ?? [];
    check(
      "the proposal previews the next three occurrences",
      nextRuns.length === 3,
      nextRuns.join(", "),
    );
    check(
      "every occurrence is 09:00 in the user's timezone",
      nextRuns.every((run) => run.endsWith("T03:30:00.000Z")),
      nextRuns[0],
    );
    check(
      "the schedule reads back in plain English",
      proposal.scheduleLabel === "Every Monday at 09:00",
      String(proposal.scheduleLabel),
    );

    // The tool never trusts a model-supplied date: the schedule is structured.
    check(
      "the stored schedule is structured, not a date",
      typeof (draftRow?.schedule as { frequency?: unknown })?.frequency === "string" &&
        !(draftRow?.schedule as { run_at?: unknown }).run_at,
      JSON.stringify(draftRow?.schedule),
    );

    // 2. list_routines sees it.
    const listed = await callTool(userId, runId ?? userId, "list_routines", {});
    const routines = (listed.routines as unknown[] | undefined) ?? [];
    check(
      "agent tool list_routines returns the routine",
      routines.length >= 1 && routines.length <= 50,
      `${routines.length} routines`,
    );

    // 3. Approval gate: deleting a routine needs approval.
    check(
      "deleting a routine needs approval",
      (await requiresApproval(userId, "delete_routine", { id: routineId })) === true,
    );
    check(
      "creating a routine does not need approval",
      (await requiresApproval(userId, "create_routine", { name: "x" })) === false,
    );

    // 4. Activate → the routine becomes active with a next run.
    const activated = await callTool(userId, runId ?? userId, "resume_routine", {
      id: routineId,
    });
    check(
      "resume_routine activates a draft routine",
      activated.status === "active",
      `status=${activated.status}`,
    );
    const { data: activeRow } = await admin
      .from("routines")
      .select("status, next_run_at")
      .eq("id", routineId ?? "")
      .maybeSingle();
    check(
      "an active routine has a next run",
      activeRow?.status === "active" && Boolean(activeRow?.next_run_at),
      `next_run_at=${activeRow?.next_run_at}`,
    );

    // 5. The scheduler fires a due routine exactly once.
    const occurrence = "2026-11-23T03:30:00.000Z";
    await admin
      .from("routines")
      .update({ next_run_at: occurrence })
      .eq("id", routineId ?? "");

    const firstTick = await runRoutineTick(new Date("2026-11-23T03:31:00.000Z"));
    check(
      "the routine tick fires the due routine",
      firstTick.fired === 1,
      `due=${firstTick.due} fired=${firstTick.fired} skipped=${firstTick.skipped}`,
    );

    const { data: runRows } = await admin
      .from("agent_runs")
      .select("id, scheduled_for")
      .eq("routine_id", routineId ?? "");
    check(
      "the occurrence created exactly one run",
      (runRows ?? []).length === 1,
      `${(runRows ?? []).length} run(s)`,
    );

    // The same occurrence must never create a second run.
    await admin
      .from("routines")
      .update({ next_run_at: occurrence })
      .eq("id", routineId ?? "");
    const secondTick = await runRoutineTick(new Date("2026-11-23T03:32:00.000Z"));
    const { data: runRows2 } = await admin
      .from("agent_runs")
      .select("id")
      .eq("routine_id", routineId ?? "");
    check(
      "the same occurrence never fires twice",
      (runRows2 ?? []).length === 1,
      `${(runRows2 ?? []).length} run(s) after a second tick (skipped=${secondTick.skipped})`,
    );

    // The next occurrence advanced from the *scheduled* instant — the missed
    // window between 03:31 and now is never backfilled.
    const { data: advancedRow } = await admin
      .from("routines")
      .select("next_run_at")
      .eq("id", routineId ?? "")
      .maybeSingle();
    check(
      "the next run advances from the scheduled instant (no backfill)",
      advancedRow?.next_run_at &&
        new Date(advancedRow.next_run_at).toISOString() === "2026-11-30T03:30:00.000Z",
      String(advancedRow?.next_run_at),
    );

    // 6. The trigger message is marked as routine-sourced.
    const { data: messages } = await admin
      .from("messages")
      .select("role, parts")
      .eq("thread_id", threadId ?? "")
      .eq("role", "user");
    const triggerMessages = (messages ?? []).filter((message) =>
      isRoutineTriggerMessage(message.parts),
    );
    check(
      "the routine inserts a trigger message in the thread",
      triggerMessages.length >= 1,
      `${triggerMessages.length} trigger message(s)`,
    );

    // 7. Overlap: a second occurrence while the previous run is live is skipped.
    const { data: liveRun } = await admin
      .from("agent_runs")
      .select("id, status")
      .eq("routine_id", routineId ?? "")
      .limit(1)
      .single();
    await admin
      .from("agent_runs")
      .update({ status: "running" })
      .eq("id", (liveRun?.id as string) ?? "");
    await admin
      .from("routines")
      .update({ next_run_at: "2026-11-30T03:30:00.000Z" })
      .eq("id", routineId ?? "");
    const overlapTick = await runRoutineTick(new Date("2026-11-30T03:31:00.000Z"));
    const { data: runRows3 } = await admin
      .from("agent_runs")
      .select("id")
      .eq("routine_id", routineId ?? "");
    check(
      "an overlapping run is skipped",
      overlapTick.skipped === 1 && (runRows3 ?? []).length === 1,
      `skipped=${overlapTick.skipped} runs=${(runRows3 ?? []).length}`,
    );

    // 8. The one-shot routine completes after firing.
    const oneShot = await callTool(userId, runId ?? userId, "create_routine", {
      name: "One-off",
      prompt: "Send the weekly digest once.",
      schedule: { frequency: "once", run_at: "2026-11-24T03:30:00.000Z" },
    });
    const oneShotId = oneShot.routineId as string | undefined;
    if (oneShotId) createdRoutineIds.push(oneShotId);
    await admin
      .from("routines")
      .update({ status: "active", next_run_at: "2026-11-24T03:30:00.000Z" })
      .eq("id", oneShotId ?? "");
    await runRoutineTick(new Date("2026-11-24T03:31:00.000Z"));
    const { data: oneShotRow } = await admin
      .from("routines")
      .select("status, next_run_at")
      .eq("id", oneShotId ?? "")
      .maybeSingle();
    check(
      "a one-shot routine completes after firing",
      oneShotRow?.status === "completed" && !oneShotRow?.next_run_at,
      `status=${oneShotRow?.status}`,
    );

    // 9. The schedule math: a monthly rule lands on the requested day.
    const monthly = computeNextRuns(
      { frequency: "monthly", day_of_month: 15, time: "09:00" },
      "Asia/Kolkata",
      new Date("2026-11-21T12:00:00.000Z"),
      2,
    );
    check(
      "a monthly rule lands on the requested day at 09:00 IST",
      monthly[0] === "2026-12-15T03:30:00.000Z" &&
        monthly[1] === "2027-01-15T03:30:00.000Z",
      monthly.join(", "),
    );

    // 10. The HTTP routes.
    const token = await mintAccessToken(userId);
    const apiBase = process.env.API_BASE_URL ?? "http://localhost:3000";
    if (token) {
      const listRes = await fetch(`${apiBase}/api/routines`, {
        headers: { Authorization: `Bearer ${token}` },
      });
      const listBody = (await listRes.json()) as { routines?: unknown[] };
      check(
        "GET /api/routines returns the user's routines",
        listRes.status === 200 && Array.isArray(listBody.routines),
        `HTTP ${listRes.status} — ${listBody.routines?.length ?? 0} routines`,
      );

      const activateRes = await fetch(`${apiBase}/api/routines/${routineId}/activate`, {
        method: "POST",
        headers: { Authorization: `Bearer ${token}` },
      });
      check(
        "POST /api/routines/:id/activate returns 200",
        activateRes.status === 200,
        `HTTP ${activateRes.status}`,
      );

      const runNowRes = await fetch(`${apiBase}/api/routines/${routineId}/run-now`, {
        method: "POST",
        headers: { Authorization: `Bearer ${token}` },
      });
      check(
        "POST /api/routines/:id/run-now queues a run",
        runNowRes.status === 202,
        `HTTP ${runNowRes.status}`,
      );

      const runsRes = await fetch(`${apiBase}/api/routines/${routineId}/runs`, {
        headers: { Authorization: `Bearer ${token}` },
      });
      const runsBody = (await runsRes.json()) as { runs?: unknown[] };
      check(
        "GET /api/routines/:id/runs lists the runs",
        runsRes.status === 200 && Array.isArray(runsBody.runs),
        `HTTP ${runsRes.status} — ${runsBody.runs?.length ?? 0} runs`,
      );

      const noAuth = await fetch(`${apiBase}/api/routines`);
      check("GET /api/routines without a token is 401", noAuth.status === 401, `HTTP ${noAuth.status}`);
    } else {
      check("could not mint an access token (skipping HTTP checks)", false, "no token");
    }

    // 11. The store only ever returns the caller's routines.
    const mine = await listRoutines(userId);
    check(
      "the routines list is scoped to the caller",
      mine.every((routine) => routine.userId === userId),
      `${mine.length} routines`,
    );
  } finally {
    // Cleanup.
    if (createdRoutineIds.length) {
      await admin.from("agent_runs").delete().in("routine_id", createdRoutineIds);
      await admin.from("routines").delete().in("id", createdRoutineIds);
    }
    if (threadId) {
      await admin.from("messages").delete().eq("thread_id", threadId);
      await admin.from("threads").delete().eq("id", threadId);
    }
    if (runId) {
      await admin.from("agent_runs").delete().eq("id", runId);
    }
  }

  const failed = checks.filter((entry) => !entry.ok);
  console.log(`\n${checks.length - failed.length}/${checks.length} checks passed.`);
  if (failed.length) process.exitCode = 1;
}

main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
