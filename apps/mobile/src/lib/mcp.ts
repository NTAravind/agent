import * as Linking from 'expo-linking';
import * as WebBrowser from 'expo-web-browser';

import { authedFetch } from '@/lib/api-session';

/**
 * Remote MCP marketplace client (Phase 6). Thin typed wrapper over the API —
 * credentials are entered here but never stored on the device (the API
 * encrypts them server-side and never returns them).
 */

async function call<T>(path: string, init?: RequestInit): Promise<T> {
  return authedFetch<T>(path, init);
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
  /** `direct` = the built-in, vendor-hosted listings. */
  provider?: string;
};

export async function fetchServers(filter: CatalogFilter = {}): Promise<CatalogEntry[]> {
  const params = new URLSearchParams();
  if (filter.q) params.set('q', filter.q);
  if (filter.category) params.set('category', filter.category);
  if (filter.connected) params.set('connected', '1');
  if (filter.provider) params.set('provider', filter.provider);
  const query = params.toString();
  const response = await call<{ servers: CatalogEntry[] }>(`/api/mcp/servers${query ? `?${query}` : ''}`);
  return response.servers;
}

export async function fetchServer(id: string): Promise<ServerDetail> {
  return call<ServerDetail>(`/api/mcp/servers/${id}`);
}

// --- Composio catalog (Composio-as-source tab) ----------------------------

export type ComposioCatalogItem = {
  /** Composio toolkit slug (`gmail`) — the connect key. */
  toolkit: string;
  name: string;
  description: string;
  logo: string | null;
  category: string | null;
  toolCount: number;
  authSchemes: string[];
  /** Set once a marketplace listing has been materialized by a connect. */
  serverId: string | null;
  connected: boolean;
  connectionId: string | null;
  connectionStatus: string | null;
};

export type ComposioCatalogResponse = {
  configured: boolean;
  items: ComposioCatalogItem[];
  total: number;
  categories: string[];
};

export async function fetchComposioCatalog(filter: { q?: string; category?: string } = {}): Promise<ComposioCatalogResponse> {
  const params = new URLSearchParams();
  if (filter.q) params.set('q', filter.q);
  if (filter.category) params.set('category', filter.category);
  const query = params.toString();
  return call<ComposioCatalogResponse>(`/api/mcp/composio/catalog${query ? `?${query}` : ''}`);
}

/** Connects a Composio toolkit (materializes its listing server-side). */
export async function connectComposioToolkit(toolkit: string): Promise<ConnectResult> {
  return call<ConnectResult>('/api/mcp/connections', {
    method: 'POST',
    body: JSON.stringify({ toolkit }),
  });
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
  /** The listing this connection belongs to (navigate to its detail page). */
  serverId?: string;
  /** `pending` when the user must authorize first (see authorizationUrl). */
  status?: string;
  toolCount?: number;
  /** OAuth / Composio hosted auth: open this in a browser to finish connecting. */
  authorizationUrl?: string;
};

/** Opens a provider sign-in session and resumes the app at its integration. */
export async function openMarketplaceAuthorization(
  authorizationUrl: string,
  serverId: string,
): Promise<WebBrowser.WebBrowserAuthSessionResult> {
  const redirectUrl = Linking.createURL(`/mcp/${encodeURIComponent(serverId)}`);
  return WebBrowser.openAuthSessionAsync(authorizationUrl, redirectUrl);
}

/** Re-checked status from POST /api/mcp/connections/:id/verify. */
export type VerifyResult = {
  status: 'pending' | 'connected' | 'expired' | 'error' | 'disconnected';
  toolCount?: number;
  /** Returned when consent is (still) needed and issueLink wasn't disabled. */
  authorizationUrl?: string;
  message?: string;
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

/**
 * Asks the API to re-check a connection with its provider. While waiting on
 * Composio consent this is polled with `{ issueLink: false }` (side-effect
 * free); the "Finish connecting" / "Reconnect" buttons pass the default so
 * the response carries a fresh `authorizationUrl` to reopen.
 */
export async function verifyConnection(
  id: string,
  options: { issueLink?: boolean } = {},
): Promise<VerifyResult> {
  return call<VerifyResult>(`/api/mcp/connections/${id}/verify`, {
    method: 'POST',
    body: JSON.stringify({ issueLink: options.issueLink ?? true }),
  });
}

export async function refreshConnection(id: string): Promise<{
  toolCount: number;
  changed: number;
  status?: string;
  /** Composio only: consent expired/revoked → reopen this to sign in again. */
  authorizationUrl?: string;
  message?: string;
}> {
  return call(`/api/mcp/connections/${id}/refresh`, {
    method: 'POST',
  });
}

export async function disconnectServer(id: string): Promise<void> {
  await call<{ disconnected: boolean }>(`/api/mcp/connections/${id}`, { method: 'DELETE' });
}

// --- Attachments -----------------------------------------------------------

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

export async function toggleAgentServerAttachment(
  agentId: string,
  connectionId: string,
  enabled: boolean,
): Promise<{ enabled: boolean }> {
  return call<{ enabled: boolean }>(`/api/mcp/agents/${agentId}/servers/${connectionId}`, {
    method: 'PUT',
    body: JSON.stringify({ enabled }),
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
