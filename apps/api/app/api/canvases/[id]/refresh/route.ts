import { requireUser, toErrorResponse } from "@/lib/auth";
import { getCanvas, refreshCanvas } from "@/lib/canvases";

/**
 * POST /api/canvases/:id/refresh — re-runs the canvas's data sources with no
 * LLM call and rewrites the bound components. Pull-to-refresh on the phone
 * and the daily cron both land here.
 */
export async function POST(request: Request, context: { params: Promise<{ id: string }> }) {
  try {
    const user = await requireUser(request);
    const { id } = await context.params;

    const canvas = await getCanvas(user.id, id);
    if (!canvas) {
      return Response.json({ error: { code: "not_found", message: "No such canvas." } }, { status: 404 });
    }

    const refreshed = await refreshCanvas(user.id, canvas);
    return Response.json({ canvas: refreshed });
  } catch (error) {
    return toErrorResponse(error);
  }
}
