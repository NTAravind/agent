import { requireUser, toErrorResponse } from "@/lib/auth";
import { RoutinePatchSchema } from "@agent/shared";

import {
  deleteRoutine,
  getRoutine,
  updateRoutine,
  withPreview,
} from "@/lib/routines/store";
import { normalizeSchedule, RoutineScheduleInputSchema } from "@/lib/routines/tools";
import { zodMessage } from "@/lib/zod-error";

/**
 * GET    /api/routines/:id — one routine with its schedule preview.
 * PATCH  /api/routines/:id — update the name, prompt, schedule or approval mode.
 * DELETE /api/routines/:id — delete the routine.
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
    return Response.json({ routine: withPreview(routine) });
  } catch (error) {
    return toErrorResponse(error);
  }
}

export async function PATCH(request: Request, ctx: { params: Promise<{ id: string }> }) {
  try {
    const user = await requireUser(request);
    const { id } = await ctx.params;
    const parsed = RoutinePatchSchema.safeParse(await request.json().catch(() => ({})));
    if (!parsed.success) {
      return Response.json(
        { error: { code: "bad_request", message: zodMessage(parsed.error) } },
        { status: 400 },
      );
    }
    const input = parsed.data;
    const current = await getRoutine(user.id, id);
    if (!current) {
      return Response.json(
        { error: { code: "not_found", message: "Unknown routine." } },
        { status: 404 },
      );
    }

    const tz = input.tz ?? current.tz;
    const schedule = input.schedule
      ? normalizeSchedule(RoutineScheduleInputSchema.parse(input.schedule), tz)
      : undefined;

    const routine = await updateRoutine(user.id, id, {
      ...(input.name ? { name: input.name } : {}),
      ...(input.prompt ? { prompt: input.prompt } : {}),
      ...(schedule ? { schedule } : {}),
      ...(input.tz ? { tz: input.tz } : {}),
      ...(input.approvalMode ? { approvalMode: input.approvalMode } : {}),
      ...(input.status ? { status: input.status } : {}),
    });
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

export async function DELETE(request: Request, ctx: { params: Promise<{ id: string }> }) {
  try {
    const user = await requireUser(request);
    const { id } = await ctx.params;
    const deleted = await deleteRoutine(user.id, id);
    if (!deleted) {
      return Response.json(
        { error: { code: "not_found", message: "Unknown routine." } },
        { status: 404 },
      );
    }
    return Response.json({ deleted: true });
  } catch (error) {
    return toErrorResponse(error);
  }
}
