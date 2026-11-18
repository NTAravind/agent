import { MCPServerCreateSchema, normalizeListingSlug } from "@agent/shared";

import { requireUser, toErrorResponse } from "@/lib/auth";
import { zodMessage } from "@/lib/zod-error";
import { listCatalog, createServer, assertAdmin, toPublicServer } from "@/lib/mcp/registry";

/**
 * GET  /api/mcp/servers — marketplace catalog with the caller's connection flags.
 *      Query: ?q=&category=&provider=&authType=&freeOnly=1&connected=1
 *      Admin:  ?all=1 also returns disabled listings (management view).
 * POST /api/mcp/servers — admin-only: add a listing (ALLOWED_USER_ID).
 */
export async function GET(request: Request) {
  try {
    const user = await requireUser(request);
    const url = new URL(request.url);
    const includeDisabled = url.searchParams.get("all") === "1";
    if (includeDisabled) assertAdmin();
    const entries = await listCatalog({
      userId: user.id,
      q: url.searchParams.get("q") ?? undefined,
      category: url.searchParams.get("category") ?? undefined,
      provider: url.searchParams.get("provider") ?? undefined,
      authType: url.searchParams.get("authType") ?? undefined,
      freeOnly: url.searchParams.get("freeOnly") === "1",
      connectedOnly: url.searchParams.get("connected") === "1",
      includeDisabled,
    });
    return Response.json({
      servers: entries.map((entry) => ({
        ...toPublicServer(entry),
        connected: entry.connected,
        connectionId: entry.connectionId,
        connectionStatus: entry.connectionStatus,
      })),
    });
  } catch (error) {
    return toErrorResponse(error);
  }
}

export async function POST(request: Request) {
  try {
    await requireUser(request);
    assertAdmin();
    const raw = (await request.json().catch(() => ({}))) as Record<string, unknown>;

    // Normalize before validation: slugs are stored lowercase-dashed and an
    // empty endpoint/icon string means "none".
    const normalized = { ...raw };
    if (typeof normalized.slug === "string") {
      normalized.slug = normalizeListingSlug(normalized.slug);
    }
    if (normalized.endpoint === "") normalized.endpoint = null;
    if (normalized.iconUrl === "") normalized.iconUrl = null;

    const parsed = MCPServerCreateSchema.safeParse(normalized);
    if (!parsed.success) {
      return Response.json(
        { error: { code: "bad_request", message: zodMessage(parsed.error) } },
        { status: 400 },
      );
    }

    const server = await createServer(parsed.data);
    return Response.json({ server: toPublicServer(server) }, { status: 201 });
  } catch (error) {
    return toErrorResponse(error);
  }
}
