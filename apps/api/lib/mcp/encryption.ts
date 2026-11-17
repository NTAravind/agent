import { createCipheriv, createDecipheriv, randomBytes } from "node:crypto";

import { requiredEnv } from "@/lib/env";

/**
 * App-layer AES-256-GCM encryption for MCP credentials (Phase 6 plan §5.5).
 *
 * The prompt explicitly forbids relying on `pgedk.encrypt()` — credentials are
 * encrypted in the API before they touch the database, so a leaked database
 * dump (or the service role key) never reveals usable tokens.
 *
 * Storage layout (user_mcp_connections):
 *   credentials_ciphertext = base64(ciphertext)
 *   credentials_iv         = base64(12-byte IV)
 *   credentials_tag        = base64(16-byte GCM tag)
 *   key_version            = "v1" (bump when rotating keys)
 *
 * ENCRYPTION_KEY is 32 bytes encoded as 64 hex characters.
 */

const CURRENT_KEY_VERSION = "v1";

export type EncryptedPayload = {
  ciphertext: string;
  iv: string;
  tag: string;
  keyVersion: string;
};

function encryptionKey(): Buffer {
  const raw = requiredEnv("ENCRYPTION_KEY");
  const key = Buffer.from(raw, "hex");
  if (key.length !== 32) {
    throw new Error(
      `ENCRYPTION_KEY must be 32 bytes encoded as hex (64 hex chars); got ${key.length} bytes.`,
    );
  }
  return key;
}

/** Encrypts a JSON-serializable value into base64(iv|tag|ciphertext) parts. */
export function encryptJson(value: unknown): EncryptedPayload {
  const iv = randomBytes(12);
  const cipher = createCipheriv("aes-256-gcm", encryptionKey(), iv);
  const plaintext = Buffer.from(JSON.stringify(value ?? null), "utf8");
  const encrypted = Buffer.concat([cipher.update(plaintext), cipher.final()]);
  return {
    ciphertext: encrypted.toString("base64"),
    iv: iv.toString("base64"),
    tag: cipher.getAuthTag().toString("base64"),
    keyVersion: CURRENT_KEY_VERSION,
  };
}

/** Decrypts a payload produced by {@link encryptJson}. Throws on tampering. */
export function decryptJson<T>(payload: EncryptedPayload): T {
  const key = encryptionKey();
  const decipher = createDecipheriv("aes-256-gcm", key, Buffer.from(payload.iv, "base64"));
  decipher.setAuthTag(Buffer.from(payload.tag, "base64"));
  const decrypted = Buffer.concat([
    decipher.update(Buffer.from(payload.ciphertext, "base64")),
    decipher.final(),
  ]);
  return JSON.parse(decrypted.toString("utf8")) as T;
}

/** Shape of the encrypted credential blob for a connection. */
export type ConnectionCredentials = {
  /** API key / PAT / bearer token. */
  apiKey?: string;
  /** OAuth tokens as returned by the AS (access_token, refresh_token, …). */
  oauth?: {
    access_token: string;
    refresh_token?: string;
    expires_at?: number;
    token_type?: string;
    scope?: string;
    [key: string]: unknown;
  };
  /** Dynamic client registration result (client_id/secret) for OAuth. */
  client?: { client_id: string; client_secret?: string; [key: string]: unknown };
  /** PKCE code verifier + OAuth state, kept short-lived. */
  pkce?: { codeVerifier?: string; state?: string };
  /** Composio-managed session headers (provider_managed auth). */
  composio?: {
    sessionHeaders?: Record<string, string>;
    entityUserId?: string;
  };
};
