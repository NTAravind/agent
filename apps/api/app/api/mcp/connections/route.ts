import { requireUser, toErrorResponse } from "@/lib/auth";
import { ensureComposioListing } from "@/lib/mcp/composio-catalog";
import { listConnections, toPublicConnection } from "@/lib/mcp/connections";
import { connectProvider } from "@/lib/mcp/providers";
import { getServer } from "@/lib/mcp/registry";
import { startAuthorization } from "@/lib/mcp/oauth";

/**
 * GET  /api/mcp/connections — the caller's connections (never credentials).
 * POST /api/mcp/connections — connect a server.
 *      Body: { serverId? | toolkit?, apiKey?, credentials? } — `serverId` for
 *      an existing listing, or `toolkit` (a Composio toolkit slug) to
 *      materialize its listing on first connect and then connect it.
 *      Returns { connectionId, serverId, … } when done, or { authorizationUrl }
 *      for OAuth (the app opens the URL in a browser; the callback finishes
 *      the flow).
 */
export async function GET(request: Request) {
  try {
    const user = await requireUser(request);
    const rows = await listConnections(user.id);
    return Response.json({ connections: rows.map(toPublicConnection) });
  } catch (error) {
    return toErrorResponse(error);
  }
}

export async function POST(request: Request) {
  try {
    const user = await requireUser(request);
    const body = (await request.json().catch(() => ({}))) as {
      serverId?: string;
      toolkit?: string;
      apiKey?: string;
      credentials?: Record<string, unknown>;
    };

    // Composio tab: connect by toolkit slug; the marketplace listing is
    // materialized on first connect (idempotent).
    let serverId = typeof body.serverId === "string" ? body.serverId : undefined;
    if (typeof body.toolkit === "string" && body.toolkit.trim()) {
      serverId = (await ensureComposioListing(body.toolkit)).id;
    }

    if (!serverId) {
      return Response.json(
        { error: { code: "bad_request", message: "serverId or toolkit is required." } },
        { status: 400 },
      );
    }

    const server = await getServer(serverId);
    if (!server || !server.enabled) {
      return Response.json(
        { error: { code: "not_found", message: "Unknown integration." } },
        { status: 404 },
      );
    }

    const apiKey =
      typeof body.apiKey === "string" && body.apiKey.trim()
        ? body.apiKey.trim()
        : typeof body.credentials?.apiKey === "string"
          ? (body.credentials.apiKey as string).trim()
          : undefined;

    // OAuth: create/refresh the pending connection, then start the dance.
    if (server.auth_type === "oauth2") {
      const started = await connectProvider({
        userId: user.id,
        serverId: server.id,
        entityUserId:
          typeof body.credentials?.entityUserId === "string"
            ? body.credentials.entityUserId
            : undefined,
      });
      const auth = await startAuthorization({
        connectionId: started.connectionId,
        userId: user.id,
        serverUrl: server.endpoint ?? "",
      });
      if (auth.status === "redirect" && auth.authorizationUrl) {
        return Response.json({
          connectionId: started.connectionId,
          authorizationUrl: auth.authorizationUrl,
        });
      }
      // Stored tokens were still valid → already authorized.
      return Response.json({ connectionId: started.connectionId, status: "connected" });
    }

    const result = await connectProvider({
      userId: user.id,
      serverId: server.id,
      apiKey,
      entityUserId:
        typeof body.credentials?.entityUserId === "string"
          ? body.credentials.entityUserId
          : undefined,
    });
    return Response.json(
      {
        connectionId: result.connectionId,
        serverId: server.id,
        status: "connected",
        toolCount: result.toolCount ?? 0,
      },
      { status: 201 },
    );
  } catch (error) {
    return toErrorResponse(error);
  }
}
