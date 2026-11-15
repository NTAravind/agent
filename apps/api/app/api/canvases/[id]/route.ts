import { requireUser, toErrorResponse } from "@/lib/auth";
import { deleteCanvas, getCanvas, updateCanvasSpec } from "@/lib/canvases";
import { validateCanvasSpec } from "@agent/shared";

/**
 * GET    /api/canvases/:id — one canvas with its full spec.
 * PUT    /api/canvases/:id — replace the spec (zod-validated, ≤100 KB).
 * DELETE /api/canvases/:id — delete.
 */
export async function GET(request: Request, context: { params: Promise<{ id: string }> }) {
  try {
    const user = await requireUser(request);
    const { id } = await context.params;

    const canvas = await getCanvas(user.id, id);
    if (!canvas) {
      return Response.json({ error: { code: "not_found", message: "No such canvas." } }, { status: 404 });
    }

    return Response.json({ canvas });
  } catch (error) {
    return toErrorResponse(error);
  }
}

export async function PUT(request: Request, context: { params: Promise<{ id: string }> }) {
  try {
    const user = await requireUser(request);
    const { id } = await context.params;
    const body = (await request.json().catch(() => ({}))) as { spec?: unknown };

    const validation = validateCanvasSpec(body.spec);
    if (!validation.ok) {
      return Response.json(
        { error: { code: "invalid_spec", message: validation.error } },
        { status: 400 },
      );
    }

    const canvas = await updateCanvasSpec(user.id, id, validation.spec);
    if (!canvas) {
      return Response.json({ error: { code: "not_found", message: "No such canvas." } }, { status: 404 });
    }

    return Response.json({ canvas });
  } catch (error) {
    return toErrorResponse(error);
  }
}

export async function DELETE(request: Request, context: { params: Promise<{ id: string }> }) {
  try {
    const user = await requireUser(request);
    const { id } = await context.params;

    const deleted = await deleteCanvas(user.id, id);
    if (!deleted) {
      return Response.json({ error: { code: "not_found", message: "No such canvas." } }, { status: 404 });
    }

    return Response.json({ ok: true });
  } catch (error) {
    return toErrorResponse(error);
  }
}
