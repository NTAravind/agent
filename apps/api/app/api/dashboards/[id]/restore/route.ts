import { DashboardIdSchema, DashboardVersionRestoreSchema } from "@agent/shared";

import { requireUser, toErrorResponse } from "@/lib/auth";
import { restoreDashboardVersion } from "@/lib/dashboards";
import { zodMessage } from "@/lib/zod-error";

/** POST /api/dashboards/:id/restore — apply a prior snapshot as a new revision. */
export async function POST(request: Request, context: { params: Promise<{ id: string }> }) {
  try {
    const user = await requireUser(request);
    const { id } = await context.params;
    if (!DashboardIdSchema.safeParse(id).success) {
      return Response.json({ error: { code: "bad_request", message: "Invalid dashboard id." } }, { status: 400 });
    }
    const parsed = DashboardVersionRestoreSchema.safeParse(await request.json().catch(() => null));
    if (!parsed.success) {
      return Response.json({ error: { code: "bad_request", message: zodMessage(parsed.error) } }, { status: 400 });
    }
    const dashboard = await restoreDashboardVersion(user.id, id, parsed.data.version);
    if (!dashboard) return Response.json({ error: { code: "not_found", message: "Dashboard or version not found." } }, { status: 404 });
    return Response.json({ dashboard });
  } catch (error) {
    return toErrorResponse(error);
  }
}
