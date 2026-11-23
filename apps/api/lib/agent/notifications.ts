import { sendPush } from "@/lib/push";
import { supabaseAdmin } from "@/lib/supabase/server";

/** Notify the owner for top-level, non-routine agent tasks. */
export async function notifyRunOutcome(input: {
  runId: string;
  userId: string;
  status: "succeeded" | "failed";
  result?: string;
}): Promise<void> {
  const { data: run, error } = await supabaseAdmin()
    .from("agent_runs")
    .select("goal, thread_id, routine_id, parent_run_id, error")
    .eq("id", input.runId)
    .eq("user_id", input.userId)
    .maybeSingle();

  if (error || !run || run.routine_id || run.parent_run_id) return;

  const succeeded = input.status === "succeeded";
  const detail = succeeded
    ? input.result?.trim() || String(run.goal ?? "")
    : String(run.error ?? "The agent task failed.");

  try {
    await sendPush(input.userId, [{
      title: succeeded ? "Agent task complete" : "Agent task failed",
      body: detail.slice(0, 160),
      data: {
        type: "agent-run",
        runId: input.runId,
        ...(run.thread_id ? { threadId: run.thread_id } : {}),
        url: `/run?id=${input.runId}`,
      },
    }]);
  } catch (pushError) {
    // Notification delivery is best-effort and must not change the run result.
    console.warn("[agent/notifications] could not send run outcome push:", pushError);
  }
}

/** Resolve the owner for exhausted Inngest retries and notify after failure. */
export async function notifyFailedRun(runId: string): Promise<void> {
  const { data: run } = await supabaseAdmin()
    .from("agent_runs")
    .select("user_id")
    .eq("id", runId)
    .maybeSingle();
  if (run?.user_id) {
    await notifyRunOutcome({ runId, userId: run.user_id, status: "failed" });
  }
}
