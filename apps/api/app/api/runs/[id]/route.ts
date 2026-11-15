import { requireUser, toErrorResponse } from "@/lib/auth";
import { getRunWithEvents } from "@/lib/agent/runs";

/**
 * GET /api/runs/:id — one run plus its timeline events (the timeline UI
 * polls this while the run is in flight).
 */
export async function GET(request: Request, context: { params: Promise<{ id: string }> }) {
  try {
    const user = await requireUser(request);
    const { id } = await context.params;

    const data = await getRunWithEvents(id);
    if (!data || (data.run as { user_id?: string }).user_id !== user.id) {
      return Response.json(
        { error: { code: "not_found", message: "No such run." } },
        { status: 404 },
      );
    }

    return Response.json(data);
  } catch (error) {
    return toErrorResponse(error);
  }
}
