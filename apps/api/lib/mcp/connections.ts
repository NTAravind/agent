import type { MCPAuthType, MCPConnectionStatus } from "@agent/shared";

import { supabaseAdmin } from "@/lib/supabase/server";
import {
  decryptJson,
  encryptJson,
  type ConnectionCredentials,
} from "@/lib/mcp/encryption";

/**
 * Per-user MCP connections (Phase 6 plan §6.4).
 *
 * Credentials are encrypted app-side (AES-256-GCM) before they reach the
 * database and are never returned to the client after saving — routes only
 * expose non-secret metadata. The service-role client bypasses RLS, so every
 * query filters by user_id explicitly.
 */

export type ConnectionRow = {
  id: string;
  user_id: string;
  mcp_server_id: string;
  provider_connection_id: string | null;
  status: MCPConnectionStatus;
  auth_type: MCPAuthType;
  credentials_ciphertext: string | null;
  credentials_iv: string | null;
  credentials_tag: string | null;
  key_version: string | null;
  metadata: Record<string, unknown>;
  last_checked_at: string | null;
  created_at: string;
  updated_at: string;
};

/** Safe-to-return shape: never contains credentials. */
export type PublicConnection = {
  id: string;
  serverId: string;
  status: MCPConnectionStatus;
  authType: MCPAuthType;
  metadata: Record<string, unknown>;
  lastCheckedAt: string | null;
  createdAt: string;
};

export function toPublicConnection(row: ConnectionRow): PublicConnection {
  return {
    id: row.id,
    serverId: row.mcp_server_id,
    status: row.status,
    authType: row.auth_type,
    metadata: row.metadata ?? {},
    lastCheckedAt: row.last_checked_at,
    createdAt: row.created_at,
  };
}

const CREDENTIAL_COLUMNS =
  "id, user_id, mcp_server_id, provider_connection_id, status, auth_type, credentials_ciphertext, credentials_iv, credentials_tag, key_version, metadata, last_checked_at, created_at, updated_at";

export async function listConnections(userId: string): Promise<ConnectionRow[]> {
  const { data, error } = await supabaseAdmin()
    .from("user_mcp_connections")
    .select(CREDENTIAL_COLUMNS)
    .eq("user_id", userId)
    .order("created_at", { ascending: false });
  if (error) throw new Error(`Could not list connections: ${error.message}`);
  return (data ?? []) as ConnectionRow[];
}

export async function getConnection(
  userId: string,
  connectionId: string,
): Promise<ConnectionRow | null> {
  const { data, error } = await supabaseAdmin()
    .from("user_mcp_connections")
    .select(CREDENTIAL_COLUMNS)
    .eq("user_id", userId)
    .eq("id", connectionId)
    .maybeSingle();
  if (error) throw new Error(`Could not load connection: ${error.message}`);
  return (data as ConnectionRow | null) ?? null;
}

export async function getConnectionForServer(
  userId: string,
  serverId: string,
): Promise<ConnectionRow | null> {
  const { data, error } = await supabaseAdmin()
    .from("user_mcp_connections")
    .select(CREDENTIAL_COLUMNS)
    .eq("user_id", userId)
    .eq("mcp_server_id", serverId)
    .maybeSingle();
  if (error) throw new Error(`Could not load connection: ${error.message}`);
  return (data as ConnectionRow | null) ?? null;
}

/**
 * Creates or replaces the user's connection for a server (one per
 * (user, server) per the unique index). Credentials are encrypted here —
 * callers pass plaintext, the database only ever sees ciphertext.
 */
export async function upsertConnection(input: {
  userId: string;
  serverId: string;
  authType: MCPAuthType;
  status?: MCPConnectionStatus;
  credentials?: ConnectionCredentials | null;
  metadata?: Record<string, unknown>;
  providerConnectionId?: string | null;
}): Promise<ConnectionRow> {
  const encrypted = input.credentials ? encryptJson(input.credentials) : null;
  const patch: Record<string, unknown> = {
    user_id: input.userId,
    mcp_server_id: input.serverId,
    auth_type: input.authType,
    status: input.status ?? "pending",
    metadata: input.metadata ?? {},
    provider_connection_id: input.providerConnectionId ?? null,
    credentials_ciphertext: encrypted?.ciphertext ?? null,
    credentials_iv: encrypted?.iv ?? null,
    credentials_tag: encrypted?.tag ?? null,
    key_version: encrypted?.keyVersion ?? null,
    updated_at: new Date().toISOString(),
  };

  const { data, error } = await supabaseAdmin()
    .from("user_mcp_connections")
    .upsert(patch, { onConflict: "user_id,mcp_server_id" })
    .select(CREDENTIAL_COLUMNS)
    .single();
  if (error) throw new Error(`Could not save connection: ${error.message}`);
  return data as ConnectionRow;
}

export async function updateConnection(
  userId: string,
  connectionId: string,
  patch: Partial<{
    status: MCPConnectionStatus;
    metadata: Record<string, unknown>;
    providerConnectionId: string | null;
    credentials: ConnectionCredentials | null;
  }>,
): Promise<ConnectionRow | null> {
  const update: Record<string, unknown> = { updated_at: new Date().toISOString() };
  if (patch.status !== undefined) update.status = patch.status;
  if (patch.metadata !== undefined) update.metadata = patch.metadata;
  if (patch.providerConnectionId !== undefined) {
    update.provider_connection_id = patch.providerConnectionId;
  }
  if (patch.credentials !== undefined) {
    if (patch.credentials === null) {
      update.credentials_ciphertext = null;
      update.credentials_iv = null;
      update.credentials_tag = null;
      update.key_version = null;
    } else {
      const encrypted = encryptJson(patch.credentials);
      update.credentials_ciphertext = encrypted.ciphertext;
      update.credentials_iv = encrypted.iv;
      update.credentials_tag = encrypted.tag;
      update.key_version = encrypted.keyVersion;
    }
  }

  const { data, error } = await supabaseAdmin()
    .from("user_mcp_connections")
    .update(update)
    .eq("user_id", userId)
    .eq("id", connectionId)
    .select(CREDENTIAL_COLUMNS)
    .maybeSingle();
  if (error) throw new Error(`Could not update connection: ${error.message}`);
  return (data as ConnectionRow | null) ?? null;
}

export async function deleteConnection(userId: string, connectionId: string): Promise<boolean> {
  const { error } = await supabaseAdmin()
    .from("user_mcp_connections")
    .delete()
    .eq("user_id", userId)
    .eq("id", connectionId);
  if (error) throw new Error(`Could not delete connection: ${error.message}`);
  return true;
}

/** Decrypts stored credentials. Returns null when absent or undecryptable. */
export function readCredentials(row: ConnectionRow): ConnectionCredentials | null {
  if (!row.credentials_ciphertext || !row.credentials_iv || !row.credentials_tag) {
    return null;
  }
  try {
    return decryptJson<ConnectionCredentials>({
      ciphertext: row.credentials_ciphertext,
      iv: row.credentials_iv,
      tag: row.credentials_tag,
      keyVersion: row.key_version ?? "v1",
    });
  } catch {
    // Tampered or rotated key: treat as no credentials (forces reconnect).
    return null;
  }
}

/** Marks a connection's health after a probe/sync. Never stores credentials. */
export async function markConnectionChecked(
  userId: string,
  connectionId: string,
  status: MCPConnectionStatus,
  metadataPatch?: Record<string, unknown>,
): Promise<void> {
  const { data } = await supabaseAdmin()
    .from("user_mcp_connections")
    .select("metadata")
    .eq("user_id", userId)
    .eq("id", connectionId)
    .maybeSingle();

  const update: Record<string, unknown> = {
    status,
    last_checked_at: new Date().toISOString(),
    updated_at: new Date().toISOString(),
  };
  if (metadataPatch && data) {
    update.metadata = { ...(data.metadata as Record<string, unknown>), ...metadataPatch };
  }
  const { error } = await supabaseAdmin()
    .from("user_mcp_connections")
    .update(update)
    .eq("user_id", userId)
    .eq("id", connectionId);
  if (error) throw new Error(`Could not update connection health: ${error.message}`);
}
