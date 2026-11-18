import { MCPServerPatchSchema, normalizeListingSlug } from "@agent/shared";

import { requireUser, toErrorResponse } from "@/lib/auth";
import { zodMessage } from "@/lib/zod-error";
import { deleteServer, getServer, updateServer, assertAdmin, toPublicServer } from "@/lib/mcp/registry";
import { listCachedTools } from "@/lib/mcp/discovery";
import { getConnectionForServer } from "@/lib/mcp/connections";

/**
 * GET    /api/mcp/servers/:id — listing detail (+ cached tools + connection flag).
 * PUT    /api/mcp/servers/:id — admin-only: patch the listing.
 * DELETE /api/mcp/servers/:id — admin-only: remove it (cascades to tools,
 *                                connections and agent attachments).
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
      server: toPublicServer(server),
      tools,
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
    const raw = (await request.json().catch(() => ({}))) as Record<string, unknown>;

    const normalized = { ...raw };
    if (typeof normalized.slug === "string") {
      normalized.slug = normalizeListingSlug(normalized.slug);
    }
    if (normalized.endpoint === "") normalized.endpoint = null;
    if (normalized.iconUrl === "") normalized.iconUrl = null;

    const parsed = MCPServerPatchSchema.safeParse(normalized);
    if (!parsed.success) {
      return Response.json(
        { error: { code: "bad_request", message: zodMessage(parsed.error) } },
        { status: 400 },
      );
    }

    const server = await updateServer(id, parsed.data);
    if (!server) {
      return Response.json(
        { error: { code: "not_found", message: "Unknown integration." } },
        { status: 404 },
      );
    }
    return Response.json({ server: toPublicServer(server) });
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
