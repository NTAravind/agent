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
  "id, slug, name, description, provider, category, endpoint, transport, auth_type, config, capabilities, icon_url, is_verified, is_free_tier, enabled, created_by, created_at, updated_at";

/** Catalog entry as the marketplace list sees it (with connection flag). */
export type CatalogEntry = MCPServer & {
  connected: boolean;
  connectionId: string | null;
  connectionStatus: string | null;
};

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
};

/** Lists enabled catalog entries with the caller's connection state merged in. */
export async function listCatalog(filter: CatalogFilter): Promise<CatalogEntry[]> {
  let query = supabaseAdmin()
    .from("mcp_servers")
    .select(SERVER_COLUMNS)
    .eq("enabled", true)
    .order("category")
    .order("name");

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

  const { data: connections, error: connError } = await supabaseAdmin()
    .from("user_mcp_connections")
    .select("id, mcp_server_id, status")
    .eq("user_id", filter.userId)
    .in("status", ["pending", "connected", "expired", "error"]);
  if (connError) {
    throw new Error(`Could not load connections: ${connError.message}`);
  }

  const byServer = new Map(
    (connections ?? []).map((row) => [
      row.mcp_server_id as string,
      { id: row.id as string, status: row.status as string },
    ]),
  );

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
}): Promise<ServerRow> {
  assertAdmin();
  const { data, error } = await supabaseAdmin()
    .from("mcp_servers")
    .insert({
      slug: input.slug,
      name: input.name,
      description: input.description ?? "",
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
      enabled: true,
      created_by: allowedUserId() ?? null,
    })
    .select(SERVER_COLUMNS)
    .single();
  if (error) throw new Error(`Could not create integration: ${error.message}`);
  return data as ServerRow;
}

/** Admin-only: patches a catalog entry. */
export async function updateServer(
  serverId: string,
  patch: Partial<{
    name: string;
    description: string;
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
  if (patch.name !== undefined) update.name = patch.name;
  if (patch.description !== undefined) update.description = patch.description;
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
  if (error) throw new Error(`Could not update integration: ${error.message}`);
  return (data as ServerRow | null) ?? null;
}

/** Admin-only: removes a catalog entry (cascades to tools + connections). */
export async function deleteServer(serverId: string): Promise<boolean> {
  assertAdmin();
  const { error } = await supabaseAdmin().from("mcp_servers").delete().eq("id", serverId);
  if (error) throw new Error(`Could not delete integration: ${error.message}`);
  return true;
}
