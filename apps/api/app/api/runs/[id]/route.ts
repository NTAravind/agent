import { requireUser, toErrorResponse } from "@/lib/auth";
import { getRunWithEvents } from "@/lib/agent/runs";
import { loadAgentSummaries } from "@/lib/agents";
import { listPendingByRun } from "@/lib/approvals";

/**
 * GET /api/runs/:id — one run plus its timeline events, the run's agent
 * (name + resolved avatar) and any pending approvals (the timeline UI polls
 * this while the run is in flight).
 */
export async function GET(request: Request, context: { params: Promise<{ id: string }> }) {
  try {
    const user = await requireUser(request);
    const { id } = await context.params;

    const data = await getRunWithEvents(id);
    if (!data || (data.run as { user_id?: string }).user_id !== user.id) {
      return Response.json(
        { error: { code: "not_found", message: "No such run." } },
        { status: 404 },
      );
    }

    const agentId = (data.run as { agent_id?: string | null }).agent_id ?? null;
    const [pendingApprovals, summaries] = await Promise.all([
      listPendingByRun(id),
      loadAgentSummaries([agentId]),
    ]);
    const agent = agentId ? (summaries.get(agentId) ?? null) : null;

    return Response.json({ ...data, agent, pendingApprovals });
  } catch (error) {
    return toErrorResponse(error);
  }
}
