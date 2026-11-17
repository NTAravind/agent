import { createHash } from "node:crypto";

import { jsonSchema, tool, type Tool } from "ai";

import { supabaseAdmin } from "@/lib/supabase/server";
import { readCredentials, type ConnectionRow } from "@/lib/mcp/connections";
import { executeComposioTool } from "@/lib/mcp/providers/composio";
import { executeDirectTool } from "@/lib/mcp/providers/direct-remote";
import type { ServerRow } from "@/lib/mcp/registry";

/**
 * Runtime tool loading (Phase 6 plan §6.6).
 *
 * At run start we resolve the run's agent, load its enabled MCP attachments
 * (connection must still be `connected`, server and tool `enabled`), apply
 * per-agent permission rows, and build namespaced AI SDK declarations.
 *
 * Tool names are namespaced `mcp_<slug>_<tool>` so a remote server can never
 * shadow a built-in (`web_search`, `write_note`, …). Remote descriptions and
 * schemas are untrusted: descriptions were sanitized at discovery, schemas
 * are size-capped JSON Schema passed through `jsonSchema()` (validation
 * happens against the schema the model fills in, then again by the server).
 */

/** Hard cap so one agent can't flood the model with hundreds of tools. */
const MAX_MCP_TOOLS_PER_RUN = 20;

export type LoadedMcpTool = {
  /** Namespaced name as exposed to the model. */
  name: string;
  connectionId: string;
  serverId: string;
  serverSlug: string;
  serverName: string;
  provider: string;
  externalToolId: string;
  description: string;
  inputSchema: Record<string, unknown>;
  riskLevel: "low" | "medium" | "high";
  approvalRequired: boolean;
};

/** Everything the graph needs to expose + gate + execute MCP tools. */
export type McpToolRuntime = {
  tools: Map<string, LoadedMcpTool>;
  /** AI SDK tool declarations (no execute — the graph executes them). */
  declarations: Record<string, Tool>;
  /** Namespaced names that must pass the approval gate. */
  approvalRequired: Set<string>;
  handles: (name: string) => boolean;
  requiresApproval: (name: string) => boolean;
  execute: (name: string, args: Record<string, unknown>) => Promise<unknown>;
};

/** Sanitizes a fragment of a tool name to [a-zA-Z0-9_]. */
function sanitizeFragment(value: string): string {
  return value.replace(/[^a-zA-Z0-9_]+/g, "_").replace(/_+/g, "_").replace(/^_+|_+$/g, "");
}

function shortHash(value: string): string {
  return createHash("sha256").update(value).digest("hex").slice(0, 6);
}

/** Builds the namespaced model-facing name for one remote tool. */
export function namespacedToolName(serverSlug: string, externalToolId: string): string {
  const slug = sanitizeFragment(serverSlug) || "server";
  const toolPart = sanitizeFragment(externalToolId) || "tool";
  const base = `mcp_${slug}_${toolPart}`.slice(0, 60);
  // Gemini requires names matching ^[a-zA-Z0-9_-]+$ and starting with a letter/underscore.
  return /^[a-zA-Z_]/.test(base) ? base : `mcp_${base}`.slice(0, 60);
}

type PermissionRow = {
  mcp_tool_id: string;
  enabled: boolean;
  approval_required: boolean;
  risk_level: string;
};

/**
 * Loads the MCP runtime for one agent. Returns an empty runtime (not null)
 * when nothing is attached, so call sites don't branch.
 */
export async function loadAgentMcpTools(userId: string, agentId: string | null): Promise<McpToolRuntime> {
  const empty: McpToolRuntime = {
    tools: new Map(),
    declarations: {},
    approvalRequired: new Set(),
    handles: () => false,
    requiresApproval: () => false,
    execute: async () => {
      throw new Error("Unknown MCP tool.");
    },
  };
  if (!agentId) return empty;

  const admin = supabaseAdmin();

  // 1. Enabled attachments for this agent.
  const { data: attachments, error: attachError } = await admin
    .from("agent_mcp_servers")
    .select("id, user_mcp_connection_id")
    .eq("agent_id", agentId)
    .eq("enabled", true);
  if (attachError || !attachments?.length) return empty;

  // 2. The caller's connections for those attachments (must still be connected).
  const connectionIds = attachments.map((row) => row.user_mcp_connection_id as string);
  const { data: connections, error: connError } = await admin
    .from("user_mcp_connections")
    .select(
      "id, mcp_server_id, status, auth_type, credentials_ciphertext, credentials_iv, credentials_tag, key_version, metadata",
    )
    .eq("user_id", userId)
    .in("id", connectionIds)
    .eq("status", "connected");
  if (connError || !connections?.length) return empty;

  const connectionByServer = new Map<string, ConnectionRow>();
  const connectionIds2: string[] = [];
  for (const row of connections as ConnectionRow[]) {
    connectionByServer.set(row.mcp_server_id, row);
    connectionIds2.push(row.id);
  }

  // 3. Enabled servers for those connections.
  const serverIds = [...connectionByServer.keys()];
  const { data: servers, error: serverError } = await admin
    .from("mcp_servers")
    .select("id, slug, name, provider, endpoint, enabled")
    .in("id", serverIds)
    .eq("enabled", true);
  if (serverError || !servers?.length) return empty;
  const serverById = new Map((servers as ServerRow[]).map((row) => [row.id, row]));

  // 4. Enabled cached tools for those servers.
  const { data: toolRows, error: toolError } = await admin
    .from("mcp_tools")
    .select(
      "id, mcp_server_id, external_tool_id, name, description, input_schema, risk_level, approval_required_default, enabled",
    )
    .in("mcp_server_id", serverIds)
    .eq("enabled", true);
  if (toolError || !toolRows?.length) return empty;

  // 5. Per-agent permission overrides (may be absent → catalog defaults).
  const toolIds = (toolRows as Array<{ id: string }>).map((row) => row.id);
  const { data: permissionRows } = await admin
    .from("agent_mcp_tool_permissions")
    .select("mcp_tool_id, enabled, approval_required, risk_level")
    .eq("agent_id", agentId)
    .in("mcp_tool_id", toolIds);

  const permissions = new Map<string, PermissionRow>();
  for (const row of (permissionRows ?? []) as PermissionRow[]) {
    permissions.set(row.mcp_tool_id, row);
  }

  // Assemble, namespaced, capped, deterministic order.
  const usedNames = new Set<string>();
  const loaded: LoadedMcpTool[] = [];

  for (const row of toolRows as Array<{
    id: string;
    mcp_server_id: string;
    external_tool_id: string;
    name: string;
    description: string;
    input_schema: Record<string, unknown>;
    risk_level: "low" | "medium" | "high";
    approval_required_default: boolean;
  }>) {
    const permission = permissions.get(row.id);
    if (permission && !permission.enabled) continue;

    const server = serverById.get(row.mcp_server_id);
    const connection = connectionByServer.get(row.mcp_server_id);
    if (!server || !connection) continue;

    // risk_level = high can never disable approval (API-enforced, re-checked here).
    const effectiveRisk = permission?.risk_level ?? row.risk_level;
    const riskLevel: "low" | "medium" | "high" =
      effectiveRisk === "high" || row.risk_level === "high"
        ? "high"
        : effectiveRisk === "low"
          ? "low"
          : "medium";
    const approvalRequired =
      riskLevel === "high" ? true : (permission?.approval_required ?? row.approval_required_default);

    let name = namespacedToolName(server.slug, row.external_tool_id);
    if (usedNames.has(name)) name = `${name}_${shortHash(`${server.slug}:${row.external_tool_id}`)}`.slice(0, 60);
    usedNames.add(name);

    loaded.push({
      name,
      connectionId: connection.id,
      serverId: server.id,
      serverSlug: server.slug,
      serverName: server.name,
      provider: server.provider,
      externalToolId: row.external_tool_id,
      description: row.description,
      inputSchema:
        row.input_schema && typeof row.input_schema === "object"
          ? (row.input_schema as Record<string, unknown>)
          : { type: "object", properties: {} },
      riskLevel,
      approvalRequired,
    });
  }

  // Deterministic order, then cap (prefer read-only tools when over the cap
  // so the model keeps its most useful, least dangerous options).
  loaded.sort((a, b) =>
    a.approvalRequired === b.approvalRequired
      ? `${a.serverSlug}:${a.name}`.localeCompare(`${b.serverSlug}:${b.name}`)
      : Number(a.approvalRequired) - Number(b.approvalRequired),
  );
  const exposed = loaded.slice(0, MAX_MCP_TOOLS_PER_RUN);

  const tools = new Map<string, LoadedMcpTool>();
  const declarations: Record<string, Tool> = {};
  const approvalRequired = new Set<string>();

  for (const entry of exposed) {
    tools.set(entry.name, entry);
    if (entry.approvalRequired) approvalRequired.add(entry.name);
    declarations[entry.name] = tool({
      // Provenance prefix tells the model this is an external integration.
      description: `[MCP:${entry.serverName}] ${entry.description}`.slice(0, 1_000),
      inputSchema: jsonSchema(entry.inputSchema),
    }) as Tool;
  }

  const runtime: McpToolRuntime = {
    tools,
    declarations,
    approvalRequired,
    handles: (name) => tools.has(name),
    requiresApproval: (name) => approvalRequired.has(name),
    execute: async (name, args) => {
      const entry = tools.get(name);
      if (!entry) throw new Error(`Unknown MCP tool: ${name}`);
      if (entry.provider === "composio") {
        return executeComposioTool({
          userId,
          connectionId: entry.connectionId,
          externalToolId: entry.externalToolId,
          args,
        });
      }
      return executeDirectTool({
        userId,
        connectionId: entry.connectionId,
        externalToolId: entry.externalToolId,
        args,
      });
    },
  };

  return runtime;
}

/** Resolves the run's agent and loads its MCP runtime (null agent → empty). */
export async function loadMcpToolsForRun(runId: string, userId: string): Promise<McpToolRuntime> {
  const { data: run } = await supabaseAdmin()
    .from("agent_runs")
    .select("agent_id")
    .eq("id", runId)
    .eq("user_id", userId)
    .maybeSingle();

  const agentId = (run?.agent_id as string | null) ?? null;
  if (!agentId) {
    // Legacy/fallback run: use the user's default agent so attachments still apply.
    const fallback = await defaultAgentId(userId);
    return loadAgentMcpTools(userId, fallback);
  }
  return loadAgentMcpTools(userId, agentId);
}

/** First agent of the user, creating a "Personal" agent on demand. */
export async function defaultAgentId(userId: string): Promise<string | null> {
  const admin = supabaseAdmin();
  const { data: existing } = await admin
    .from("agents")
    .select("id")
    .eq("user_id", userId)
    .order("created_at", { ascending: true })
    .limit(1)
    .maybeSingle();
  if (existing?.id) return existing.id as string;

  const { data: created, error } = await admin
    .from("agents")
    .insert({ user_id: userId, name: "Personal" })
    .select("id")
    .single();
  if (error || !created) return null;
  return created.id as string;
}

/** Decrypted credentials for a connection (used by sync/health jobs). */
export function credentialsFor(row: ConnectionRow): ReturnType<typeof readCredentials> {
  return readCredentials(row);
}
