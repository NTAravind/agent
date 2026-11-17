import { requireUser, toErrorResponse } from "@/lib/auth";
import { listCatalog, createServer, assertAdmin } from "@/lib/mcp/registry";

/**
 * GET  /api/mcp/servers — marketplace catalog with the caller's connection flags.
 *      Query: ?q=&category=&provider=&authType=&freeOnly=1&connected=1
 * POST /api/mcp/servers — admin-only: add a verified listing (ALLOWED_USER_ID).
 */
export async function GET(request: Request) {
  try {
    const user = await requireUser(request);
    const url = new URL(request.url);
    const entries = await listCatalog({
      userId: user.id,
      q: url.searchParams.get("q") ?? undefined,
      category: url.searchParams.get("category") ?? undefined,
      provider: url.searchParams.get("provider") ?? undefined,
      authType: url.searchParams.get("authType") ?? undefined,
      freeOnly: url.searchParams.get("freeOnly") === "1",
      connectedOnly: url.searchParams.get("connected") === "1",
    });
    return Response.json({ servers: entries });
  } catch (error) {
    return toErrorResponse(error);
  }
}

export async function POST(request: Request) {
  try {
    const user = await requireUser(request);
    assertAdmin();
    const body = (await request.json().catch(() => ({}))) as {
      slug?: string;
      name?: string;
      description?: string;
      provider?: string;
      category?: string;
      endpoint?: string | null;
      transport?: "streamable_http" | "http" | "stdio";
      authType?: "none" | "api_key" | "oauth2" | "pat" | "provider_managed";
      config?: Record<string, unknown>;
      capabilities?: Record<string, unknown>;
      iconUrl?: string | null;
      isVerified?: boolean;
      isFreeTier?: boolean;
    };

    if (!body.slug?.trim() || !body.name?.trim() || !body.authType) {
      return Response.json(
        { error: { code: "bad_request", message: "slug, name and authType are required." } },
        { status: 400 },
      );
    }

    const server = await createServer({
      slug: body.slug.trim().toLowerCase().replace(/[^a-z0-9-]+/g, "-"),
      name: body.name.trim(),
      description: body.description,
      provider: body.provider,
      category: body.category,
      endpoint: body.endpoint ?? null,
      transport: body.transport,
      authType: body.authType,
      config: body.config,
      capabilities: body.capabilities,
      iconUrl: body.iconUrl,
      isVerified: body.isVerified,
      isFreeTier: body.isFreeTier,
    });
    return Response.json({ server }, { status: 201 });
  } catch (error) {
    return toErrorResponse(error);
  }
}
