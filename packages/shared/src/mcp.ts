import { z } from "zod";

/**
 * Remote MCP Marketplace types (Phase 6).
 * Shared between the API and the Expo client so both agree on shapes.
 * The phone never imports provider SDKs.
 */

export const MCPProviderSchema = z.enum(["composio", "zapier", "apify", "direct"]);
export type MCPProvider = z.infer<typeof MCPProviderSchema>;

export const MCPTransportSchema = z.enum(["streamable_http", "http", "stdio"]);
export type MCPTransport = z.infer<typeof MCPTransportSchema>;

export const MCPAuthTypeSchema = z.enum(["none", "api_key", "oauth2", "pat", "provider_managed"]);
export type MCPAuthType = z.infer<typeof MCPAuthTypeSchema>;

export const MCPConnectionStatusSchema = z.enum([
  "pending",
  "connected",
  "expired",
  "error",
  "disconnected",
]);
export type MCPConnectionStatus = z.infer<typeof MCPConnectionStatusSchema>;

export const MCPRiskLevelSchema = z.enum(["low", "medium", "high"]);
export type MCPRiskLevel = z.infer<typeof MCPRiskLevelSchema>;

export const MCPToolPermissionSchema = z.enum(["enabled", "disabled", "approval_required"]);
export type MCPToolPermission = z.infer<typeof MCPToolPermissionSchema>;

export const MCPCapabilitiesSchema = z.object({
  tools: z.boolean().optional(),
  resources: z.boolean().optional(),
  prompts: z.boolean().optional(),
});
export type MCPCapabilities = z.infer<typeof MCPCapabilitiesSchema>;

export const MCPConfigSchema = z.object({
  type: z.enum(["composio", "direct"]),
  /** For direct-remote: the MCP endpoint. For composio: provider config. */
  endpoint: z.string().optional(),
  transport: MCPTransportSchema.optional(),
  /** Composio: user id / api key. */
  providerConfig: z.record(z.string(), z.unknown()).optional(),
  /** Provider-specific metadata (e.g., repository URL). */
  metadata: z.record(z.string(), z.unknown()).optional(),
});
export type MCPConfig = z.infer<typeof MCPConfigSchema>;

export const MCPServerSchema = z.object({
  id: z.string().uuid(),
  slug: z.string(),
  name: z.string(),
  description: z.string(),
  provider: MCPProviderSchema,
  category: z.string(),
  endpoint: z.string().nullable(),
  transport: MCPTransportSchema,
  auth_type: MCPAuthTypeSchema,
  capabilities: MCPCapabilitiesSchema,
  config: MCPConfigSchema,
  is_verified: z.boolean(),
  is_free_tier: z.boolean(),
  enabled: z.boolean(),
  created_by: z.string().uuid().nullable(),
  created_at: z.string(),
  updated_at: z.string(),
});
export type MCPServer = z.infer<typeof MCPServerSchema>;

export const MCPConnectionSchema = z.object({
  id: z.string().uuid(),
  user_id: z.string().uuid(),
  mcp_server_id: z.string().uuid(),
  provider_connection_id: z.string().nullable(),
  status: MCPConnectionStatusSchema,
  auth_type: MCPAuthTypeSchema,
  metadata: z.record(z.string(), z.unknown()),
  last_checked_at: z.string().nullable(),
  created_at: z.string(),
  updated_at: z.string(),
});
export type MCPConnection = z.infer<typeof MCPConnectionSchema>;

export const MCPToolSchema = z.object({
  id: z.string().uuid(),
  mcp_server_id: z.string().uuid(),
  external_tool_id: z.string(),
  name: z.string(),
  description: z.string(),
  input_schema: z.record(z.string(), z.unknown()),
  risk_level: MCPRiskLevelSchema,
  approval_required_default: z.boolean(),
  enabled: z.boolean(),
  schema_hash: z.string(),
  discovered_at: z.string(),
});
export type MCPTool = z.infer<typeof MCPToolSchema>;

export const AgentMCPServerSchema = z.object({
  id: z.string().uuid(),
  agent_id: z.string().uuid(),
  user_mcp_connection_id: z.string().uuid(),
  enabled: z.boolean(),
  created_at: z.string(),
  updated_at: z.string(),
});
export type AgentMCPServer = z.infer<typeof AgentMCPServerSchema>;

export const AgentMCPToolPermissionSchema = z.object({
  id: z.string().uuid(),
  agent_id: z.string().uuid(),
  mcp_tool_id: z.string().uuid(),
  enabled: z.boolean(),
  approval_required: z.boolean(),
  risk_level: MCPRiskLevelSchema,
  created_at: z.string(),
  updated_at: z.string(),
});
export type AgentMCPToolPermission = z.infer<typeof AgentMCPToolPermissionSchema>;

/** Tool definition discovered from an MCP server (untrusted). */
export const MCPToolDefinitionSchema = z.object({
  name: z.string(),
  description: z.string().optional(),
  inputSchema: z.unknown().optional(),
  riskLevel: MCPRiskLevelSchema.optional(),
});
export type MCPToolDefinition = z.infer<typeof MCPToolDefinitionSchema>;

/** Provider adapter interface. */
export interface MCPProviderAdapter {
  connect(input: {
    userId: string;
    serverId: string;
    credentials?: Record<string, unknown>;
  }): Promise<{ connectionId: string; authorizationUrl?: string }>;
  discoverTools(connectionId: string): Promise<MCPToolDefinition[]>;
  loadTools(input: {
    connectionId: string;
    enabledToolIds: string[];
  }): Promise<Record<string, unknown>>;
  executeTool(input: {
    connectionId: string;
    toolName: string;
    arguments: unknown;
  }): Promise<unknown>;
  disconnect(connectionId: string): Promise<void>;
}

export const MCPConnectionRequestSchema = z.object({
  serverId: z.string().uuid(),
  credentials: z.record(z.string(), z.unknown()).optional(),
});
export type MCPConnectionRequest = z.infer<typeof MCPConnectionRequestSchema>;

export const MCPConnectResponseSchema = z.object({
  connectionId: z.string(),
  authorizationUrl: z.string().optional(),
});
export type MCPConnectResponse = z.infer<typeof MCPConnectResponseSchema>;
