import type { MCPProviderAdapter, MCPToolDefinition } from "@agent/shared";

import { deleteConnection, getConnection, updateConnection, type ConnectionRow } from "@/lib/mcp/connections";
import { listCachedTools } from "@/lib/mcp/discovery";
import {
  connectComposio,
  executeComposioTool,
  refreshComposio,
} from "@/lib/mcp/providers/composio";
import {
  connectDirect,
  executeDirectTool,
  refreshConnection,
} from "@/lib/mcp/providers/direct-remote";
import type { ServerRow } from "@/lib/mcp/registry";
import { getServer } from "@/lib/mcp/registry";

/**
 * Provider dispatch (Phase 6 plan §6.6 "Provider adapter interface").
 *
 * The catalog is the source of truth; providers are adapters behind one
 * interface. `provider` on the catalog row selects the adapter:
 *   direct     → vendor-hosted Streamable HTTP (none/api_key/pat/oauth2)
 *   composio   → Composio-managed sessions (requires COMPOSIO_API_KEY)
 *   zapier/apify → rejected until their free tiers are verified (plan §6.2).
 */

async function serverFor(
  connectionId: string,
  userId: string,
): Promise<{ row: ConnectionRow; server: ServerRow | null }> {
  const row = await getConnection(userId, connectionId);
  if (!row) throw new Error("Connection no longer exists.");
  const server = await getServer(row.mcp_server_id);
  return { row, server };
}

/** Creates/refreshes a connection and returns its id (+ OAuth URL if needed). */
export async function connectProvider(input: {
  userId: string;
  serverId: string;
  apiKey?: string;
  entityUserId?: string;
}): Promise<{ connectionId: string; authorizationUrl?: string; toolCount?: number }> {
  const server = await getServer(input.serverId);
  if (!server) throw new Error("Unknown integration.");
  if (!server.enabled) throw new Error("This integration is disabled.");

  if (server.provider === "direct") {
    if (server.auth_type === "oauth2") {
      // OAuth start is handled by the connections route (it needs the URL back).
      const { upsertConnection } = await import("@/lib/mcp/connections");
      const existing = await getConnection(input.userId, server.id);
      const row = existing ?? (await upsertConnection({
        userId: input.userId,
        serverId: server.id,
        authType: "oauth2",
        status: "pending",
        metadata: {},
      }));
      return { connectionId: row.id };
    }
    return connectDirect({ userId: input.userId, server, apiKey: input.apiKey });
  }

  if (server.provider === "composio") {
    return connectComposio({ userId: input.userId, server, entityUserId: input.entityUserId });
  }

  throw new Error(
    `The ${server.provider} provider is not available yet (free tier unverified).`,
  );
}

/** Re-runs handshake + tool sync for an existing connection. */
export async function refreshProvider(input: {
  userId: string;
  connectionId: string;
}): Promise<{ toolCount: number; changed: number }> {
  const { row, server } = await serverFor(input.connectionId, input.userId);
  if (!server) throw new Error("This integration no longer exists.");

  if (server.provider === "composio") {
    const result = await refreshComposio({ userId: input.userId, connectionId: row.id });
    return { toolCount: result.toolCount, changed: 0 };
  }
  return refreshConnection({ userId: input.userId, connectionId: row.id });
}

/** Live tool definitions for the marketplace detail view. */
export async function connectionToolDefinitions(input: {
  userId: string;
  connectionId: string;
}): Promise<MCPToolDefinition[]> {
  const { row } = await serverFor(input.connectionId, input.userId);
  const cached = await listCachedTools(row.mcp_server_id);
  return cached.map((tool) => ({
    name: tool.name,
    description: tool.description,
    inputSchema: tool.inputSchema,
    riskLevel: tool.riskLevel,
  }));
}

/** Executes a tool through the connection's provider adapter. */
export async function executeProviderTool(input: {
  userId: string;
  connectionId: string;
  externalToolId: string;
  args: Record<string, unknown>;
}): Promise<unknown> {
  const { row, server } = await serverFor(input.connectionId, input.userId);
  if (!server) throw new Error("This integration no longer exists.");
  if (row.status !== "connected") throw new Error("This integration is not connected.");

  if (server.provider === "composio") {
    return executeComposioTool(input);
  }
  return executeDirectTool(input);
}

/** Disconnects: wipes encrypted credentials and drops agent attachments. */
export async function disconnectProvider(input: {
  userId: string;
  connectionId: string;
}): Promise<void> {
  const row = await getConnection(input.userId, input.connectionId);
  if (!row) return;
  // Keep the row (status=disconnected) so history/attachments stay coherent,
  // but wipe secrets and detach from all agents.
  const admin = (await import("@/lib/supabase/server")).supabaseAdmin();
  await admin
    .from("agent_mcp_servers")
    .delete()
    .eq("user_mcp_connection_id", row.id);
  await updateConnection(input.userId, row.id, {
    status: "disconnected",
    credentials: null,
    metadata: {},
  });
}

/** Full adapter surface per the plan's suggested interface (kept for parity). */
export const mcpAdapter: MCPProviderAdapter = {
  connect: async (input) => {
    const result = await connectProvider({
      userId: input.userId,
      serverId: input.serverId,
      apiKey: input.credentials?.apiKey as string | undefined,
      entityUserId: input.credentials?.entityUserId as string | undefined,
    });
    return { connectionId: result.connectionId, authorizationUrl: result.authorizationUrl };
  },
  discoverTools: async (connectionId) => {
    // discoverTools is connection-scoped in the interface; userId comes from
    // the connection row itself here (single-user product).
    const { supabaseAdmin } = await import("@/lib/supabase/server");
    const { data } = await supabaseAdmin()
      .from("user_mcp_connections")
      .select("user_id")
      .eq("id", connectionId)
      .maybeSingle();
    if (!data) throw new Error("Connection no longer exists.");
    return connectionToolDefinitions({ userId: data.user_id as string, connectionId });
  },
  loadTools: async ({ connectionId, enabledToolIds }) => {
    const definitions = await mcpAdapter.discoverTools(connectionId);
    const allow = enabledToolIds.length > 0 ? new Set(enabledToolIds) : null;
    const result: Record<string, unknown> = {};
    for (const definition of definitions) {
      if (allow && !allow.has(definition.name)) continue;
      result[definition.name] = definition;
    }
    return result;
  },
  executeTool: async ({ connectionId, toolName, arguments: args }) => {
    const { supabaseAdmin } = await import("@/lib/supabase/server");
    const { data } = await supabaseAdmin()
      .from("user_mcp_connections")
      .select("user_id")
      .eq("id", connectionId)
      .maybeSingle();
    if (!data) throw new Error("Connection no longer exists.");
    return executeProviderTool({
      userId: data.user_id as string,
      connectionId,
      externalToolId: toolName,
      args: (args as Record<string, unknown>) ?? {},
    });
  },
  disconnect: async (connectionId) => {
    const { supabaseAdmin } = await import("@/lib/supabase/server");
    const { data } = await supabaseAdmin()
      .from("user_mcp_connections")
      .select("user_id")
      .eq("id", connectionId)
      .maybeSingle();
    if (!data) return;
    await disconnectProvider({ userId: data.user_id as string, connectionId });
  },
};

export { deleteConnection };
