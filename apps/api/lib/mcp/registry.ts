import type { MCPAuthType, MCPServer, MCPTransport } from "@agent/shared";

import { allowedUserId, AuthError } from "@/lib/auth";
import { supabaseAdmin } from "@/lib/supabase/server";

/**
 * Marketplace catalog (`mcp_servers`) — Phase 6 plan §6.1.
 *
 * The catalog is shared and read-only for signed-in users (RLS). All writes
 * go through the service role and are gated on the configured admin identity
 * (`ALLOWED_USER_ID`) — a second line of defense beyond `requireUser`.
 */

export type ServerRow = {
  id: string;
  slug: string;
  name: string;
  description: string;
  instructions: string;
  provider: string;
  category: string;
  endpoint: string | null;
  transport: MCPTransport;
  auth_type: MCPAuthType;
  config: Record<string, unknown>;
  capabilities: Record<string, unknown>;
  icon_url: string | null;
  is_verified: boolean;
  is_free_tier: boolean;
  enabled: boolean;
  created_by: string | null;
  created_at: string;
  updated_at: string;
};

const SERVER_COLUMNS =
  "id, slug, name, description, instructions, provider, category, endpoint, transport, auth_type, config, capabilities, icon_url, is_verified, is_free_tier, enabled, created_by, created_at, updated_at";

/** Catalog entry as the marketplace list sees it (with connection flag). */
export type CatalogEntry = MCPServer & {
  connected: boolean;
  connectionId: string | null;
  connectionStatus: string | null;
};

/**
 * Client-facing listing: camelCase, no `created_by`. Returned by every
 * catalog/detail response. `config` is non-secret provider config (header
 * scheme, scopes) — credentials never leave the server.
 */
export type PublicServer = {
  id: string;
  slug: string;
  name: string;
  description: string;
  instructions: string;
  provider: string;
  category: string;
  endpoint: string | null;
  transport: MCPTransport;
  authType: MCPAuthType;
  config: Record<string, unknown>;
  capabilities: Record<string, unknown>;
  iconUrl: string | null;
  isVerified: boolean;
  isFreeTier: boolean;
  enabled: boolean;
  createdAt: string;
  updatedAt: string;
};

/** Maps a stored row to the public listing shape. */
export function toPublicServer(row: ServerRow): PublicServer {
  return {
    id: row.id,
    slug: row.slug,
    name: row.name,
    description: row.description,
    instructions: row.instructions ?? "",
    provider: row.provider,
    category: row.category,
    endpoint: row.endpoint,
    transport: row.transport,
    authType: row.auth_type,
    config: row.config,
    capabilities: row.capabilities,
    iconUrl: row.icon_url,
    isVerified: row.is_verified,
    isFreeTier: row.is_free_tier,
    enabled: row.enabled,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
}

/** Throws unless the caller is the configured admin. */
export function assertAdmin(): void {
  const admin = allowedUserId();
  if (!admin) {
    throw new AuthError("forbidden", "Catalog management is not configured.", 403);
  }
}

export type CatalogFilter = {
  userId: string;
  q?: string;
  category?: string;
  provider?: string;
  authType?: string;
  freeOnly?: boolean;
  connectedOnly?: boolean;
  /** Admin management view: also return disabled listings. */
  includeDisabled?: boolean;
};

export type ConnectionState = { id: string; status: string };

/**
 * The caller's connections keyed by server id — the ONLY source of
 * `connected` anywhere in the catalog. It is scoped by `user_id`, so two
 * users never share connection state: `connected` is strictly
 * `status === "connected"` (pending/expired/error surface separately as
 * `connectionStatus`, which the UI turns into Finish connecting/Reconnect).
 */
export async function connectionStateByServer(
  userId: string,
): Promise<Map<string, ConnectionState>> {
  const { data, error } = await supabaseAdmin()
    .from("user_mcp_connections")
    .select("id, mcp_server_id, status")
    .eq("user_id", userId)
    .in("status", ["pending", "connected", "expired", "error"]);
  if (error) {
    throw new Error(`Could not load connections: ${error.message}`);
  }
  return new Map(
    (data ?? []).map((row) => [
      row.mcp_server_id as string,
      { id: row.id as string, status: row.status as string },
    ]),
  );
}

/** Lists catalog entries with the caller's connection state merged in. */
export async function listCatalog(filter: CatalogFilter): Promise<CatalogEntry[]> {
  let query = supabaseAdmin()
    .from("mcp_servers")
    .select(SERVER_COLUMNS)
    .order("category")
    .order("name");
  if (!filter.includeDisabled) query = query.eq("enabled", true);

  if (filter.q) {
    // ILIKE on name/description; escape LIKE wildcards in user input.
    const escaped = filter.q.replace(/[%_]/g, "\\$&");
    query = query.or(`name.ilike.%${escaped}%,description.ilike.%${escaped}%`);
  }
  if (filter.category) query = query.eq("category", filter.category);
  if (filter.provider) query = query.eq("provider", filter.provider);
  if (filter.authType) query = query.eq("auth_type", filter.authType);
  if (filter.freeOnly) query = query.eq("is_free_tier", true);

  const { data: servers, error } = await query;
  if (error) throw new Error(`Could not list integrations: ${error.message}`);

  const byServer = await connectionStateByServer(filter.userId);

  let entries: CatalogEntry[] = (servers ?? []).map((row) => {
    const connection = byServer.get(row.id as string);
    return {
      ...(row as unknown as MCPServer),
      connected: connection?.status === "connected",
      connectionId: connection?.id ?? null,
      connectionStatus: connection?.status ?? null,
    };
  });

  if (filter.connectedOnly) {
    entries = entries.filter((entry) => entry.connected);
  }
  return entries;
}

export async function getServer(serverId: string): Promise<ServerRow | null> {
  const { data, error } = await supabaseAdmin()
    .from("mcp_servers")
    .select(SERVER_COLUMNS)
    .eq("id", serverId)
    .maybeSingle();
  if (error) throw new Error(`Could not load integration: ${error.message}`);
  return (data as ServerRow | null) ?? null;
}

export async function getServerBySlug(slug: string): Promise<ServerRow | null> {
  const { data, error } = await supabaseAdmin()
    .from("mcp_servers")
    .select(SERVER_COLUMNS)
    .eq("slug", slug)
    .maybeSingle();
  if (error) throw new Error(`Could not load integration: ${error.message}`);
  return (data as ServerRow | null) ?? null;
}

/** Admin-only: creates a catalog entry. Slug must be unique. */
export async function createServer(input: {
  slug: string;
  name: string;
  description?: string;
  instructions?: string;
  provider?: string;
  category?: string;
  endpoint?: string | null;
  transport?: MCPTransport;
  authType: MCPAuthType;
  config?: Record<string, unknown>;
  capabilities?: Record<string, unknown>;
  iconUrl?: string | null;
  isVerified?: boolean;
  isFreeTier?: boolean;
  enabled?: boolean;
}): Promise<ServerRow> {
  assertAdmin();
  const { data, error } = await supabaseAdmin()
    .from("mcp_servers")
    .insert({
      slug: input.slug,
      name: input.name,
      description: input.description ?? "",
      instructions: input.instructions ?? "",
      provider: input.provider ?? "direct",
      category: input.category ?? "other",
      endpoint: input.endpoint ?? null,
      transport: input.transport ?? "streamable_http",
      auth_type: input.authType,
      config: input.config ?? {},
      capabilities: input.capabilities ?? { tools: true },
      icon_url: input.iconUrl ?? null,
      is_verified: input.isVerified ?? false,
      is_free_tier: input.isFreeTier ?? false,
      enabled: input.enabled ?? true,
      created_by: allowedUserId() ?? null,
    })
    .select(SERVER_COLUMNS)
    .single();
  if (error) {
    if (error.code === "23505") {
      throw Object.assign(new Error("That slug is already in use."), {
        status: 409,
        code: "conflict",
      });
    }
    throw new Error(`Could not create integration: ${error.message}`);
  }
  return data as ServerRow;
}

/** Admin-only: patches a catalog entry. */
export async function updateServer(
  serverId: string,
  patch: Partial<{
    slug: string;
    name: string;
    description: string;
    instructions: string;
    provider: string;
    category: string;
    endpoint: string | null;
    transport: MCPTransport;
    authType: MCPAuthType;
    config: Record<string, unknown>;
    capabilities: Record<string, unknown>;
    iconUrl: string | null;
    isVerified: boolean;
    isFreeTier: boolean;
    enabled: boolean;
  }>,
): Promise<ServerRow | null> {
  assertAdmin();
  const update: Record<string, unknown> = { updated_at: new Date().toISOString() };
  if (patch.slug !== undefined) update.slug = patch.slug;
  if (patch.name !== undefined) update.name = patch.name;
  if (patch.description !== undefined) update.description = patch.description;
  if (patch.instructions !== undefined) update.instructions = patch.instructions;
  if (patch.provider !== undefined) update.provider = patch.provider;
  if (patch.category !== undefined) update.category = patch.category;
  if (patch.endpoint !== undefined) update.endpoint = patch.endpoint;
  if (patch.transport !== undefined) update.transport = patch.transport;
  if (patch.authType !== undefined) update.auth_type = patch.authType;
  if (patch.config !== undefined) update.config = patch.config;
  if (patch.capabilities !== undefined) update.capabilities = patch.capabilities;
  if (patch.iconUrl !== undefined) update.icon_url = patch.iconUrl;
  if (patch.isVerified !== undefined) update.is_verified = patch.isVerified;
  if (patch.isFreeTier !== undefined) update.is_free_tier = patch.isFreeTier;
  if (patch.enabled !== undefined) update.enabled = patch.enabled;

  const { data, error } = await supabaseAdmin()
    .from("mcp_servers")
    .update(update)
    .eq("id", serverId)
    .select(SERVER_COLUMNS)
    .maybeSingle();
  if (error) {
    if (error.code === "23505") {
      throw Object.assign(new Error("That slug is already in use."), {
        status: 409,
        code: "conflict",
      });
    }
    throw new Error(`Could not update integration: ${error.message}`);
  }
  return (data as ServerRow | null) ?? null;
}

/** Admin-only: removes a catalog entry (cascades to tools + connections). */
export async function deleteServer(serverId: string): Promise<boolean> {
  assertAdmin();
  const { error } = await supabaseAdmin().from("mcp_servers").delete().eq("id", serverId);
  if (error) throw new Error(`Could not delete integration: ${error.message}`);
  return true;
}
