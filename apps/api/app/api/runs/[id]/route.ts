import { requireUser, toErrorResponse } from "@/lib/auth";
import { getRunWithEvents } from "@/lib/agent/runs";
import { listPendingByRun } from "@/lib/approvals";

/**
 * GET /api/runs/:id — one run plus its timeline events and any pending
 * approvals (the timeline UI polls this while the run is in flight).
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

    const pendingApprovals = await listPendingByRun(id);

    return Response.json({ ...data, pendingApprovals });
  } catch (error) {
    return toErrorResponse(error);
  }
}
