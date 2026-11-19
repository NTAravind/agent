import { requireUser, toErrorResponse } from "@/lib/auth";
import { getConnection } from "@/lib/mcp/connections";
import { verifyComposio } from "@/lib/mcp/providers/composio";
import { refreshProvider } from "@/lib/mcp/providers";
import { getServer } from "@/lib/mcp/registry";

/**
 * POST /api/mcp/connections/:id/verify — re-check a connection with its
 * provider and return the real status (the app polls this while waiting on
 * consent, and taps "Finish connecting" / "Reconnect" through it).
 *
 * Body: { issueLink?: boolean } (default true) — `false` makes the call
 * side-effect free: no hosted link is minted and nothing is written while
 * the status is unchanged, so polling every 2s costs one Composio read.
 *
 * For Composio the status comes from the connected-account check (ACTIVE
 * everywhere → tools are synced → `connected`); a direct connection falls
 * back to the same handshake + tool re-sync the refresh route runs.
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

    const body = (await request.json().catch(() => ({}))) as { issueLink?: boolean };
    const issueLink = body.issueLink !== false;

    const server = await getServer(row.mcp_server_id);
    if (server?.provider === "composio") {
      const result = await verifyComposio({
        userId: user.id,
        connectionId: id,
        issueLink,
      });
      return Response.json(result);
    }

    const refreshed = await refreshProvider({ userId: user.id, connectionId: id });
    return Response.json({
      status: refreshed.status ?? row.status,
      toolCount: refreshed.toolCount,
      changed: refreshed.changed,
      ...(refreshed.authorizationUrl ? { authorizationUrl: refreshed.authorizationUrl } : {}),
      ...(refreshed.message ? { message: refreshed.message } : {}),
    });
  } catch (error) {
    return toErrorResponse(error);
  }
}
