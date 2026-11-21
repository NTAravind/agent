import { requireUser, toErrorResponse } from "@/lib/auth";
import { wakeAgent } from "@/lib/agent/sleep";

/**
 * POST /api/agents/:id/wake — wakes the agent: clears `agents.sleeping` and
 * queues `run/resumed` for every paused run of the agent plus the paused
 * supervisors waiting on its children.
 */
export async function POST(request: Request, context: { params: Promise<{ id: string }> }) {
  try {
    const user = await requireUser(request);
    const { id } = await context.params;
    const result = await wakeAgent(user.id, id);
    return Response.json(result);
  } catch (error) {
    return toErrorResponse(error);
  }
}
