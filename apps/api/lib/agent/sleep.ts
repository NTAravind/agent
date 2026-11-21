import { ACTIVE_RUN_STATUSES, runError } from "@/lib/agent/runs";
import { inngest } from "@/lib/inngest/client";
import { runResumed } from "@/lib/inngest/events";
import { supabaseAdmin } from "@/lib/supabase/server";

/**
 * Agent sleep / wake.
 *
 * Sleep flips `agents.sleeping` (POST /api/agents/run rejects new tasks until
 * wake) and pauses the agent's active runs — plus, for a supervisor, the
 * unfinished children that execute inline inside its fan_out node.
 *
 * Wake clears the flag and re-emits `run/resumed` for every paused run of the
 * agent *plus the paused parents of its paused children*: when a specialist
 * sleeps mid-fan-out, its supervisor parks too, and both must come back.
 * (Paused children of a still-paused supervisor are left alone — the parent's
 * fan_out node resumes them itself from its own checkpoint.)
 */

const pauseByIds = async (userId: string, ids: string[]): Promise<number> => {
  if (ids.length === 0) return 0;
  const { data } = await supabaseAdmin()
    .from("agent_runs")
    .update({ status: "paused" })
    .eq("user_id", userId)
    .in("id", ids)
    .in("status", ACTIVE_RUN_STATUSES)
    .select("id");
  return data?.length ?? 0;
};

export async function sleepAgent(
  userId: string,
  agentId: string,
): Promise<{ sleeping: true; pausedRuns: number }> {
  const { data: agent } = await supabaseAdmin()
    .from("agents")
    .update({ sleeping: true })
    .eq("id", agentId)
    .eq("user_id", userId)
    .select("id");
  if (!agent?.length) throw runError("Unknown agent.", 404, "not_found");

  const { data: active } = await supabaseAdmin()
    .from("agent_runs")
    .select("id")
    .eq("user_id", userId)
    .eq("agent_id", agentId)
    .in("status", ACTIVE_RUN_STATUSES);
  const ids = (active ?? []).map((row) => row.id as string);

  let paused = await pauseByIds(userId, ids);
  if (ids.length > 0) {
    // Supervisor children run inline in the parent's fan_out — pause them so
    // the parent's boundary check trips too instead of waiting them out.
    const { data: children } = await supabaseAdmin()
      .from("agent_runs")
      .select("id")
      .eq("user_id", userId)
      .in("parent_run_id", ids)
      .in("status", ACTIVE_RUN_STATUSES);
    paused += await pauseByIds(
      userId,
      (children ?? []).map((row) => row.id as string),
    );
  }

  return { sleeping: true, pausedRuns: paused };
}

export async function wakeAgent(
  userId: string,
  agentId: string,
): Promise<{ sleeping: false; resumedRuns: number }> {
  const { data: agent } = await supabaseAdmin()
    .from("agents")
    .update({ sleeping: false })
    .eq("id", agentId)
    .eq("user_id", userId)
    .select("id");
  if (!agent?.length) throw runError("Unknown agent.", 404, "not_found");

  const { data: paused } = await supabaseAdmin()
    .from("agent_runs")
    .select("id")
    .eq("user_id", userId)
    .eq("agent_id", agentId)
    .eq("status", "paused");
  const ids = (paused ?? []).map((row) => row.id as string);

  // Paused supervisors whose paused child belongs to this agent.
  const { data: parents } = ids.length
    ? await supabaseAdmin()
        .from("agent_runs")
        .select("id")
        .eq("user_id", userId)
        .eq("status", "paused")
        .in("parent_run_id", ids)
    : { data: [] };
  const allIds = [...ids, ...(parents ?? []).map((row) => row.id as string)];

  for (const runId of allIds) {
    await inngest.send(runResumed.create({ runId, userId }));
  }

  return { sleeping: false, resumedRuns: allIds.length };
}
