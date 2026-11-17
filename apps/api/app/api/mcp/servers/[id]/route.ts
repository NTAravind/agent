import { requireUser, toErrorResponse } from "@/lib/auth";
import { deleteServer, getServer, updateServer, assertAdmin } from "@/lib/mcp/registry";
import { listCachedTools } from "@/lib/mcp/discovery";
import { getConnectionForServer } from "@/lib/mcp/connections";

/**
 * GET    /api/mcp/servers/:id — listing detail (+ cached tools + connection flag).
 * PUT    /api/mcp/servers/:id — admin-only: patch the listing.
 * DELETE /api/mcp/servers/:id — admin-only: remove it (cascades).
 */
export async function GET(request: Request, ctx: { params: Promise<{ id: string }> }) {
  try {
    const user = await requireUser(request);
    const { id } = await ctx.params;

    const server = await getServer(id);
    if (!server || !server.enabled) {
      return Response.json(
        { error: { code: "not_found", message: "Unknown integration." } },
        { status: 404 },
      );
    }

    const [tools, connection] = await Promise.all([
      listCachedTools(server.id),
      getConnectionForServer(user.id, server.id),
    ]);

    return Response.json({
      server: {
        id: server.id,
        slug: server.slug,
        name: server.name,
        description: server.description,
        provider: server.provider,
        category: server.category,
        endpoint: server.endpoint,
        transport: server.transport,
        authType: server.auth_type,
        config: server.config,
        capabilities: server.capabilities,
        iconUrl: server.icon_url,
        isVerified: server.is_verified,
        isFreeTier: server.is_free_tier,
        enabled: server.enabled,
      },
      tools,
      // `config` stays server-side (auth header scheme etc. — never needed
      // by the client, and must not become a leak surface).
      connection: connection
        ? {
            id: connection.id,
            status: connection.status,
            authType: connection.auth_type,
            lastCheckedAt: connection.last_checked_at,
          }
        : null,
    });
  } catch (error) {
    return toErrorResponse(error);
  }
}

export async function PUT(request: Request, ctx: { params: Promise<{ id: string }> }) {
  try {
    await requireUser(request);
    assertAdmin();
    const { id } = await ctx.params;
    const body = (await request.json().catch(() => ({}))) as Record<string, unknown>;

    const patch: Parameters<typeof updateServer>[1] = {};
    if (typeof body.name === "string") patch.name = body.name;
    if (typeof body.description === "string") patch.description = body.description;
    if (typeof body.category === "string") patch.category = body.category;
    if (body.endpoint === null || typeof body.endpoint === "string") patch.endpoint = body.endpoint;
    if (body.isVerified !== undefined) patch.isVerified = Boolean(body.isVerified);
    if (body.isFreeTier !== undefined) patch.isFreeTier = Boolean(body.isFreeTier);
    if (body.enabled !== undefined) patch.enabled = Boolean(body.enabled);
    if (body.config && typeof body.config === "object") {
      patch.config = body.config as Record<string, unknown>;
    }

    const server = await updateServer(id, patch);
    if (!server) {
      return Response.json(
        { error: { code: "not_found", message: "Unknown integration." } },
        { status: 404 },
      );
    }
    return Response.json({ server });
  } catch (error) {
    return toErrorResponse(error);
  }
}

export async function DELETE(request: Request, ctx: { params: Promise<{ id: string }> }) {
  try {
    await requireUser(request);
    assertAdmin();
    const { id } = await ctx.params;
    const removed = await deleteServer(id);
    return Response.json({ deleted: removed });
  } catch (error) {
    return toErrorResponse(error);
  }
}
