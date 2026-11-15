import { requireUser, toErrorResponse } from "@/lib/auth";
import { createCanvas, listCanvases } from "@/lib/canvases";
import { validateCanvasSpec } from "@agent/shared";

/**
 * GET /api/canvases — the user's canvases, newest update first.
 * POST /api/canvases — create a new canvas (validated, ≤100 KB).
 */
export async function GET(request: Request) {
  try {
    const user = await requireUser(request);
    const canvases = await listCanvases(user.id);
    return Response.json({ canvases });
  } catch (error) {
    return toErrorResponse(error);
  }
}

export async function POST(request: Request) {
  try {
    const user = await requireUser(request);
    const body = (await request.json().catch(() => ({}))) as { title?: string; spec?: unknown };

    const validation = validateCanvasSpec(body.spec);
    if (!validation.ok) {
      return Response.json(
        { error: { code: "invalid_spec", message: validation.error } },
        { status: 400 },
      );
    }

    const canvas = await createCanvas({
      userId: user.id,
      title: body.title ?? validation.spec.title ?? "Canvas",
      spec: validation.spec,
    });

    return Response.json({ canvas }, { status: 201 });
  } catch (error) {
    return toErrorResponse(error);
  }
}
