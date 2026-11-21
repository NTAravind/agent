import { requireUser, toErrorResponse } from "@/lib/auth";

import { getRoutine, listRoutineRuns } from "@/lib/routines/store";

/**
 * GET /api/routines/:id/runs — the runs this routine has produced.
 */
export async function GET(request: Request, ctx: { params: Promise<{ id: string }> }) {
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

    const runs = await listRoutineRuns(user.id, id);
    return Response.json({
      runs: runs.map((run) => ({
        id: run.id,
        routineId: run.routine_id,
        goal: run.goal,
        status: run.status,
        model: run.model,
        tokensUsed: run.tokens_used ?? 0,
        scheduledFor: run.scheduled_for,
        createdAt: run.created_at,
        finishedAt: run.finished_at,
      })),
    });
  } catch (error) {
    return toErrorResponse(error);
  }
}
