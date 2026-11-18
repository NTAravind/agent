import type { RunEventType, RunStatus } from "@agent/shared";

import type { AgentFinding } from "@/lib/agent/state";

import { loadAgentSummaries } from "@/lib/agents";
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

export async function getRunWithEvents(runId: string): Promise<{
  run: Record<string, unknown> | null;
  events: Array<Record<string, unknown>>;
} | null> {
  const { data: run } = await supabaseAdmin()
    .from("agent_runs")
    .select("*")
    .eq("id", runId)
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
    .select("id, goal, status, model, tokens_used, created_at, finished_at, agent_id")
    .eq("user_id", userId)
    // Child runs nest under their supervisor's detail, never the top list.
    .is("parent_run_id", null)
    .order("created_at", { ascending: false })
    .limit(limit);

  const rows = (data ?? []) as { agent_id: string | null }[];
  const summaries = await loadAgentSummaries(rows.map((row) => row.agent_id));
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
): Promise<Record<string, unknown>[]> {
  const { data } = await supabaseAdmin()
    .from("agent_runs")
    .select("id, goal, status, model, tokens_used, created_at, finished_at, result, agent_id")
    .eq("parent_run_id", parentRunId)
    .order("created_at", { ascending: true });

  const rows = (data ?? []) as { agent_id: string | null }[];
  const summaries = await loadAgentSummaries(rows.map((row) => row.agent_id));
  return rows.map((row) => ({
    ...row,
    agent: row.agent_id ? (summaries.get(row.agent_id) ?? null) : null,
  }));
}

export async function cancelRun(userId: string, runId: string): Promise<void> {
  await supabaseAdmin()
    .from("agent_runs")
    .update({ status: "cancelled", finished_at: new Date().toISOString() })
    .eq("id", runId)
    .eq("user_id", userId)
    .in("status", ["queued", "running", "awaiting_approval"]);
}

/** Marks a run failed when the Inngest function exhausts its retries. */
export async function failRun(runId: string, error: string): Promise<void> {
  await updateRun(runId, {
    status: "failed",
    error: error.slice(0, 500),
    finished_at: new Date().toISOString(),
  });
}
