import { requireUser, toErrorResponse } from "@/lib/auth";
import { cancelRun, loadRunForUser, runError } from "@/lib/agent/runs";

/**
 * POST /api/runs/:id/cancel — cancels an unfinished task (and a supervisor's
 * unfinished children). The graph's node boundaries observe the status flip
 * and stop without failing the run. Idempotent when already cancelled.
 */
export async function POST(request: Request, context: { params: Promise<{ id: string }> }) {
  try {
    const user = await requireUser(request);
    const { id } = await context.params;

    const run = await loadRunForUser(id, user.id);
    if (!run) throw runError("No such run.", 404, "not_found");
    if (run.status === "cancelled") return Response.json({ status: "cancelled" });
    if (run.status === "succeeded" || run.status === "failed") {
      throw runError("This task has already finished.", 409, "conflict");
    }

    await cancelRun(user.id, id);
    return Response.json({ status: "cancelled" });
  } catch (error) {
    return toErrorResponse(error);
  }
}
