import { requireUser, toErrorResponse } from "@/lib/auth";
import { getRunWithEvents, listChildRuns } from "@/lib/agent/runs";
import { loadAgentSummaries } from "@/lib/agents";
import { listPendingByRunTree } from "@/lib/approvals";

/**
 * GET /api/runs/:id — one run plus its timeline events, the run's agent
 * (name + resolved avatar), its supervisor children (nested timeline) and
 * any pending approvals (the timeline UI polls this while in flight).
 */
export async function GET(request: Request, context: { params: Promise<{ id: string }> }) {
  try {
    const user = await requireUser(request);
    const { id } = await context.params;

    const data = await getRunWithEvents(id, user.id);
    if (!data || (data.run as { user_id?: string }).user_id !== user.id) {
      return Response.json(
        { error: { code: "not_found", message: "No such run." } },
        { status: 404 },
      );
    }

    const agentId = (data.run as { agent_id?: string | null }).agent_id ?? null;
    const [pendingApprovals, summaries, children] = await Promise.all([
      listPendingByRunTree(id, user.id),
      loadAgentSummaries([agentId], user.id),
      listChildRuns(id, user.id),
    ]);
    const agent = agentId ? (summaries.get(agentId) ?? null) : null;

    return Response.json({ ...data, agent, children, pendingApprovals });
  } catch (error) {
    return toErrorResponse(error);
  }
}
