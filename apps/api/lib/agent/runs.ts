import type { RunEventType, RunStatus } from "@agent/shared";

import type { AgentFinding } from "@/lib/agent/state";

import { loadAgentSummaries } from "@/lib/agents";
import type { PerfTraceEvent } from "@/lib/perf";
import { supabaseAdmin } from "@/lib/supabase/server";

/**
 * Persistence for agent runs and their timeline events.
 * Written by the graph nodes as the run progresses; read by the API routes
 * that power the timeline UI.
 */

export async function createRun(input: {
  userId: string;
  goal: string;
  threadId?: string | null;
  agentId?: string | null;
  model?: string | null;
  /** Supervisor runs set this so children nest under the parent timeline. */
  parentRunId?: string | null;
  /** The user's timezone — relative dates in the goal resolve against it. */
  tz?: string | null;
  /** Set when the run was fired by a routine (Phase 10). */
  routineId?: string | null;
  /** The occurrence instant a routine run fired for. */
  scheduledFor?: string | null;
  /** Group this run belongs to (Phase 11). */
  groupId?: string | null;
  /** Persisted, bounded context for a group member turn. */
  groupContext?: Record<string, unknown> | null;
  /** Nested-ask depth for a group member turn. */
  groupDepth?: number;
}): Promise<{ id: string; status: RunStatus }> {
  const { data, error } = await supabaseAdmin()
    .from("agent_runs")
    .insert({
      user_id: input.userId,
      goal: input.goal,
      thread_id: input.threadId ?? null,
      agent_id: input.agentId ?? null,
      parent_run_id: input.parentRunId ?? null,
      status: "queued",
      model: input.model ?? null,
      tz: input.tz ?? "Asia/Kolkata",
      ...(input.routineId ? { routine_id: input.routineId } : {}),
      ...(input.scheduledFor ? { scheduled_for: input.scheduledFor } : {}),
      ...(input.groupId ? { group_id: input.groupId } : {}),
      group_context: input.groupContext ?? {},
      group_depth: input.groupDepth ?? 0,
    })
    .select("id, status")
    .single();

  if (error || !data) {
    throw new Error(`Could not create the run: ${error?.message ?? "insert failed"}`);
  }

  return { id: data.id as string, status: data.status as RunStatus };
}

export async function updateRun(
  runId: string,
  patch: Partial<{
    status: RunStatus;
    result: unknown;
    error: string | null;
    model: string | null;
    tokens_used: number;
    finished_at: string | null;
  }>,
): Promise<void> {
  try {
    const { error } = await supabaseAdmin().from("agent_runs").update(patch).eq("id", runId);
    if (error) console.warn("[agent/runs] could not update run:", error.message);
  } catch (error) {
    console.warn("[agent/runs] could not update run:", error);
  }
}

/**
 * Writes one row to run_events. Never throws: the timeline is observability,
 * it must not break a run (e.g. before the migration is applied).
 */
export async function appendRunEvent(
  runId: string,
  type: RunEventType,
  payload?: Record<string, unknown>,
): Promise<void> {
  try {
    const { error } = await supabaseAdmin().from("run_events").insert({
      run_id: runId,
      type,
      payload: payload ?? null,
    });
    if (error) console.warn("[agent/runs] could not append event:", error.message);
  } catch (error) {
    console.warn("[agent/runs] could not append event:", error);
  }
}

/**
 * Persists one Phase 0 performance sample on a run timeline. Telemetry is
 * emitted only when PERF_TRACE=1 and never contains prompts or tool payloads.
 */
export async function appendPerfRunEvent(
  runId: string,
  event: PerfTraceEvent,
): Promise<void> {
  await appendRunEvent(runId, "perf", { ...event });
}

export async function getRunWithEvents(runId: string, userId: string): Promise<{
  run: Record<string, unknown> | null;
  events: Array<Record<string, unknown>>;
} | null> {
  const { data: run } = await supabaseAdmin()
    .from("agent_runs")
    .select("*")
    .eq("id", runId)
    .eq("user_id", userId)
    .maybeSingle();

  if (!run) return null;

  const { data: events } = await supabaseAdmin()
    .from("run_events")
    .select("id, run_id, type, payload, created_at")
    .eq("run_id", runId)
    .order("id", { ascending: true });

  return { run, events: events ?? [] };
}

export async function listRuns(userId: string, limit = 30): Promise<Record<string, unknown>[]> {
  const { data } = await supabaseAdmin()
    .from("agent_runs")
    .select("id, goal, status, model, tokens_used, created_at, finished_at, agent_id, group_id")
    .eq("user_id", userId)
    // Child runs nest under their supervisor's detail, never the top list.
    .is("parent_run_id", null)
    .order("created_at", { ascending: false })
    .limit(limit);

  const rows = (data ?? []) as { agent_id: string | null }[];
  const summaries = await loadAgentSummaries(rows.map((row) => row.agent_id), userId);
  return rows.map((row) => ({
    ...row,
    agent: row.agent_id ? (summaries.get(row.agent_id) ?? null) : null,
  }));
}

/**
 * Supervisor children for the nested timeline: one row per child run with its
 * agent summary, oldest first (creation order matches the delegation order).
 */
export async function listChildRuns(
  parentRunId: string,
  userId: string,
): Promise<Record<string, unknown>[]> {
  const { data } = await supabaseAdmin()
    .from("agent_runs")
    .select("id, goal, status, model, tokens_used, created_at, finished_at, result, agent_id, parent_run_id, group_id, group_depth")
    .eq("parent_run_id", parentRunId)
    .eq("user_id", userId)
    .order("created_at", { ascending: true });

  const rows = (data ?? []) as { agent_id: string | null }[];
  const summaries = await loadAgentSummaries(rows.map((row) => row.agent_id), userId);
  return rows.map((row) => ({
    ...row,
    agent: row.agent_id ? (summaries.get(row.agent_id) ?? null) : null,
  }));
}

/** Statuses a run can still be acted on (pause, cancel, sleep). */
export const ACTIVE_RUN_STATUSES = ["queued", "running", "awaiting_approval"] as const;

/** One run row for the action routes (ownership enforced by the caller). */
export type RunActionRow = {
  id: string;
  status: string;
  agent_id: string | null;
  parent_run_id: string | null;
};

export async function loadRunForUser(
  runId: string,
  userId: string,
): Promise<RunActionRow | null> {
  const { data } = await supabaseAdmin()
    .from("agent_runs")
    .select("id, status, agent_id, parent_run_id")
    .eq("id", runId)
    .eq("user_id", userId)
    .maybeSingle();
  return (data as RunActionRow | null) ?? null;
}

export const runError = (message: string, status: number, code: string): Error =>
  Object.assign(new Error(message), { status, code });

export async function cancelRun(userId: string, runId: string): Promise<void> {
  await supabaseAdmin()
    .from("agent_runs")
    .update({ status: "cancelled", finished_at: new Date().toISOString() })
    .eq("id", runId)
    .eq("user_id", userId)
    .in("status", [...ACTIVE_RUN_STATUSES, "paused"]);
  // Supervisor children execute inline inside the parent's fan_out — cancelling
  // the parent must stop them too (their wrappers throw RunCancelledError).
  await supabaseAdmin()
    .from("agent_runs")
    .update({ status: "cancelled", finished_at: new Date().toISOString() })
    .eq("parent_run_id", runId)
    .eq("user_id", userId)
    .in("status", [...ACTIVE_RUN_STATUSES, "paused"]);
}

/**
 * Pauses one run (and, for a supervisor, its unfinished children): the status
 * flip is the whole change — the graph stops at its next node boundary.
 * Idempotent when the run is already paused.
 */
export async function pauseRun(
  userId: string,
  runId: string,
): Promise<{ status: string; pausedChildren: number }> {
  const run = await loadRunForUser(runId, userId);
  if (!run) throw runError("No such run.", 404, "not_found");
  if (run.status === "paused") return { status: "paused", pausedChildren: 0 };
  if (!ACTIVE_RUN_STATUSES.includes(run.status as (typeof ACTIVE_RUN_STATUSES)[number])) {
    throw runError("This task has already finished.", 409, "conflict");
  }

  await supabaseAdmin()
    .from("agent_runs")
    .update({ status: "paused" })
    .eq("id", runId)
    .in("status", ACTIVE_RUN_STATUSES);

  // Children run inline in the supervisor's fan_out — pause them too so the
  // parent's fan_out returns quickly instead of waiting them out.
  const { data: children } = await supabaseAdmin()
    .from("agent_runs")
    .update({ status: "paused" })
    .eq("parent_run_id", runId)
    .eq("user_id", userId)
    .in("status", ACTIVE_RUN_STATUSES)
    .select("id");

  return { status: "paused", pausedChildren: children?.length ?? 0 };
}

/**
 * Marks a run failed when the Inngest function exhausts its retries.
 */
export async function failRun(runId: string, error: string): Promise<void> {
  await updateRun(runId, {
    status: "failed",
    error: error.slice(0, 500),
    finished_at: new Date().toISOString(),
  });
}
