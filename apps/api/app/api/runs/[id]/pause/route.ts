import { requireUser, toErrorResponse } from "@/lib/auth";
import { pauseRun } from "@/lib/agent/runs";

/**
 * POST /api/runs/:id/pause — pause one task (and a supervisor's unfinished
 * children). Only flips status rows; the graph stops at its next node
 * boundary and `POST /api/runs/:id/resume` continues from the checkpoint.
 * Idempotent when the run is already paused.
 */
export async function POST(request: Request, context: { params: Promise<{ id: string }> }) {
  try {
    const user = await requireUser(request);
    const { id } = await context.params;
    const result = await pauseRun(user.id, id);
    return Response.json(result);
  } catch (error) {
    return toErrorResponse(error);
  }
}
