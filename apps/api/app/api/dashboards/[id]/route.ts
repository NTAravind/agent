import { DashboardIdSchema, DashboardUpdateSchema } from "@agent/shared";

import { requireUser, toErrorResponse } from "@/lib/auth";
import { deleteDashboard, getDashboard, updateDashboard } from "@/lib/dashboards";
import { zodMessage } from "@/lib/zod-error";

type RouteContext = { params: Promise<{ id: string }> };

/** GET /api/dashboards/:id — one owned dashboard with its widgets. */
export async function GET(request: Request, context: RouteContext) {
  try {
    const user = await requireUser(request);
    const { id } = await context.params;
    if (!DashboardIdSchema.safeParse(id).success) {
      return Response.json({ error: { code: "bad_request", message: "Invalid dashboard id." } }, { status: 400 });
    }
    const dashboard = await getDashboard(user.id, id);
    if (!dashboard) return Response.json({ error: { code: "not_found", message: "No such dashboard." } }, { status: 404 });
    return Response.json({ dashboard });
  } catch (error) {
    return toErrorResponse(error);
  }
}

/** PUT /api/dashboards/:id — update metadata/layout and optionally replace widgets. */
export async function PUT(request: Request, context: RouteContext) {
  try {
    const user = await requireUser(request);
    const { id } = await context.params;
    if (!DashboardIdSchema.safeParse(id).success) {
      return Response.json({ error: { code: "bad_request", message: "Invalid dashboard id." } }, { status: 400 });
    }
    const parsed = DashboardUpdateSchema.safeParse(await request.json().catch(() => null));
    if (!parsed.success) {
      return Response.json({ error: { code: "invalid_spec", message: zodMessage(parsed.error) } }, { status: 400 });
    }
    const dashboard = await updateDashboard(user.id, id, parsed.data);
    if (!dashboard) return Response.json({ error: { code: "not_found", message: "No such dashboard." } }, { status: 404 });
    return Response.json({ dashboard });
  } catch (error) {
    if (error instanceof Error && error.message === "Dashboard agent not found.") {
      return Response.json({ error: { code: "not_found", message: error.message } }, { status: 404 });
    }
    return toErrorResponse(error);
  }
}

/** DELETE /api/dashboards/:id — delete the owned dashboard and its history. */
export async function DELETE(request: Request, context: RouteContext) {
  try {
    const user = await requireUser(request);
    const { id } = await context.params;
    if (!DashboardIdSchema.safeParse(id).success) {
      return Response.json({ error: { code: "bad_request", message: "Invalid dashboard id." } }, { status: 400 });
    }
    const deleted = await deleteDashboard(user.id, id);
    if (!deleted) return Response.json({ error: { code: "not_found", message: "No such dashboard." } }, { status: 404 });
    return Response.json({ deleted: true });
  } catch (error) {
    return toErrorResponse(error);
  }
}
