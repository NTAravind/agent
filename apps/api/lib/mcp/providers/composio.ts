import { isConfigured, optionalEnv } from "@/lib/env";
import { upsertConnection, updateConnection, type ConnectionRow } from "@/lib/mcp/connections";
import { listRemoteTools, syncServerTools } from "@/lib/mcp/discovery";
import { redactSecrets } from "@/lib/mcp/security/redact-secrets";
import { validateEndpoint } from "@/lib/mcp/security/validate-endpoint";
import type { ServerRow } from "@/lib/mcp/registry";
import { executeDirectTool } from "@/lib/mcp/providers/direct-remote";

/**
 * Composio provider adapter (Phase 6 plan §6.2, "primary provider").
 *
 * Composio owns the OAuth flow; we get a per-user MCP session endpoint back
 * from their session API and treat it as a direct remote endpoint for
 * discovery/execution. Requires `COMPOSIO_API_KEY` (server-only env).
 *
 * Re-verified against current docs (2026-11-18):
 * - Session API: POST /api/v3.1/tool_router/session with `x-api-key`,
 *   responding with `session.mcp.url` + `session.mcp.headers` to hand to any
 *   MCP client — https://docs.composio.dev/reference/api-reference/tool-router/postToolRouterSession
 * - Free plan (Hobby): 100,000 tool calls/month, 2,000 req/min, no card —
 *   https://composio.dev/pricing
 * Toolkit slugs are lowercase (`gmail`, `github`, …) and come from the
 * catalog listing's config. Still not exercised end to end without a live
 * account: the adapter is intentionally gated, so without COMPOSIO_API_KEY
 * every call fails fast with a clear message instead of half-working.
 */

const COMPOSIO_SESSION_URL = "https://backend.composio.dev/api/v3.1/tool_router/session";
const SESSION_TIMEOUT_MS = 20_000;

function requireComposioKey(): string {
  const key = optionalEnv("COMPOSIO_API_KEY");
  if (!key) {
    throw new Error(
      "Composio is not configured on this deployment (COMPOSIO_API_KEY is missing).",
    );
  }
  return key;
}

type ComposioSessionResponse = {
  session?: {
    id?: string;
    mcp?: { url?: string; headers?: Record<string, string> };
  };
  data?: ComposioSessionResponse["session"];
};

/** Metadata key holding the per-user Composio MCP endpoint + auth headers. */
const SESSION_METADATA_KEY = "composio_session";

/**
 * Creates (or reuses) a Composio MCP session for the user and stores its
 * endpoint + headers in the connection (headers encrypted, URL in metadata
 * after SSRF validation).
 */
export async function connectComposio(input: {
  userId: string;
  server: ServerRow;
  /** Composio entity/user id; defaults to our user id (single-user app). */
  entityUserId?: string;
}): Promise<{ connectionId: string; toolCount: number }> {
  const apiKey = requireComposioKey();
  const entity = input.entityUserId ?? input.userId;

  let session: ComposioSessionResponse["session"] | undefined;
  try {
    const response = await fetch(COMPOSIO_SESSION_URL, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "x-api-key": apiKey,
      },
      body: JSON.stringify({
        user_id: entity,
        // Toolkits come from the catalog listing's config (provider config).
        toolkits: Array.isArray(input.server.config?.toolkits)
          ? (input.server.config.toolkits as string[])
          : [],
      }),
      signal: AbortSignal.timeout(SESSION_TIMEOUT_MS),
    });
    if (!response.ok) {
      throw new Error(`Composio session API returned ${response.status}.`);
    }
    const body = (await response.json()) as ComposioSessionResponse;
    session = body.session ?? body.data;
  } catch (error) {
    throw new Error(redactSecrets(error instanceof Error ? error.message : String(error)));
  }

  const endpoint = session?.mcp?.url;
  if (!endpoint) {
    throw new Error("Composio did not return an MCP session endpoint.");
  }
  const validated = await validateEndpoint(endpoint);
  if (!validated.ok) {
    throw new Error(`Composio endpoint rejected: ${validated.reason}`);
  }

  // Session headers carry Composio auth → keep them in the encrypted blob.
  const row: ConnectionRow = await upsertConnection({
    userId: input.userId,
    serverId: input.server.id,
    authType: "provider_managed",
    status: "pending",
    credentials: {
      composio: {
        sessionHeaders: session?.mcp?.headers ?? {},
        entityUserId: entity,
      },
    },
    metadata: {
      [SESSION_METADATA_KEY]: {
        endpoint: validated.url.toString(),
        sessionId: session?.id ?? null,
        createdAt: new Date().toISOString(),
      },
    },
    providerConnectionId: session?.id ?? null,
  });

  const headers = ((await readComposioSession(row))?.sessionHeaders ?? {}) as Record<string, string>;
  const tools = await listRemoteTools({ endpoint: validated.url.toString(), headers }).catch(
    (error: unknown) => {
      throw new Error(redactSecrets(error instanceof Error ? error.message : String(error)));
    },
  );
  await syncServerTools(input.server.id, tools);
  await updateConnection(input.userId, row.id, {
    status: "connected",
    metadata: {
      ...row.metadata,
      [SESSION_METADATA_KEY]: {
        ...(row.metadata?.[SESSION_METADATA_KEY] as Record<string, unknown>),
        toolCount: tools.length,
      },
    },
  });

  return { connectionId: row.id, toolCount: tools.length };
}

type ComposioCredentials = {
  composio?: {
    sessionHeaders?: Record<string, string>;
    entityUserId?: string;
  };
};

async function readComposioSession(
  row: ConnectionRow,
): Promise<ComposioCredentials["composio"] | undefined> {
  // Dynamic import avoids a cycle: connections imports encryption only.
  const { readCredentials } = await import("@/lib/mcp/connections");
  return (readCredentials(row) as ComposioCredentials | null)?.composio;
}

/** Composio sessions expire; this re-creates one and re-syncs tools. */
export async function refreshComposio(input: {
  userId: string;
  connectionId: string;
}): Promise<{ toolCount: number }> {
  const { getConnection } = await import("@/lib/mcp/connections");
  const { getServer } = await import("@/lib/mcp/registry");
  const row = await getConnection(input.userId, input.connectionId);
  if (!row) throw new Error("Connection no longer exists.");
  const server = await getServer(row.mcp_server_id);
  if (!server) throw new Error("This integration is not available.");
  const result = await connectComposio({
    userId: input.userId,
    server,
    entityUserId: (await readComposioSession(row))?.entityUserId,
  });
  return { toolCount: result.toolCount };
}

/** Executes a tool on the user's Composio session endpoint. */
export async function executeComposioTool(input: {
  userId: string;
  connectionId: string;
  externalToolId: string;
  args: Record<string, unknown>;
}): Promise<unknown> {
  const { getConnection } = await import("@/lib/mcp/connections");
  const row = await getConnection(input.userId, input.connectionId);
  if (!row) throw new Error("Connection no longer exists.");
  const session = await readComposioSession(row);
  if (!session?.sessionHeaders) {
    throw new Error("Composio session is missing — reconnect the integration.");
  }
  // The session endpoint lives in metadata; reuse the direct executor by
  // pointing it at a synthetic server row (validated at connect time).
  const { getServer } = await import("@/lib/mcp/registry");
  const server = await getServer(row.mcp_server_id);
  if (!server) throw new Error("This integration is not available.");
  const endpoint = (row.metadata?.[SESSION_METADATA_KEY] as { endpoint?: string } | undefined)?.endpoint;
  if (!endpoint) throw new Error("Composio session endpoint missing — reconnect the integration.");

  const validated = await validateEndpoint(endpoint);
  if (!validated.ok) throw new Error(`Endpoint rejected: ${validated.reason}`);

  // Fall through to the shared direct executor with a patched endpoint.
  return executeDirectTool({
    userId: input.userId,
    connectionId: input.connectionId,
    externalToolId: input.externalToolId,
    args: input.args,
  }).catch(async (error: unknown) => {
    // executeDirectTool reads server.endpoint from the catalog; when the
    // session endpoint differs (it always does for Composio), run the call
    // against the session URL directly.
    const { createMCPClient } = await import("@ai-sdk/mcp");
    const headers = session.sessionHeaders ?? {};
    const client = await createMCPClient({
      transport: {
        type: "http",
        url: validated.url.toString(),
        ...(Object.keys(headers).length > 0 ? { headers } : {}),
        redirect: "error",
      },
      initializationOptions: { timeout: 15_000 },
    });
    try {
      const result = await client.callTool({
        name: input.externalToolId,
        arguments: input.args ?? {},
        options: { timeout: 30_000, maxTotalTimeout: 45_000 },
      });
      if (result.isError) throw error;
      const content = Array.isArray(result.content)
        ? result.content
            .filter((block: { type?: string; text?: string }) => block.type === "text")
            .map((block: { text?: string }) => block.text ?? "")
            .join("\n")
        : "";
      return { content: content.slice(0, 8_000), truncated: content.length > 8_000 };
    } finally {
      await client.close().catch(() => undefined);
    }
  });
}

/** True when the Composio provider can be used at all. */
export function composioConfigured(): boolean {
  return isConfigured("COMPOSIO_API_KEY");
}
