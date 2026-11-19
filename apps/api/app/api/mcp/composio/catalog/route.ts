import { requireUser, toErrorResponse } from "@/lib/auth";
import {
  composioCatalogConfigured,
  listComposioCatalog,
} from "@/lib/mcp/composio-catalog";

/**
 * GET /api/mcp/composio/catalog — the Composio toolkit catalog behind the
 *      marketplace's "Composio" tab, with this user's connection state merged
 *      in. Query: `?q=&category=`.
 *      Returns `configured: false` (HTTP 200) when COMPOSIO_API_KEY is absent
 *      so the app can render an explanation instead of an error.
 */
export async function GET(request: Request) {
  try {
    const user = await requireUser(request);
    if (!composioCatalogConfigured()) {
      return Response.json({
        configured: false,
        items: [],
        categories: [],
        total: 0,
      });
    }

    const url = new URL(request.url);
    const result = await listComposioCatalog({
      userId: user.id,
      q: url.searchParams.get("q") ?? undefined,
      category: url.searchParams.get("category") ?? undefined,
    });

    return Response.json(
      { configured: true, ...result },
      { headers: { "Cache-Control": "no-store, max-age=0" } },
    );
  } catch (error) {
    return toErrorResponse(error);
  }
}
