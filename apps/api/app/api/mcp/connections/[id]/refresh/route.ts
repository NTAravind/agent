import { requireUser, toErrorResponse } from "@/lib/auth";
import { getConnection } from "@/lib/mcp/connections";
import { refreshProvider } from "@/lib/mcp/providers";

/**
 * POST /api/mcp/connections/:id/refresh — health check + tool re-discovery.
 * Returns { toolCount, changed } or a redacted error (status stays connected
 * unless the failure was auth-related, which the adapter marks expired).
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
