import { DashboardCreateSchema } from "@agent/shared";
import { z } from "zod";

import { requireUser, toErrorResponse } from "@/lib/auth";
import { createDashboard, listDashboards } from "@/lib/dashboards";
import { zodMessage } from "@/lib/zod-error";

const ListQuerySchema = z.object({
  limit: z.coerce.number().int().min(1).max(50).default(20),
  offset: z.coerce.number().int().min(0).max(100_000).default(0),
});

/** GET /api/dashboards — paginated dashboards owned by the caller. */
export async function GET(request: Request) {
  try {
    const user = await requireUser(request);
    const url = new URL(request.url);
    const parsed = ListQuerySchema.safeParse({
      limit: url.searchParams.get("limit") ?? undefined,
      offset: url.searchParams.get("offset") ?? undefined,
    });
    if (!parsed.success) {
      return Response.json(
        { error: { code: "bad_request", message: zodMessage(parsed.error) } },
        { status: 400 },
      );
    }
    const dashboards = await listDashboards(user.id, parsed.data.limit, parsed.data.offset);
    return Response.json({ dashboards, limit: parsed.data.limit, offset: parsed.data.offset });
  } catch (error) {
    return toErrorResponse(error);
  }
}

/** POST /api/dashboards — create a validated persistent dashboard. */
export async function POST(request: Request) {
  try {
    const user = await requireUser(request);
    const parsed = DashboardCreateSchema.safeParse(await request.json().catch(() => null));
    if (!parsed.success) {
      return Response.json(
        { error: { code: "invalid_spec", message: zodMessage(parsed.error) } },
        { status: 400 },
      );
    }
    const dashboard = await createDashboard(user.id, parsed.data);
    return Response.json({ dashboard }, { status: 201 });
  } catch (error) {
    const databaseError = error as { code?: unknown; message?: unknown };
    if (databaseError?.code === "P0001" && databaseError.message === "dashboard_creation_rate_limit") {
      return Response.json(
        { error: { code: "rate_limited", message: "Dashboard creation limit reached. Try again in an hour." } },
        { status: 429 },
      );
    }
    if (error instanceof Error && error.message === "Dashboard agent not found.") {
      return Response.json({ error: { code: "not_found", message: error.message } }, { status: 404 });
    }
    return toErrorResponse(error);
  }
}
