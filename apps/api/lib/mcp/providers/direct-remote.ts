import type { MCPToolDefinition } from "@agent/shared";

import { createMCPClient } from "@ai-sdk/mcp";

import { getConnection, readCredentials, updateConnection, type ConnectionRow } from "@/lib/mcp/connections";
import { listRemoteTools, syncServerTools, type DiscoveredTool } from "@/lib/mcp/discovery";
import { getFreshAccessToken } from "@/lib/mcp/oauth";
import { redactSecrets } from "@/lib/mcp/security/redact-secrets";
import { validateEndpoint } from "@/lib/mcp/security/validate-endpoint";
import type { ServerRow } from "@/lib/mcp/registry";
import { getServer } from "@/lib/mcp/registry";

/**
 * Direct remote MCP adapter (Phase 6 plan §6.3): vendor-hosted Streamable
 * HTTP endpoints. Handles every auth_type except provider_managed:
 *   none      → anonymous handshake
 *   api_key/pat → header from catalog `config.auth`, value from encrypted creds
 *   oauth2    → Bearer token, lazily refreshed via `getFreshAccessToken`
 *
 * All traffic re-validates the endpoint (SSRF) on every request and runs with
 * `redirect: "error"`. Errors are redacted before they leave this module.
 */

const CONNECT_TIMEOUT_MS = 15_000;
const CALL_TIMEOUT_MS = 30_000;
const MAX_CALL_TOTAL_MS = 45_000;
/** Hard cap on one tool result so a hostile server can't flood the context. */
const MAX_RESULT_CHARS = 8_000;
/** In-process concurrency guard (single-user app; keeps us a good citizen). */
const MAX_CONCURRENT_CALLS = 4;

let activeCalls = 0;
const waiters: Array<() => void> = [];

async function acquireSlot(): Promise<void> {
  if (activeCalls < MAX_CONCURRENT_CALLS) {
    activeCalls += 1;
    return;
  }
  await new Promise<void>((resolve) => waiters.push(resolve));
  activeCalls += 1;
}

function releaseSlot(): void {
  activeCalls = Math.max(0, activeCalls - 1);
  waiters.shift()?.();
}

type AuthHeaderConfig = {
  header?: string;
  prefix?: string;
};

/** Builds auth headers for a connection from its server + encrypted creds. */
export async function buildAuthHeaders(server: ServerRow, row: ConnectionRow): Promise<Record<string, string>> {
  if (row.auth_type === "none") return {};

  if (row.auth_type === "api_key" || row.auth_type === "pat") {
    const credentials = readCredentials(row);
    const apiKey = credentials?.apiKey;
    if (!apiKey) {
      throw new Error("This integration has no stored API key — reconnect it in Integrations.");
    }
    const authConfig = (server.config?.auth ?? {}) as AuthHeaderConfig;
    const header = authConfig.header ?? "Authorization";
    const prefix = authConfig.prefix ?? "Bearer ";
    return { [header]: `${prefix}${apiKey}` };
  }

  if (row.auth_type === "oauth2") {
    const accessToken = await getFreshAccessToken({
      connectionId: row.id,
      userId: row.user_id,
      serverUrl: server.endpoint ?? "",
    });
    return { Authorization: `Bearer ${accessToken}` };
  }

  return {};
}

export type DirectConnectResult = {
  connectionId: string;
  authorizationUrl?: string;
  toolCount?: number;
};

/**
 * Connects a direct-remote server for a user: persists (encrypted)
 * credentials, runs the handshake, caches tools, and marks the connection.
 * `credentials.apiKey` is required for api_key/pat servers.
 */
export async function connectDirect(input: {
  userId: string;
  server: ServerRow;
  apiKey?: string;
}): Promise<DirectConnectResult> {
  const { userId, server } = input;
  if (!server.enabled || !server.endpoint) {
    throw new Error("This integration is not available.");
  }
  const validated = await validateEndpoint(server.endpoint);
  if (!validated.ok) {
    throw new Error(`Endpoint rejected: ${validated.reason}`);
  }

  // OAuth is started by the caller (it needs the authorization URL back).
  if (server.auth_type === "oauth2") {
    throw new Error("OAuth servers must be connected through the OAuth flow.");
  }

  if ((server.auth_type === "api_key" || server.auth_type === "pat") && !input.apiKey?.trim()) {
    throw new Error("An API key is required for this integration.");
  }

  // Overwrite any prior connection for this server (unique per user+server).
  const row = await upsertDirectConnection(userId, server, input.apiKey?.trim() ?? null);

  const headers = await buildAuthHeaders(server, row);
  const tools = await listRemoteTools({ endpoint: validated.url.toString(), headers }).catch(
    (error: unknown) => {
      throw new Error(redactSecrets(error instanceof Error ? error.message : String(error)));
    },
  );
  await syncServerTools(server.id, tools);
  await updateConnection(userId, row.id, { status: "connected", metadata: { toolCount: tools.length } });

  return { connectionId: row.id, toolCount: tools.length };
}

async function upsertDirectConnection(
  userId: string,
  server: ServerRow,
  apiKey: string | null,
): Promise<ConnectionRow> {
  const { upsertConnection } = await import("@/lib/mcp/connections");
  return upsertConnection({
    userId,
    serverId: server.id,
    authType: server.auth_type,
    status: "pending",
    credentials: apiKey ? { apiKey } : null,
    metadata: {},
  });
}

/** Re-runs the handshake + tool sync for an existing connection (health check). */
export async function refreshConnection(input: {
  userId: string;
  connectionId: string;
}): Promise<{ toolCount: number; changed: number }> {
  const row = await getConnection(input.userId, input.connectionId);
  if (!row) throw new Error("Connection no longer exists.");
  const server = await getServer(row.mcp_server_id);
  if (!server?.endpoint) throw new Error("This integration is not available.");

  const validated = await validateEndpoint(server.endpoint);
  if (!validated.ok) throw new Error(`Endpoint rejected: ${validated.reason}`);

  const headers = await buildAuthHeaders(server, row);
  const tools = await listRemoteTools({ endpoint: validated.url.toString(), headers }).catch(
    (error: unknown) => {
      throw new Error(redactSecrets(error instanceof Error ? error.message : String(error)));
    },
  );
  const sync = await syncServerTools(server.id, tools);
  await updateConnection(input.userId, row.id, {
    status: "connected",
    metadata: { ...(row.metadata ?? {}), toolCount: tools.length, lastSync: new Date().toISOString() },
  });
  return { toolCount: tools.length, changed: sync.added + sync.updated + sync.removed };
}

/**
 * Executes one tool on a direct-remote server. The result is text-only,
 * size-capped, and secret-redacted on the error path.
 */
export async function executeDirectTool(input: {
  userId: string;
  connectionId: string;
  externalToolId: string;
  args: Record<string, unknown>;
}): Promise<unknown> {
  const row = await getConnection(input.userId, input.connectionId);
  if (!row || row.status !== "connected") {
    throw new Error("This integration is not connected.");
  }
  const server = await getServer(row.mcp_server_id);
  if (!server?.endpoint) throw new Error("This integration is not available.");

  const validated = await validateEndpoint(server.endpoint);
  if (!validated.ok) throw new Error(`Endpoint rejected: ${validated.reason}`);

  const headers = await buildAuthHeaders(server, row);

  await acquireSlot();
  try {
    const client = await createMCPClient({
      transport: {
        type: "http",
        url: validated.url.toString(),
        ...(Object.keys(headers).length > 0 ? { headers } : {}),
        redirect: "error",
      },
      initializationOptions: { timeout: CONNECT_TIMEOUT_MS },
    });
    try {
      const result = await client.callTool({
        name: input.externalToolId,
        arguments: input.args ?? {},
        options: { timeout: CALL_TIMEOUT_MS, maxTotalTimeout: MAX_CALL_TOTAL_MS },
      });

      if (result.isError) {
        throw new Error(extractText(result.content) || "The tool reported an error.");
      }
      const text = extractText(result.content);
      return { content: text.slice(0, MAX_RESULT_CHARS), truncated: text.length > MAX_RESULT_CHARS };
    } finally {
      await client.close().catch(() => undefined);
    }
  } catch (error) {
    const message = redactSecrets(error instanceof Error ? error.message : String(error));
    // A 401/403 here usually means the grant died between checks.
    if (/\b(401|403|unauthorized|invalid_token)\b/i.test(message)) {
      await updateConnection(input.userId, row.id, { status: "expired" }).catch(() => undefined);
    }
    throw new Error(message.slice(0, 500));
  } finally {
    releaseSlot();
  }
}

type ContentBlock = { type?: string; text?: string };

function extractText(content: unknown): string {
  if (!Array.isArray(content)) return "";
  const parts: string[] = [];
  for (const block of content as ContentBlock[]) {
    if (block?.type === "text" && typeof block.text === "string") parts.push(block.text);
  }
  return parts.join("\n").trim();
}

/** Adapter-shaped helpers used by the marketplace routes. */
export async function discoverDirectTools(input: {
  userId: string;
  server: ServerRow;
}): Promise<DiscoveredTool[]> {
  const row = await getConnection(input.userId, input.server.id);
  const headers = row ? await buildAuthHeaders(input.server, row) : {};
  const endpoint = input.server.endpoint;
  if (!endpoint) throw new Error("This integration has no endpoint.");
  const validated = await validateEndpoint(endpoint);
  if (!validated.ok) throw new Error(`Endpoint rejected: ${validated.reason}`);
  return listRemoteTools({ endpoint: validated.url.toString(), headers }).catch((error: unknown) => {
    throw new Error(redactSecrets(error instanceof Error ? error.message : String(error)));
  });
}

/** Cached → live tool definitions for a connection (marketplace detail view). */
export async function loadConnectionToolDefinitions(input: {
  userId: string;
  connectionId: string;
}): Promise<MCPToolDefinition[]> {
  const { listCachedTools } = await import("@/lib/mcp/discovery");
  const row = await getConnection(input.userId, input.connectionId);
  if (!row) throw new Error("Connection no longer exists.");
  const cached = await listCachedTools(row.mcp_server_id);
  return cached.map((tool) => ({
    name: tool.name,
    description: tool.description,
    inputSchema: tool.inputSchema,
    riskLevel: tool.riskLevel,
  }));
}
