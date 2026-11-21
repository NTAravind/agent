import { requireUser, toErrorResponse } from "@/lib/auth";

import { activateRoutine, getRoutine, withPreview } from "@/lib/routines/store";

/**
 * POST /api/routines/:id/activate — confirm a proposed routine.
 *
 * This is the gate: nothing recurring starts until the user taps Confirm.
 * Activating computes the first occurrence (server-side — the client never
 * supplies a date).
 */
export async function POST(request: Request, ctx: { params: Promise<{ id: string }> }) {
  try {
    const user = await requireUser(request);
    const { id } = await ctx.params;
    const current = await getRoutine(user.id, id);
    if (!current) {
      return Response.json(
        { error: { code: "not_found", message: "Unknown routine." } },
        { status: 404 },
      );
    }
    if (current.status === "completed") {
      return Response.json(
        { error: { code: "conflict", message: "That routine has already run." } },
        { status: 409 },
      );
    }

    const routine = await activateRoutine(user.id, id);
    if (!routine) {
      return Response.json(
        { error: { code: "not_found", message: "Unknown routine." } },
        { status: 404 },
      );
    }
    return Response.json({ routine: withPreview(routine) });
  } catch (error) {
    return toErrorResponse(error);
  }
}
