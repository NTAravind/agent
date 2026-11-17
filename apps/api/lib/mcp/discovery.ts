import { createHash } from "node:crypto";

import { createMCPClient } from "@ai-sdk/mcp";

import { supabaseAdmin } from "@/lib/supabase/server";
import { validateEndpoint } from "@/lib/mcp/security/validate-endpoint";
import {
  classifyToolRisk,
  MAX_TOOL_SCHEMA_BYTES,
  sanitizeDescription,
  type ToolAnnotations,
} from "@/lib/mcp/risk";

/**
 * MCP handshake + tool discovery (Phase 6 plan §6.5).
 *
 * Remote tool definitions are UNTRUSTED input: names are sanitized, descriptions
 * are capped, schemas are size-checked and validated as JSON Schema objects,
 * and every risk/approval decision is re-derived server-side (annotations and
 * description text can lie — see risk.ts).
 *
 * The endpoint must pass SSRF validation before we connect, and the transport
 * runs with `redirect: "error"` so a public host can't bounce us into a
 * private network after validation.
 */

/** One discovered tool, already sanitized + classified. */
export type DiscoveredTool = {
  externalToolId: string;
  name: string;
  description: string;
  inputSchema: Record<string, unknown>;
  riskLevel: "low" | "medium" | "high";
  approvalRequiredDefault: boolean;
  schemaHash: string;
};

const MAX_TOOL_PAGES = 5;
const MAX_TOOLS_PER_SERVER = 100;
const HANDSHAKE_TIMEOUT_MS = 15_000;

type RawMcpTool = {
  name?: unknown;
  description?: unknown;
  title?: unknown;
  inputSchema?: unknown;
  annotations?: {
    readOnlyHint?: boolean;
    destructiveHint?: boolean;
    idempotentHint?: boolean;
    openWorldHint?: boolean;
    title?: string;
  };
};

/** Stable hash of a tool's input schema (change detection for syncs). */
function hashSchema(schema: Record<string, unknown>): string {
  // Stable stringify: sort keys so cosmetic reorderings don't look like changes.
  const canonical = JSON.stringify(schema, Object.keys(schema).sort());
  return createHash("sha256").update(canonical).digest("hex").slice(0, 32);
}

/**
 * Normalizes one raw MCP tool definition. Returns null when the definition is
 * too malformed to expose to the model (bad name, unusable schema).
 */
function normalizeTool(raw: RawMcpTool): DiscoveredTool | null {
  if (typeof raw.name !== "string" || !raw.name.trim()) return null;
  // Server-supplied names can contain anything; strip control chars and cap
  // length. The cleaned name is what we call back with.
  const externalToolId = raw.name
    .replace(/[\x00-\x1f\x7f]/g, "")
    .trim()
    .slice(0, 200);
  if (!externalToolId) return null;

  const description = sanitizeDescription(
    typeof raw.description === "string" ? raw.description : (raw.title ?? ""),
  );

  // Input schema must be a JSON Schema object; reject or fall back to an
  // open object schema (some servers omit it).
  let inputSchema: Record<string, unknown> = { type: "object", properties: {} };
  if (raw.inputSchema && typeof raw.inputSchema === "object" && !Array.isArray(raw.inputSchema)) {
    const candidate = raw.inputSchema as Record<string, unknown>;
    const serialized = JSON.stringify(candidate);
    if (serialized.length <= MAX_TOOL_SCHEMA_BYTES) {
      inputSchema = candidate;
    } else {
      // Oversized schema: keep the tool but with an open schema so the model
      // can still call it (args are validated by the server anyway).
      inputSchema = { type: "object", properties: {} };
    }
  }

  const annotations = (raw.annotations ?? null) as ToolAnnotations | null;
  const { riskLevel, approvalRequired } = classifyToolRisk({
    name: externalToolId,
    description,
    annotations,
  });

  return {
    externalToolId,
    name: externalToolId,
    description,
    inputSchema,
    riskLevel,
    approvalRequiredDefault: approvalRequired,
    schemaHash: hashSchema(inputSchema),
  };
}

export type DiscoverInput = {
  endpoint: string;
  /** Auth headers for this connection (built by the provider adapter). */
  headers?: Record<string, string>;
  /** Abort early if the server offers more than this many tools. */
  maxTools?: number;
};

/**
 * Connects to a remote MCP endpoint and lists its tools (paginated).
 * Throws with a redacted message on any handshake/transport failure.
 */
export async function listRemoteTools(input: DiscoverInput): Promise<DiscoveredTool[]> {
  const validated = await validateEndpoint(input.endpoint);
  if (!validated.ok) {
    throw new Error(`Endpoint rejected: ${validated.reason}`);
  }

  const maxTools = Math.min(input.maxTools ?? MAX_TOOLS_PER_SERVER, MAX_TOOLS_PER_SERVER);
  const client = await createMCPClient({
    transport: {
      type: "http",
      url: validated.url.toString(),
      ...(input.headers && Object.keys(input.headers).length > 0
        ? { headers: input.headers }
        : {}),
      redirect: "error",
    },
    initializationOptions: { timeout: HANDSHAKE_TIMEOUT_MS },
  });

  try {
    const tools: DiscoveredTool[] = [];
    const seen = new Set<string>();
    let cursor: string | undefined;

    for (let page = 0; page < MAX_TOOL_PAGES && tools.length < maxTools; page += 1) {
      const result = await client.listTools({
        ...(cursor ? { params: { cursor } } : {}),
        options: { timeout: HANDSHAKE_TIMEOUT_MS, maxTotalTimeout: 30_000 },
      });
      const rawTools = (result.tools ?? []) as RawMcpTool[];

      for (const raw of rawTools) {
        const normalized = normalizeTool(raw);
        if (!normalized) continue;
        // Dedupe by external id (servers occasionally repeat names).
        if (seen.has(normalized.externalToolId)) continue;
        seen.add(normalized.externalToolId);
        tools.push(normalized);
        if (tools.length >= maxTools) break;
      }

      cursor = typeof result.nextCursor === "string" ? result.nextCursor : undefined;
      if (!cursor) break;
    }

    return tools;
  } finally {
    await client.close().catch(() => undefined);
  }
}

/**
 * Upserts discovered tools into the cached catalog for a server and disables
 * tools the server no longer offers. Existing per-agent permission rows are
 * untouched (they reference mcp_tool_id and survive re-discovery).
 */
export async function syncServerTools(
  serverId: string,
  tools: DiscoveredTool[],
): Promise<{ added: number; updated: number; removed: number }> {
  const now = new Date().toISOString();
  const { data: existing, error: existingError } = await supabaseAdmin()
    .from("mcp_tools")
    .select("id, external_tool_id, schema_hash, enabled")
    .eq("mcp_server_id", serverId);
  if (existingError) {
    throw new Error(`Could not read cached tools: ${existingError.message}`);
  }

  const byExternalId = new Map(
    (existing ?? []).map((row) => [row.external_tool_id as string, row]),
  );

  let added = 0;
  let updated = 0;
  let removed = 0;

  const discoveredIds = new Set(tools.map((tool) => tool.externalToolId));

  for (const tool of tools) {
    const prior = byExternalId.get(tool.externalToolId);
    if (!prior) added += 1;
    else if (prior.schema_hash !== tool.schemaHash || !prior.enabled) updated += 1;

    const { error } = await supabaseAdmin().from("mcp_tools").upsert(
      {
        mcp_server_id: serverId,
        external_tool_id: tool.externalToolId,
        name: tool.name,
        description: tool.description,
        input_schema: tool.inputSchema,
        risk_level: tool.riskLevel,
        approval_required_default: tool.approvalRequiredDefault,
        enabled: true,
        schema_hash: tool.schemaHash,
        discovered_at: now,
      },
      { onConflict: "mcp_server_id,external_tool_id" },
    );
    if (error) throw new Error(`Could not cache tool: ${error.message}`);
  }

  // Disable tools the server dropped (never delete: permission rows reference them).
  for (const row of existing ?? []) {
    if (!discoveredIds.has(row.external_tool_id as string) && row.enabled) {
      removed += 1;
      const { error } = await supabaseAdmin()
        .from("mcp_tools")
        .update({ enabled: false })
        .eq("id", row.id as string);
      if (error) throw new Error(`Could not disable stale tool: ${error.message}`);
    }
  }

  return { added, updated, removed };
}

/**
 * Runs the handshake for a catalog server and refreshes the cached tool
 * catalog. For `none` listings this works anonymously; api_key/oauth2
 * listings must refresh through their connection (which carries credentials),
 * so those use the connection's own refresh route instead.
 */
export async function discoverServerTools(input: {
  userId: string;
  server: {
    id: string;
    endpoint: string | null;
    auth_type: string;
  };
}): Promise<{ tools: number; added: number; updated: number; removed: number }> {
  if (!input.server.endpoint) {
    throw Object.assign(new Error("This integration has no endpoint."), {
      status: 400,
      code: "bad_request",
    });
  }
  if (input.server.auth_type !== "none") {
    // Use the connection's credentials via the connection refresh path.
    const { getConnectionForServer } = await import("@/lib/mcp/connections");
    const { refreshConnection } = await import("@/lib/mcp/providers/direct-remote");
    const connection = await getConnectionForServer(input.userId, input.server.id);
    if (!connection) {
      throw Object.assign(
        new Error("Connect this integration first — its tools need its credentials."),
        { status: 400, code: "bad_request" },
      );
    }
    const result = await refreshConnection({
      userId: input.userId,
      connectionId: connection.id,
    });
    return { tools: result.toolCount, added: 0, updated: 0, removed: result.changed };
  }

  const tools = await listRemoteTools({ endpoint: input.server.endpoint }).catch(
    (error: unknown) => {
      throw new Error(
        `Discovery failed: ${error instanceof Error ? error.message : String(error)}`,
      );
    },
  );
  const sync = await syncServerTools(input.server.id, tools);
  return { tools: tools.length, ...sync };
}

/** Lists cached tools for a server (the marketplace detail view reads this). */
export async function listCachedTools(serverId: string): Promise<
  Array<{
    id: string;
    externalToolId: string;
    name: string;
    description: string;
    inputSchema: Record<string, unknown>;
    riskLevel: "low" | "medium" | "high";
    approvalRequiredDefault: boolean;
    enabled: boolean;
    schemaHash: string;
    discoveredAt: string;
  }>
> {
  const { data, error } = await supabaseAdmin()
    .from("mcp_tools")
    .select(
      "id, external_tool_id, name, description, input_schema, risk_level, approval_required_default, enabled, schema_hash, discovered_at",
    )
    .eq("mcp_server_id", serverId)
    .eq("enabled", true)
    .order("name");
  if (error) throw new Error(`Could not list tools: ${error.message}`);

  return (data ?? []).map((row) => ({
    id: row.id as string,
    externalToolId: row.external_tool_id as string,
    name: row.name as string,
    description: row.description as string,
    inputSchema: (row.input_schema as Record<string, unknown>) ?? {},
    riskLevel: row.risk_level as "low" | "medium" | "high",
    approvalRequiredDefault: Boolean(row.approval_required_default),
    enabled: Boolean(row.enabled),
    schemaHash: row.schema_hash as string,
    discoveredAt: row.discovered_at as string,
  }));
}
