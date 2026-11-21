import { requireUser, toErrorResponse } from "@/lib/auth";

import { getRoutine } from "@/lib/routines/store";
import { runRoutineNow } from "@/lib/routines/scheduler";

/**
 * POST /api/routines/:id/run-now — run a routine immediately.
 *
 * The run is queued exactly like a scheduled one (same trigger message, same
 * thread, same push), but the routine's own schedule is left untouched.
 */
export async function POST(request: Request, ctx: { params: Promise<{ id: string }> }) {
  try {
    const user = await requireUser(request);
    const { id } = await ctx.params;
    const routine = await getRoutine(user.id, id);
    if (!routine) {
      return Response.json(
        { error: { code: "not_found", message: "Unknown routine." } },
        { status: 404 },
      );
    }
    if (routine.status === "completed") {
      return Response.json(
        { error: { code: "conflict", message: "That routine has already run." } },
        { status: 409 },
      );
    }

    const result = await runRoutineNow(routine);
    return Response.json(
      { runId: result.runId, status: result.skipped ? "skipped" : "queued" },
      { status: 202 },
    );
  } catch (error) {
    return toErrorResponse(error);
  }
}
