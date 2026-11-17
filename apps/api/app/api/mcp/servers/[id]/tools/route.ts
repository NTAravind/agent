import { requireUser, toErrorResponse } from "@/lib/auth";
import { listCachedTools } from "@/lib/mcp/discovery";
import { assertAdmin, getServer } from "@/lib/mcp/registry";
import { discoverServerTools } from "@/lib/mcp/discovery";

/**
 * GET  /api/mcp/servers/:id/tools — cached discovered tools.
 * POST /api/mcp/servers/:id/tools — admin-only: run the handshake now and
 *      refresh the cache (works for `none`; api_key/oauth2 listings refresh
 *      through the connection's own refresh route instead).
 */
export async function GET(request: Request, ctx: { params: Promise<{ id: string }> }) {
  try {
    await requireUser(request);
    const { id } = await ctx.params;
    const server = await getServer(id);
    if (!server) {
      return Response.json(
        { error: { code: "not_found", message: "Unknown integration." } },
        { status: 404 },
      );
    }
    const tools = await listCachedTools(server.id);
    return Response.json({ tools });
  } catch (error) {
    return toErrorResponse(error);
  }
}

export async function POST(request: Request, ctx: { params: Promise<{ id: string }> }) {
  try {
    const user = await requireUser(request);
    assertAdmin();
    const { id } = await ctx.params;
    const server = await getServer(id);
    if (!server) {
      return Response.json(
        { error: { code: "not_found", message: "Unknown integration." } },
        { status: 404 },
      );
    }
    const summary = await discoverServerTools({ userId: user.id, server });
    return Response.json(summary);
  } catch (error) {
    return toErrorResponse(error);
  }
}
