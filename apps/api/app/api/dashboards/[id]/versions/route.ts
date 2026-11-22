import { DashboardIdSchema } from "@agent/shared";

import { requireUser, toErrorResponse } from "@/lib/auth";
import { listDashboardVersions } from "@/lib/dashboards";

/** GET /api/dashboards/:id/versions — immutable owned revision snapshots. */
export async function GET(request: Request, context: { params: Promise<{ id: string }> }) {
  try {
    const user = await requireUser(request);
    const { id } = await context.params;
    if (!DashboardIdSchema.safeParse(id).success) {
      return Response.json({ error: { code: "bad_request", message: "Invalid dashboard id." } }, { status: 400 });
    }
    const versions = await listDashboardVersions(user.id, id);
    if (!versions) return Response.json({ error: { code: "not_found", message: "No such dashboard." } }, { status: 404 });
    return Response.json({ versions });
  } catch (error) {
    return toErrorResponse(error);
  }
}
