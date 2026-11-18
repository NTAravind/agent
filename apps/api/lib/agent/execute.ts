import { runAgent, type RunAgentInput } from "@/lib/agent/graph";
import { runSupervisor } from "@/lib/agent/supervisor";
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
