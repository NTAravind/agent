import { requireUser, toErrorResponse } from "@/lib/auth";
import { sleepAgent } from "@/lib/agent/sleep";

/**
 * POST /api/agents/:id/sleep — puts the agent to sleep: flips
 * `agents.sleeping` (POST /api/agents/run then rejects new tasks) and pauses
 * all of its active runs plus a supervisor's inline children.
 */
export async function POST(request: Request, context: { params: Promise<{ id: string }> }) {
  try {
    const user = await requireUser(request);
    const { id } = await context.params;
    const result = await sleepAgent(user.id, id);
    return Response.json(result);
  } catch (error) {
    return toErrorResponse(error);
  }
}
