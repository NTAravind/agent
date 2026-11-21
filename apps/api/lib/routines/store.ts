import type {
  Routine,
  RoutineApprovalMode,
  RoutineSchedule,
  RoutineStatus,
  RoutineWithPreview,
} from "@agent/shared";

import {
  computeNextRuns,
  DEFAULT_TIMEZONE,
  describeSchedule,
  scheduleToRRule,
} from "@/lib/routines/schedule";
import { supabaseAdmin } from "@/lib/supabase/server";

/**
 * Persistence for routines (Phase 10).
 *
 * The database is snake_case; the API is camelCase. Every query filters by
 * `user_id` explicitly — the service role bypasses RLS.
 */

export type RoutineRow = {
  id: string;
  user_id: string;
  agent_id: string | null;
  thread_id: string;
  name: string;
  prompt: string;
  schedule: RoutineSchedule;
  rrule: string | null;
  tz: string;
  source_text: string | null;
  status: RoutineStatus;
  approval_mode: RoutineApprovalMode;
  next_run_at: string | null;
  last_run_at: string | null;
  consecutive_failures: number;
  created_at: string;
  updated_at: string;
};

export const ROUTINE_COLUMNS =
  "id, user_id, agent_id, thread_id, name, prompt, schedule, rrule, tz, source_text, status, approval_mode, next_run_at, last_run_at, consecutive_failures, created_at, updated_at";

export function rowToRoutine(row: RoutineRow): Routine {
  return {
    id: row.id,
    userId: row.user_id,
    agentId: row.agent_id,
    threadId: row.thread_id,
    name: row.name,
    prompt: row.prompt,
    schedule: row.schedule,
    rrule: row.rrule,
    tz: row.tz,
    sourceText: row.source_text,
    status: row.status,
    approvalMode: row.approval_mode,
    nextRunAt: row.next_run_at,
    lastRunAt: row.last_run_at,
    consecutiveFailures: row.consecutive_failures,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
}

/** Adds the human-readable schedule and the next occurrences for the UI. */
export function withPreview(routine: Routine, now = new Date()): RoutineWithPreview {
  return {
    ...routine,
    scheduleLabel: describeSchedule(routine.schedule, routine.tz),
    nextRuns: computeNextRuns(routine.schedule, routine.tz, now, 3),
  };
}

export async function listRoutines(userId: string): Promise<Routine[]> {
  const { data, error } = await supabaseAdmin()
    .from("routines")
    .select(ROUTINE_COLUMNS)
    .eq("user_id", userId)
    .order("created_at", { ascending: false });

  if (error) throw new Error(`Could not list routines: ${error.message}`);
  return ((data ?? []) as RoutineRow[]).map(rowToRoutine);
}

export async function getRoutine(userId: string, routineId: string): Promise<Routine | null> {
  const { data, error } = await supabaseAdmin()
    .from("routines")
    .select(ROUTINE_COLUMNS)
    .eq("id", routineId)
    .eq("user_id", userId)
    .maybeSingle();

  if (error) throw new Error(`Could not read the routine: ${error.message}`);
  return data ? rowToRoutine(data as RoutineRow) : null;
}

export async function createRoutine(input: {
  userId: string;
  agentId: string | null;
  threadId: string;
  name: string;
  prompt: string;
  schedule: RoutineSchedule;
  tz?: string;
  sourceText?: string | null;
  approvalMode?: RoutineApprovalMode;
}): Promise<Routine> {
  const tz = input.tz ?? DEFAULT_TIMEZONE;
  const { data, error } = await supabaseAdmin()
    .from("routines")
    .insert({
      user_id: input.userId,
      agent_id: input.agentId,
      thread_id: input.threadId,
      name: input.name,
      prompt: input.prompt,
      schedule: input.schedule,
      rrule: scheduleToRRule(input.schedule),
      tz,
      source_text: input.sourceText ?? null,
      status: "draft",
      approval_mode: input.approvalMode ?? "queue",
      next_run_at: null,
      consecutive_failures: 0,
    })
    .select(ROUTINE_COLUMNS)
    .single();

  if (error || !data) {
    throw new Error(`Could not create the routine: ${error?.message ?? "insert failed"}`);
  }
  return rowToRoutine(data as RoutineRow);
}

/**
 * Updates a routine. A changed schedule or timezone re-derives the RRULE and
 * the next occurrence (an active routine must never keep a stale next run).
 */
export async function updateRoutine(
  userId: string,
  routineId: string,
  patch: {
    name?: string;
    prompt?: string;
    schedule?: RoutineSchedule;
    tz?: string;
    approvalMode?: RoutineApprovalMode;
    status?: RoutineStatus;
  },
  now = new Date(),
): Promise<Routine | null> {
  const current = await getRoutine(userId, routineId);
  if (!current) return null;

  const schedule = patch.schedule ?? current.schedule;
  const tz = patch.tz ?? current.tz;
  const status = patch.status ?? current.status;

  const update: Record<string, unknown> = {
    name: patch.name ?? current.name,
    prompt: patch.prompt ?? current.prompt,
    schedule,
    rrule: scheduleToRRule(schedule),
    tz,
    approval_mode: patch.approvalMode ?? current.approvalMode,
    status,
  };

  // The next run only exists for an active routine; recompute it whenever
  // the timing changed.
  if (status === "active") {
    const next = computeNextRuns(schedule, tz, now, 1)[0] ?? null;
    update.next_run_at = next;
  } else if (status === "draft" || status === "paused") {
    update.next_run_at = null;
  }

  const { data, error } = await supabaseAdmin()
    .from("routines")
    .update(update)
    .eq("id", routineId)
    .eq("user_id", userId)
    .select(ROUTINE_COLUMNS)
    .single();

  if (error || !data) {
    throw new Error(`Could not update the routine: ${error?.message ?? "update failed"}`);
  }
  return rowToRoutine(data as RoutineRow);
}

/** Activates a draft or paused routine and schedules its first run. */
export async function activateRoutine(
  userId: string,
  routineId: string,
  now = new Date(),
): Promise<Routine | null> {
  const current = await getRoutine(userId, routineId);
  if (!current) return null;

  const next = computeNextRuns(current.schedule, current.tz, now, 1)[0] ?? null;
  const { data, error } = await supabaseAdmin()
    .from("routines")
    .update({
      status: "active",
      next_run_at: next,
      consecutive_failures: 0,
    })
    .eq("id", routineId)
    .eq("user_id", userId)
    .select(ROUTINE_COLUMNS)
    .single();

  if (error || !data) {
    throw new Error(`Could not activate the routine: ${error?.message ?? "update failed"}`);
  }
  return rowToRoutine(data as RoutineRow);
}

export async function deleteRoutine(userId: string, routineId: string): Promise<boolean> {
  const { data, error } = await supabaseAdmin()
    .from("routines")
    .delete()
    .eq("id", routineId)
    .eq("user_id", userId)
    .select("id");

  if (error) throw new Error(`Could not delete the routine: ${error.message}`);
  return Boolean(data?.length);
}

/** The routines whose next run is due (used by the scheduler). */
export async function listDueRoutines(now = new Date()): Promise<Routine[]> {
  const { data, error } = await supabaseAdmin()
    .from("routines")
    .select(ROUTINE_COLUMNS)
    .eq("status", "active")
    .not("next_run_at", "is", null)
    .lte("next_run_at", now.toISOString())
    .order("next_run_at", { ascending: true })
    .limit(50);

  if (error) throw new Error(`Could not read due routines: ${error.message}`);
  return ((data ?? []) as RoutineRow[]).map(rowToRoutine);
}

/** Moves a routine's next run forward after a tick. */
export async function advanceRoutine(
  routineId: string,
  update: {
    nextRunAt: string | null;
    lastRunAt: string;
    status?: RoutineStatus;
    consecutiveFailures?: number;
  },
): Promise<void> {
  const { error } = await supabaseAdmin()
    .from("routines")
    .update({
      next_run_at: update.nextRunAt,
      last_run_at: update.lastRunAt,
      ...(update.status ? { status: update.status } : {}),
      ...(update.consecutiveFailures !== undefined
        ? { consecutive_failures: update.consecutiveFailures }
        : {}),
    })
    .eq("id", routineId);
  if (error) console.warn("[routines] could not advance the routine:", error.message);
}

/** Records a failed occurrence; returns the new failure streak. */
export async function recordRoutineFailure(routineId: string): Promise<number> {
  const { data } = await supabaseAdmin()
    .from("routines")
    .select("consecutive_failures")
    .eq("id", routineId)
    .maybeSingle();
  const failures = ((data as { consecutive_failures?: number } | null)?.consecutive_failures ?? 0) + 1;
  await supabaseAdmin()
    .from("routines")
    .update({ consecutive_failures: failures })
    .eq("id", routineId);
  return failures;
}

/**
 * The context a routine tool needs for one agent run: the thread the
 * routine posts into, the agent it belongs to and the user's timezone.
 * Everything comes from the run row — never from the model's arguments.
 */
export async function routineContextForRun(
  userId: string,
  runId: string,
): Promise<{ threadId: string | null; agentId: string | null; timeZone: string }> {
  const { data } = await supabaseAdmin()
    .from("agent_runs")
    .select("thread_id, agent_id, tz")
    .eq("id", runId)
    .eq("user_id", userId)
    .maybeSingle();

  const row = data as { thread_id?: string | null; agent_id?: string | null; tz?: string | null } | null;
  return {
    threadId: row?.thread_id ?? null,
    agentId: row?.agent_id ?? null,
    timeZone: row?.tz ?? DEFAULT_TIMEZONE,
  };
}

/** The runs a routine has produced (newest first). */
export async function listRoutineRuns(userId: string, routineId: string, limit = 20) {  const { data, error } = await supabaseAdmin()
    .from("agent_runs")
    .select("id, routine_id, goal, status, model, tokens_used, scheduled_for, created_at, finished_at")
    .eq("user_id", userId)
    .eq("routine_id", routineId)
    .order("created_at", { ascending: false })
    .limit(limit);

  if (error) throw new Error(`Could not list the routine's runs: ${error.message}`);
  return (data ?? []) as Array<{
    id: string;
    routine_id: string | null;
    goal: string;
    status: string;
    model: string | null;
    tokens_used: number | null;
    scheduled_for: string | null;
    created_at: string;
    finished_at: string | null;
  }>;
}
