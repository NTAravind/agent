import type { RunEventType, RunStatus } from "@agent/shared";

import type { AgentFinding } from "@/lib/agent/state";

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
}): Promise<{ id: string; status: RunStatus }> {
  const { data, error } = await supabaseAdmin()
    .from("agent_runs")
    .insert({
      user_id: input.userId,
      goal: input.goal,
      thread_id: input.threadId ?? null,
      agent_id: input.agentId ?? null,
      status: "queued",
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
  await supabaseAdmin().from("agent_runs").update(patch).eq("id", runId);
}

export async function appendRunEvent(
  runId: string,
  type: RunEventType,
  payload?: Record<string, unknown>,
): Promise<void> {
  await supabaseAdmin().from("run_events").insert({
    run_id: runId,
    type,
    payload: payload ?? null,
  });
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
    .select("id, goal, status, model, tokens_used, created_at, finished_at")
    .eq("user_id", userId)
    .order("created_at", { ascending: false })
    .limit(limit);

  return data ?? [];
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
