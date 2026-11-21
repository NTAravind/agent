import { runAgent, type RunAgentInput } from "@/lib/agent/graph";
import { runSupervisor } from "@/lib/agent/supervisor";
import { listPendingByRun } from "@/lib/approvals";
import { updateRun } from "@/lib/agent/runs";
import { supabaseAdmin } from "@/lib/supabase/server";

/**
 * Entry point for every durable agent run — picks the graph for the run's
 * agent. Supervisor agents fan out to specialist children (delegate → fan_out
 * → verify → merge); everything else runs the single-agent research graph.
 * Lives outside graph.ts so the single graph never imports the supervisor.
 */
export async function executeRun(
  input: RunAgentInput,
): Promise<{ status: string; result?: string }> {
  const { data: run } = await supabaseAdmin()
    .from("agent_runs")
    .select("agent_id")
    .eq("id", input.runId)
    .maybeSingle();

  const agentId = (run as { agent_id?: string | null } | null)?.agent_id ?? null;
  if (!agentId) return runAgent(input);

  const { data: agent } = await supabaseAdmin()
    .from("agents")
    .select("is_supervisor")
    .eq("id", agentId)
    .eq("user_id", input.userId)
    .maybeSingle();

  if (agent && (agent as { is_supervisor?: boolean }).is_supervisor) {
    return runSupervisor(input);
  }
  return runAgent(input);
}

/**
 * Resume entry for the `run/resumed` event (POST /api/runs/:id/resume and
 * agent wake). Idempotent: a duplicate event, or a run that finished or was
 * cancelled while the event was in flight, reports the status that won instead
 * of re-invoking the graph. The graph itself flips paused → running
 * (`beginResume`) and continues from its checkpoint.
 */
export async function resumeExecution(input: {
  runId: string;
  userId: string;
}): Promise<{ status: string; result?: string }> {
  const { data: run } = await supabaseAdmin()
    .from("agent_runs")
    .select("status, goal, model, routine_id")
    .eq("id", input.runId)
    .eq("user_id", input.userId)
    .maybeSingle();
  if (!run) return { status: "cancelled" };

  const row = run as {
    status: string;
    goal: string;
    model: string | null;
    routine_id?: string | null;
  };
  if (row.status !== "paused") return { status: row.status };

  // A run paused while parked on an approval must NOT be graph-resumed:
  // `invoke(null)` would resume the interrupt with an undefined value and the
  // tool gate would read the still-pending row as denied. Restore the parked
  // status instead — the approval decision itself resumes the graph later.
  const pending = await listPendingByRun(input.runId);
  const undecided = pending.filter(
    (approval) =>
      !approval.expires_at ||
      new Date(approval.expires_at).getTime() > Date.now(),
  );
  if (undecided.length > 0) {
    await updateRun(input.runId, { status: "awaiting_approval" });
    return { status: "awaiting_approval" };
  }

  // A routine-fired run keeps its approval policy across a resume: the
  // routine's `approval_mode` decides whether a sensitive call parks the run.
  let approvalMode: RunAgentInput["approvalMode"];
  if (row.routine_id) {
    const { data: routine } = await supabaseAdmin()
      .from("routines")
      .select("approval_mode")
      .eq("id", row.routine_id)
      .eq("user_id", input.userId)
      .maybeSingle();
    const mode = (routine as { approval_mode?: string } | null)?.approval_mode;
    approvalMode = mode === "deny" ? "deny" : "gate";
  }

  return await executeRun({
    runId: input.runId,
    userId: input.userId,
    goal: row.goal,
    preferredModel: row.model ?? undefined,
    resume: true,
    approvalMode,
  });
}
