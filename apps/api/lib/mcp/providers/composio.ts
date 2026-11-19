import { isConfigured, optionalEnv } from "@/lib/env";
import { upsertConnection, updateConnection, type ConnectionRow } from "@/lib/mcp/connections";
import { listRemoteTools, syncServerTools } from "@/lib/mcp/discovery";
import { redactSecrets } from "@/lib/mcp/security/redact-secrets";
import { validateEndpoint } from "@/lib/mcp/security/validate-endpoint";
import type { ServerRow } from "@/lib/mcp/registry";

/**
 * Composio provider adapter (Phase 6 plan §6.2, "primary provider").
 *
 * Composio owns the OAuth flow; we get a per-user MCP session endpoint back
 * from their session API and treat it as a direct remote endpoint for
 * discovery/execution. Requires `COMPOSIO_API_KEY` (server-only env).
 *
 * Re-verified against the live API (2026-11-18):
 * - Session API: POST /api/v3.1/tool_router/session with `x-api-key` and body
 *   `{ user_id, toolkits: { enable: [slug…] } }` → 201 with a FLAT response:
 *   `{ session_id, mcp: { type: "http", url } }` (no nested session object).
 * - The MCP endpoint is authenticated with the same Platform key, sent as
 *   `x-api-key` (Composio's 401 body lists x-api-key / x-user-api-key /
 *   Authorization: Bearer). It is injected from env at request time — never
 *   stored in the connection.
 * - `tools/list` returns Composio's meta-tools (COMPOSIO_SEARCH_TOOLS,
 *   COMPOSIO_MULTI_EXECUTE_TOOL, …); the agent reaches Gmail/GitHub/…
 *   tools through them.
 * - Free plan (Hobby): 100,000 tool calls/month, 2,000 req/min, no card —
 *   https://composio.dev/pricing
 * Without COMPOSIO_API_KEY every call fails fast with a clear message.
 */

const COMPOSIO_SESSION_URL = "https://backend.composio.dev/api/v3.1/tool_router/session";
const SESSION_TIMEOUT_MS = 20_000;

/** Exported for the marketplace catalog proxy (same key, same guards). */
export function requireComposioKey(): string {
  const key = optionalEnv("COMPOSIO_API_KEY");
  if (!key) {
    throw new Error(
      "Composio is not configured on this deployment (COMPOSIO_API_KEY is missing).",
    );
  }
  // A ck_ value is a Composio *Connect consumer* key (sent as
  // x-consumer-api-key); the session API only accepts a Platform API key.
  if (key.startsWith("ck_")) {
    throw Object.assign(
      new Error(
        "COMPOSIO_API_KEY is a Composio Connect consumer key (ck_…), which this API does not accept. " +
          "Use the Platform API key (ak_…) from the Composio dashboard → Settings → Project Settings → API Keys.",
      ),
      { status: 400, code: "bad_request" },
    );
  }
  return key;
}

/**
 * Auth headers for a session's MCP endpoint. Older responses carried their
 * own `mcp.headers`; current ones don't, so the Platform key (from env) is
 * injected here — and wins only when the server didn't supply its own.
 */
function mcpHeaders(sessionHeaders?: Record<string, string>): Record<string, string> {
  return { "x-api-key": requireComposioKey(), ...(sessionHeaders ?? {}) };
}

type ComposioSessionResponse = {
  /** Current v3.1 shape (verified live 2026-11-18). */
  session_id?: string;
  mcp?: { type?: string; url?: string; headers?: Record<string, string> };
  /** Older/wrapped shapes, kept so a legacy response still parses. */
  session?: { id?: string; mcp?: { url?: string; headers?: Record<string, string> } };
  data?: ComposioSessionResponse["session"];
};

/** Listing config `toolkits` → the object form the session API requires. */
function sessionToolkits(config: ServerRow["config"]): Record<string, unknown> | undefined {
  const raw = config?.toolkits;
  if (Array.isArray(raw)) {
    const slugs = raw.filter((slug): slug is string => typeof slug === "string");
    return slugs.length > 0 ? { enable: slugs } : undefined;
  }
  if (raw && typeof raw === "object") return raw as Record<string, unknown>;
  return undefined;
}

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

  let session: ComposioSessionResponse | undefined;
  try {
    const toolkits = sessionToolkits(input.server.config);
    const response = await fetch(COMPOSIO_SESSION_URL, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "x-api-key": apiKey,
      },
      body: JSON.stringify({
        user_id: entity,
        // Allowlist from the catalog listing's config, in the object form the
        // API validates (a bare array → 400 "payload.toolkits: Invalid input").
        ...(toolkits ? { toolkits } : {}),
      }),
      signal: AbortSignal.timeout(SESSION_TIMEOUT_MS),
    });
    if (!response.ok) {
      // Surface Composio's own error body (redacted) — a bare status code is
      // undiagnosable in the app ("internal error: returned 401").
      const detail = await response.text().catch(() => "");
      const summary = redactSecrets(detail.slice(0, 400)).trim() || "no details";
      const status = response.status;
      throw Object.assign(
        new Error(`Composio session API rejected the request (${status}): ${summary}`),
        status >= 400 && status < 500 ? { status, code: "bad_request" } : {},
      );
    }
    const body = (await response.json()) as ComposioSessionResponse;
    session = body;
  } catch (error) {
    const message = redactSecrets(error instanceof Error ? error.message : String(error));
    const carried = error as { status?: unknown; code?: unknown } | null;
    // Keep a deliberate 4xx status/code through the re-wrap so the route
    // answers 4xx with this message instead of a generic 500.
    if (typeof carried?.status === "number") {
      throw Object.assign(new Error(message), {
        status: carried.status,
        ...(typeof carried.code === "string" ? { code: carried.code } : {}),
      });
    }
    throw new Error(message);
  }

  // Current responses are flat ({ session_id, mcp: { url } }); older ones
  // nest under `session`/`data` — accept both.
  const wrapped = session?.session ?? session?.data;
  const endpoint = session?.mcp?.url ?? wrapped?.mcp?.url;
  const sessionId = session?.session_id ?? wrapped?.id ?? null;
  const serverHeaders = session?.mcp?.headers ?? wrapped?.mcp?.headers;
  if (!endpoint) {
    throw new Error("Composio did not return an MCP session endpoint.");
  }
  const validated = await validateEndpoint(endpoint);
  if (!validated.ok) {
    throw new Error(`Composio endpoint rejected: ${validated.reason}`);
  }

  // Any server-supplied session headers go in the encrypted blob; the
  // Platform API key is NOT stored — `mcpHeaders()` injects it from env.
  const row: ConnectionRow = await upsertConnection({
    userId: input.userId,
    serverId: input.server.id,
    authType: "provider_managed",
    status: "pending",
    credentials: {
      composio: {
        sessionHeaders: serverHeaders ?? {},
        entityUserId: entity,
      },
    },
    metadata: {
      [SESSION_METADATA_KEY]: {
        endpoint: validated.url.toString(),
        sessionId,
        createdAt: new Date().toISOString(),
      },
    },
    providerConnectionId: sessionId,
  });

  const headers = mcpHeaders((await readComposioSession(row))?.sessionHeaders);
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
  // The session endpoint lives in metadata (validated at connect time); the
  // listing row has no endpoint, so there is no shared direct path to reuse.
  const endpoint = (row.metadata?.[SESSION_METADATA_KEY] as { endpoint?: string } | undefined)
    ?.endpoint;
  if (!endpoint) throw new Error("Composio session endpoint missing — reconnect the integration.");

  const validated = await validateEndpoint(endpoint);
  if (!validated.ok) throw new Error(`Endpoint rejected: ${validated.reason}`);

  const { createMCPClient } = await import("@ai-sdk/mcp");
  const headers = mcpHeaders(session?.sessionHeaders);
  const client = await createMCPClient({
    transport: {
      type: "http",
      url: validated.url.toString(),
      headers,
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
    const content = Array.isArray(result.content)
      ? result.content
          .filter((block: { type?: string; text?: string }) => block.type === "text")
          .map((block: { text?: string }) => block.text ?? "")
          .join("\n")
      : "";
    if (result.isError) {
      // Surface Composio's tool error, not a stale one from a prior attempt.
      throw new Error(
        redactSecrets(`Composio tool "${input.externalToolId}" failed: ${content.slice(0, 500) || "no details"}`),
      );
    }
    return { content: content.slice(0, 8_000), truncated: content.length > 8_000 };
  } finally {
    await client.close().catch(() => undefined);
  }
}

/** True when the Composio provider can be used at all. */
export function composioConfigured(): boolean {
  return isConfigured("COMPOSIO_API_KEY");
}
