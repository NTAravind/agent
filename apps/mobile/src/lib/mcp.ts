import { apiFetch } from '@/lib/api';
import { supabase } from '@/lib/supabase';

/**
 * Remote MCP marketplace client (Phase 6). Thin typed wrapper over the API —
 * credentials are entered here but never stored on the device (the API
 * encrypts them server-side and never returns them).
 */

async function accessToken(): Promise<string | null> {
  const { data, error } = await supabase.auth.getSession();
  if (error || !data.session) return null;
  return data.session.access_token;
}

async function call<T>(path: string, init?: RequestInit): Promise<T> {
  const token = await accessToken();
  if (!token) throw new Error('Not signed in.');
  return apiFetch<T>(path, { token, init });
}

// --- Catalog ---------------------------------------------------------------

export type CatalogEntry = {
  id: string;
  slug: string;
  name: string;
  description: string;
  /** Setup steps shown before connecting (from the admin dashboard). */
  instructions: string;
  provider: string;
  category: string;
  endpoint: string | null;
  transport: string;
  authType: 'none' | 'api_key' | 'oauth2' | 'pat' | 'provider_managed';
  capabilities: Record<string, unknown>;
  iconUrl: string | null;
  isVerified: boolean;
  isFreeTier: boolean;
  connected: boolean;
  connectionId: string | null;
  connectionStatus: string | null;
};

export type ServerDetail = {
  server: Omit<CatalogEntry, 'connected' | 'connectionId' | 'connectionStatus'> & {
    enabled: boolean;
  };
  tools: CachedTool[];
  connection: {
    id: string;
    status: string;
    authType: string;
    lastCheckedAt: string | null;
  } | null;
};

export type CachedTool = {
  id: string;
  externalToolId: string;
  name: string;
  description: string;
  inputSchema: Record<string, unknown>;
  riskLevel: 'low' | 'medium' | 'high';
  approvalRequiredDefault: boolean;
  enabled: boolean;
  schemaHash: string;
  discoveredAt: string;
};

export type CatalogFilter = {
  q?: string;
  category?: string;
  connected?: boolean;
};

export async function fetchServers(filter: CatalogFilter = {}): Promise<CatalogEntry[]> {
  const params = new URLSearchParams();
  if (filter.q) params.set('q', filter.q);
  if (filter.category) params.set('category', filter.category);
  if (filter.connected) params.set('connected', '1');
  const query = params.toString();
  const response = await call<{ servers: CatalogEntry[] }>(`/api/mcp/servers${query ? `?${query}` : ''}`);
  return response.servers;
}

export async function fetchServer(id: string): Promise<ServerDetail> {
  return call<ServerDetail>(`/api/mcp/servers/${id}`);
}

// --- Connections -----------------------------------------------------------

export type Connection = {
  id: string;
  serverId: string;
  status: 'pending' | 'connected' | 'expired' | 'error' | 'disconnected';
  authType: string;
  metadata: Record<string, unknown>;
  lastCheckedAt: string | null;
  createdAt: string;
};

export type ConnectResult = {
  connectionId: string;
  status?: string;
  toolCount?: number;
  /** OAuth only: open this in a browser to finish connecting. */
  authorizationUrl?: string;
};

export async function connectServer(
  serverId: string,
  options: { apiKey?: string } = {},
): Promise<ConnectResult> {
  return call<ConnectResult>('/api/mcp/connections', {
    method: 'POST',
    body: JSON.stringify({ serverId, ...(options.apiKey ? { apiKey: options.apiKey } : {}) }),
  });
}

export async function refreshConnection(id: string): Promise<{ toolCount: number; changed: number }> {
  return call<{ toolCount: number; changed: number }>(`/api/mcp/connections/${id}/refresh`, {
    method: 'POST',
  });
}

export async function disconnectServer(id: string): Promise<void> {
  await call<{ disconnected: boolean }>(`/api/mcp/connections/${id}`, { method: 'DELETE' });
}

// --- Agents & attachments --------------------------------------------------

export type Agent = {
  id: string;
  name: string;
  model: string | null;
  avatarEmoji: string | null;
  createdAt: string;
};

export async function fetchAgents(): Promise<Agent[]> {
  const response = await call<{ agents: Agent[] }>('/api/agents');
  return response.agents;
}

export type AgentAttachment = {
  attachmentId: string;
  enabled: boolean;
  connection: { id: string; status: string; authType: string; lastCheckedAt: string | null } | null;
  server: { id: string; slug: string; name: string; provider: string; category: string; iconUrl: string | null; enabled: boolean } | null;
  tools: {
    id: string;
    name: string;
    externalToolId: string;
    description: string;
    riskLevel: 'low' | 'medium' | 'high';
    approvalRequired: boolean;
    enabled: boolean;
    hasPermissionRow: boolean;
  }[];
};

export async function fetchAgentAttachments(agentId: string): Promise<AgentAttachment[]> {
  const response = await call<{ attachments: AgentAttachment[] }>(`/api/mcp/agents/${agentId}/servers`);
  return response.attachments;
}

export async function attachServer(agentId: string, connectionId: string): Promise<void> {
  await call(`/api/mcp/agents/${agentId}/servers`, {
    method: 'POST',
    body: JSON.stringify({ connectionId }),
  });
}

export async function detachServer(agentId: string, connectionId: string): Promise<void> {
  await call(`/api/mcp/agents/${agentId}/servers/${connectionId}`, { method: 'DELETE' });
}

export type ToolPermission = {
  mcpToolId: string;
  serverId: string;
  serverName: string;
  name: string;
  externalToolId: string;
  description: string;
  riskLevel: 'low' | 'medium' | 'high';
  enabled: boolean;
  approvalRequired: boolean;
  hasPermissionRow: boolean;
};

export async function fetchAgentToolPermissions(agentId: string): Promise<ToolPermission[]> {
  const response = await call<{ permissions: ToolPermission[] }>(`/api/mcp/agents/${agentId}/tools`);
  return response.permissions;
}

export async function updateToolPermissions(
  agentId: string,
  permissions: { mcpToolId: string; enabled: boolean; approvalRequired: boolean }[],
): Promise<void> {
  await call(`/api/mcp/agents/${agentId}/tools`, {
    method: 'PUT',
    body: JSON.stringify({ permissions }),
  });
}
