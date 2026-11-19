import { requireUser, toErrorResponse } from "@/lib/auth";
import { getConnection } from "@/lib/mcp/connections";
import { refreshProvider } from "@/lib/mcp/providers";

/**
 * POST /api/mcp/connections/:id/refresh — re-checks the connection with its
 * provider and re-syncs tools. Returns { toolCount, changed, status } and,
 * for Composio, { authorizationUrl } when consent expired/revoked (the app
 * reopens it); failures are returned redacted instead of silently marking
 * the row connected.
 */
export async function POST(request: Request, ctx: { params: Promise<{ id: string }> }) {
  try {
    const user = await requireUser(request);
    const { id } = await ctx.params;

    const row = await getConnection(user.id, id);
    if (!row) {
      return Response.json(
        { error: { code: "not_found", message: "Unknown connection." } },
        { status: 404 },
      );
    }

    const result = await refreshProvider({ userId: user.id, connectionId: id });
    return Response.json(result);
  } catch (error) {
    return toErrorResponse(error);
  }
}
