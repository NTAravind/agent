import { allowedUserId } from "@/lib/auth";
import { requireComposioKey } from "@/lib/mcp/providers/composio";
import { listCatalog, type CatalogEntry } from "@/lib/mcp/registry";
import { supabaseAdmin } from "@/lib/supabase/server";
import { isConfigured } from "@/lib/env";

/**
 * Composio as a *marketplace source* (Phase 6 addendum, 2026-11-19).
 *
 * Instead of one hand-seeded "Composio" integration, the whole Composio
 * toolkit catalog (1,700+ apps) is browsable in its own marketplace tab.
 * Rows are read live from `GET /api/v3.1/toolkits` (cached in-process) and
 * are NOT marketplace listings until the user connects: the first connect
 * materializes a `mcp_servers` row (`composio-<toolkit>`, provider
 * `composio`), after which the existing connection / tool-cache / agent
 * attach / approval machinery applies unchanged.
 *
 * Verified live against the Composio API on 2026-11-19: `?limit=500` paging
 * via `next_cursor`, `total_items`, and `meta.{description,logo,
 * tools_count,categories}` per toolkit.
 */

const CATALOG_URL = "https://backend.composio.dev/api/v3.1/toolkits";
const PAGE_LIMIT = 500;
const MAX_ITEMS = 2_500;
const CACHE_TTL_MS = 10 * 60_000;
/** Hard cap on what one marketplace request returns (phone-sized lists). */
const RESULT_CAP = 100;
const TOP_CATEGORY_COUNT = 12;

const COMPOSIO_INSTRUCTIONS = [
  "1. Tap Connect — Composio opens the app's own consent screen for that account.",
  "2. Your agent gets Composio's helper tools (search + execute); it discovers this app's actions at run time.",
  "3. Tools that send messages or change data ask for approval the first time.",
].join("\n");

type ComposioToolkit = {
  name?: string;
  slug?: string;
  auth_schemes?: string[];
  composio_managed_auth_schemes?: string[];
  no_auth?: boolean;
  /**
   * Composio returns this as `{ toolkitId }` when present, not a boolean —
   * only a literal `true` means deprecated (live-verified 2026-11-19).
   */
  deprecated?: boolean | { toolkitId?: string } | null;
  meta?: {
    tools_count?: number;
    description?: string;
    logo?: string;
    categories?: Array<{ id?: string; name?: string }>;
  };
};

type ToolkitCache = { items: ComposioToolkit[]; fetchedAt: number };

let toolkitCache: ToolkitCache | null = null;

function requireCatalogKey(): string {
  // Reuses the adapter's guard: missing key and ck_/ak_ mix-ups fail the
  // same way everywhere ("not configured" / "wrong key type").
  return requireComposioKey();
}

/** True when the Composio catalog tab can be shown at all. */
export function composioCatalogConfigured(): boolean {
  return isConfigured("COMPOSIO_API_KEY");
}

/** Fetches every toolkit page (cached 10 minutes, capped at MAX_ITEMS). */
async function fetchAllToolkits(): Promise<ComposioToolkit[]> {
  if (toolkitCache && Date.now() - toolkitCache.fetchedAt < CACHE_TTL_MS) {
    return toolkitCache.items;
  }
  const key = requireCatalogKey();
  const items: ComposioToolkit[] = [];
  let cursor: string | undefined;

  for (let page = 0; page < Math.ceil(MAX_ITEMS / PAGE_LIMIT); page++) {
    const url = new URL(CATALOG_URL);
    url.searchParams.set("limit", String(PAGE_LIMIT));
    if (cursor) url.searchParams.set("cursor", cursor);
    const response = await fetch(url, {
      headers: { "x-api-key": key },
      cache: "no-store",
      signal: AbortSignal.timeout(25_000),
    });
    if (!response.ok) {
      throw Object.assign(
        new Error(`Composio catalog request failed (${response.status}).`),
        response.status >= 400 && response.status < 500
          ? { status: 400, code: "bad_request" }
          : {},
      );
    }
    const body = (await response.json()) as {
      items?: ComposioToolkit[];
      next_cursor?: string | null;
    };
    const pageItems = (body.items ?? []).filter((item) => item.slug && item.deprecated !== true);
    items.push(...pageItems);
    cursor = body.next_cursor ?? undefined;
    if (!cursor || pageItems.length === 0) break;
  }

  toolkitCache = { items, fetchedAt: Date.now() };
  return items;
}

function toolkitCategories(toolkit: ComposioToolkit): string[] {
  return (toolkit.meta?.categories ?? [])
    .map((category) => (category.id ?? "").trim())
    .filter(Boolean);
}

/** Composio's free-form categories → the marketplace's fixed category set. */
function marketplaceCategory(toolkit: ComposioToolkit): string {
  const ids = toolkitCategories(toolkit);
  if (ids.some((id) => ["email", "productivity", "scheduling & booking", "communication"].includes(id))) {
    return "productivity";
  }
  if (ids.some((id) => id.startsWith("developer"))) return "development";
  if (ids.some((id) => ["finance", "payments", "banking"].includes(id))) return "finance";
  if (ids.some((id) => ["search", "research", "data"].includes(id))) return "research";
  return "other";
}

export type ComposioCatalogItem = {
  /** Composio toolkit slug (`gmail`); the connect key. */
  toolkit: string;
  name: string;
  description: string;
  logo: string | null;
  /** Composio's own category id (its tab filter), not the DB category. */
  category: string | null;
  toolCount: number;
  authSchemes: string[];
  /** Set once a listing has been materialized by a connect. */
  serverId: string | null;
  connected: boolean;
  connectionId: string | null;
  connectionStatus: string | null;
};

export type ComposioCatalogResult = {
  items: ComposioCatalogItem[];
  /** Matches before RESULT_CAP — for "showing 100 of N". */
  total: number;
  /** Most common categories in the catalog, for the tab's filter chips. */
  categories: string[];
};

/** A connected Composio listing enables a *set* of toolkits (config.toolkits). */
function connectedToolkitMap(entries: CatalogEntry[]): Map<string, CatalogEntry> {
  const map = new Map<string, CatalogEntry>();
  for (const entry of entries) {
    if (!entry.connected) continue;
    // The shared `config` type describes the write schema; live rows carry
    // `toolkits` at the top level (same place sessionToolkits() reads it).
    const config = entry.config as unknown as Record<string, unknown> | null;
    const toolkits = config && Array.isArray(config.toolkits) ? config.toolkits : [];
    for (const toolkit of toolkits) {
      if (typeof toolkit === "string" && !map.has(toolkit)) map.set(toolkit, entry);
    }
  }
  return map;
}

/**
 * Browses the Composio catalog with this user's connection state merged in.
 * `q` is a case-insensitive substring match over name/slug/description; the
 * catalog is cached server-side, so filtering is cheap and consistent.
 */
export async function listComposioCatalog(input: {
  userId: string;
  q?: string;
  category?: string;
}): Promise<ComposioCatalogResult> {
  const all = await fetchAllToolkits();

  const query = input.q?.trim().toLowerCase() ?? "";
  const category = input.category?.trim().toLowerCase() ?? "";

  const matches = all.filter((toolkit) => {
    if (category && !toolkitCategories(toolkit).includes(category)) return false;
    if (!query) return true;
    const haystack = `${toolkit.name ?? ""} ${toolkit.slug ?? ""} ${toolkit.meta?.description ?? ""}`.toLowerCase();
    return haystack.includes(query);
  });

  // Popularity first: the biggest toolkits are the ones people look for.
  matches.sort((a, b) => (b.meta?.tools_count ?? 0) - (a.meta?.tools_count ?? 0));

  const connections = connectedToolkitMap(
    await listCatalog({ userId: input.userId, provider: "composio" }),
  );

  const items: ComposioCatalogItem[] = matches.slice(0, RESULT_CAP).map((toolkit) => {
    const slug = toolkit.slug ?? "";
    const existing = connections.get(slug);
    return {
      toolkit: slug,
      name: toolkit.name ?? slug,
      description: (toolkit.meta?.description ?? "").slice(0, 500),
      logo: toolkit.meta?.logo ?? null,
      category: toolkitCategories(toolkit)[0] ?? null,
      toolCount: toolkit.meta?.tools_count ?? 0,
      authSchemes: toolkit.composio_managed_auth_schemes?.length
        ? toolkit.composio_managed_auth_schemes
        : toolkit.auth_schemes ?? [],
      serverId: existing?.id ?? null,
      connected: Boolean(existing),
      connectionId: existing?.connectionId ?? null,
      connectionStatus: existing?.connectionStatus ?? null,
    };
  });

  // Category chips: most represented categories across the whole catalog.
  const counts = new Map<string, number>();
  for (const toolkit of all) {
    for (const id of toolkitCategories(toolkit)) {
      counts.set(id, (counts.get(id) ?? 0) + 1);
    }
  }
  const categories = [...counts.entries()]
    .sort((a, b) => b[1] - a[1])
    .slice(0, TOP_CATEGORY_COUNT)
    .map(([id]) => id);

  return { items, total: matches.length, categories };
}

/**
 * Idempotently creates the marketplace listing for one Composio toolkit
 * (the "materialize on connect" step) and returns it.
 */
export async function ensureComposioListing(toolkit: string): Promise<{ id: string; slug: string }> {
  const normalized = toolkit.trim().toLowerCase();
  if (!/^[a-z0-9][a-z0-9_-]{1,63}$/.test(normalized)) {
    throw Object.assign(new Error("Unknown Composio toolkit."), {
      status: 400,
      code: "bad_request",
    });
  }
  // Listing slugs are lowercase-dashed (shared slug rules); keep the toolkit
  // id verbatim in config.toolkits, which is what the session API reads.
  const slug = `composio-${normalized.replaceAll("_", "-")}`;

  const existing = await supabaseAdmin()
    .from("mcp_servers")
    .select("id, slug")
    .eq("slug", slug)
    .maybeSingle();
  if (existing.data?.id) return { id: existing.data.id, slug };

  const all = await fetchAllToolkits().catch(() => [] as ComposioToolkit[]);
  const info = all.find((toolkit) => toolkit.slug === normalized);

  const { data, error } = await supabaseAdmin()
    .from("mcp_servers")
    .upsert(
      {
        slug,
        name: info?.name ?? normalized,
        description: (info?.meta?.description ?? "").slice(0, 500),
        instructions: COMPOSIO_INSTRUCTIONS,
        provider: "composio",
        category: marketplaceCategory(info ?? {}),
        endpoint: null,
        transport: "streamable_http",
        auth_type: "provider_managed",
        config: { toolkits: [normalized] },
        capabilities: { tools: true },
        icon_url: info?.meta?.logo ?? null,
        is_verified: true,
        is_free_tier: true,
        enabled: true,
        created_by: allowedUserId() ?? null,
      },
      { onConflict: "slug" },
    )
    .select("id, slug")
    .single();
  if (error) throw new Error(`Could not create the integration: ${error.message}`);
  return { id: data.id as string, slug: data.slug as string };
}

/** Test hook: drop the in-process toolkit cache. */
export function __resetComposioCatalogCache(): void {
  toolkitCache = null;
}
