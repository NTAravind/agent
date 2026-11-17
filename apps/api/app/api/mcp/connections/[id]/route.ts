import { requireUser, toErrorResponse } from "@/lib/auth";
import { deleteConnection, getConnection, toPublicConnection } from "@/lib/mcp/connections";
import { disconnectProvider } from "@/lib/mcp/providers";
import { listCachedTools } from "@/lib/mcp/discovery";

/**
 * GET    /api/mcp/connections/:id — connection detail (+ cached tools).
 * DELETE /api/mcp/connections/:id — disconnect: wipe secrets, detach from
 *        all agents, keep the row (status=disconnected) for history.
 */
export async function GET(request: Request, ctx: { params: Promise<{ id: string }> }) {
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

    const tools = await listCachedTools(row.mcp_server_id);
    return Response.json({ connection: toPublicConnection(row), tools });
  } catch (error) {
    return toErrorResponse(error);
  }
}

export async function DELETE(request: Request, ctx: { params: Promise<{ id: string }> }) {
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
    await disconnectProvider({ userId: user.id, connectionId: id });
    return Response.json({ disconnected: true });
  } catch (error) {
    return toErrorResponse(error);
  }
}
