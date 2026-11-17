import { randomBytes } from "node:crypto";

import { auth, type OAuthClientInformation, type OAuthClientProvider, type OAuthTokens } from "@ai-sdk/mcp";

import { optionalEnv } from "@/lib/env";
import {
  getConnection,
  readCredentials,
  updateConnection,
  type ConnectionRow,
} from "@/lib/mcp/connections";
import { redactSecrets } from "@/lib/mcp/security/redact-secrets";

/**
 * MCP OAuth (Phase 6 plan §6.4 / §6.10).
 *
 * We use `@ai-sdk/mcp`'s `auth()` helper (DCR + PKCE + state + AS discovery)
 * with a custom OAuthClientProvider backed by the encrypted credential blob of
 * a `user_mcp_connections` row. Secrets (tokens, client secret, PKCE verifier)
 * live only in the encrypted blob; non-secret flow state (AS endpoints, OAuth
 * state, expiry) lives in `metadata`.
 *
 * Server-side flow: `startAuthorization()` returns the captured authorization
 * URL to the app, which opens it in a browser. The AS redirects to our public
 * callback, which runs `completeAuthorization()` (code exchange happens here —
 * the code never reaches the phone) and deep-links back into the app.
 */

/** Absolute URL of the OAuth callback (must match the DCR-registered URI). */
export function oauthRedirectUrl(): string {
  const explicit = optionalEnv("MCP_OAUTH_REDIRECT_URL");
  if (explicit) return explicit.replace(/\/$/, "");
  const productionHost = optionalEnv("VERCEL_PROJECT_PRODUCTION_URL") ?? optionalEnv("VERCEL_URL");
  if (productionHost) return `https://${productionHost}/api/mcp/oauth/callback`;
  return "http://localhost:3000/api/mcp/oauth/callback";
}

type OAuthAsInfo = {
  issuer?: string;
  authorizationServerUrl: string;
  tokenEndpoint: string;
};

/** Captured during `auth()` — the URL the app must open in a browser. */
let pendingAuthorizationUrl: string | null = null;

/**
 * An OAuthClientProvider bound to one connection row. Every read/write goes
 * through the encrypted credential blob or non-secret metadata.
 */
export function createConnectionOAuthProvider(connectionId: string, userId: string): OAuthClientProvider & {
  /** The authorization URL captured by `redirectToAuthorization`, if any. */
  capturedAuthorizationUrl(): string | null;
} {
  async function load(): Promise<ConnectionRow> {
    const row = await getConnection(userId, connectionId);
    if (!row) throw new Error("Connection no longer exists.");
    return row;
  }

  async function patchCredentials(
    mutate: (credentials: NonNullable<ReturnType<typeof readCredentials>>) => void,
  ): Promise<void> {
    const row = await load();
    const credentials = readCredentials(row) ?? {};
    mutate(credentials);
    await updateConnection(userId, connectionId, { credentials });
  }

  async function patchMetadata(patch: Record<string, unknown>): Promise<void> {
    const row = await load();
    await updateConnection(userId, connectionId, {
      metadata: { ...(row.metadata ?? {}), ...patch },
    });
  }

  const provider: OAuthClientProvider & { capturedAuthorizationUrl(): string | null } = {
    tokens: async (): Promise<OAuthTokens | undefined> => {
      const row = await load();
      const oauth = readCredentials(row)?.oauth;
      if (!oauth?.access_token) return undefined;
      // Strip our own bookkeeping field before handing tokens to the SDK.
      const { expires_at: _ignored, ...tokens } = oauth;
      return tokens as OAuthTokens;
    },

    saveTokens: async (tokens: OAuthTokens): Promise<void> => {
      const expiresAt =
        typeof tokens.expires_in === "number"
          ? Date.now() + tokens.expires_in * 1000
          : undefined;
      await patchCredentials((credentials) => {
        credentials.oauth = { ...tokens, ...(expiresAt ? { expires_at: expiresAt } : {}) };
      });
      await patchMetadata({
        oauth_expires_at: expiresAt ? new Date(expiresAt).toISOString() : null,
        oauth_scope: tokens.scope ?? null,
      });
    },

    redirectToAuthorization: (authorizationUrl: URL): void => {
      pendingAuthorizationUrl = authorizationUrl.toString();
    },

    saveCodeVerifier: async (codeVerifier: string): Promise<void> => {
      await patchCredentials((credentials) => {
        credentials.pkce = { ...(credentials.pkce ?? {}), codeVerifier };
      });
    },

    codeVerifier: async (): Promise<string> => {
      const row = await load();
      const verifier = readCredentials(row)?.pkce?.codeVerifier;
      if (!verifier) throw new Error("Missing PKCE code verifier — please reconnect.");
      return verifier;
    },

    get redirectUrl(): string {
      return oauthRedirectUrl();
    },

    get clientMetadata() {
      return {
        client_name: "Agent",
        redirect_uris: [oauthRedirectUrl()],
        grant_types: ["authorization_code", "refresh_token"],
        response_types: ["code"],
        // Public client + PKCE (the MCP authorization spec's recommended flow).
        token_endpoint_auth_method: "none",
      };
    },

    clientInformation: async (): Promise<OAuthClientInformation | undefined> => {
      const row = await load();
      return readCredentials(row)?.client as OAuthClientInformation | undefined;
    },

    isClientInformationDynamicallyRegistered: (): boolean => true,

    saveClientInformation: async (clientInformation: OAuthClientInformation): Promise<void> => {
      await patchCredentials((credentials) => {
        credentials.client = clientInformation;
      });
    },

    authorizationServerInformation: async (): Promise<OAuthAsInfo | undefined> => {
      const row = await load();
      const stored = row.metadata?.oauth_as as OAuthAsInfo | undefined;
      return stored?.authorizationServerUrl ? stored : undefined;
    },

    saveAuthorizationServerInformation: async (info: OAuthAsInfo): Promise<void> => {
      await patchMetadata({ oauth_as: info });
    },

    // --- CSRF state: generated as `<connectionId>.<nonce>` so the callback can
    // locate the connection from the state parameter alone (the callback is a
    // public browser redirect with no session).
    state: (): string => `${connectionId}.${randomBytes(16).toString("hex")}`,

    saveState: async (state: string): Promise<void> => {
      await patchMetadata({ oauth_state: state });
    },

    storedState: async (): Promise<string | undefined> => {
      const row = await load();
      const state = row.metadata?.oauth_state;
      return typeof state === "string" ? state : undefined;
    },

    invalidateCredentials: async (
      scope: "all" | "client" | "tokens" | "verifier",
      context?: { tokens: OAuthTokens },
    ): Promise<void> => {
      const row = await load();
      const credentials = readCredentials(row) ?? {};
      if (scope === "all") {
        await updateConnection(userId, connectionId, {
          credentials: {},
          metadata: { ...(row.metadata ?? {}), oauth_state: null, oauth_as: null, oauth_expires_at: null },
        });
        return;
      }
      if (scope === "tokens") {
        // Only clear when the stored token still matches (a concurrent refresh
        // must not be clobbered).
        if (context?.tokens?.access_token && credentials.oauth?.access_token !== context.tokens.access_token) {
          return;
        }
        credentials.oauth = undefined;
      } else if (scope === "client") {
        credentials.client = undefined;
      } else if (scope === "verifier") {
        credentials.pkce = undefined;
      }
      await updateConnection(userId, connectionId, { credentials });
    },

    capturedAuthorizationUrl: () => pendingAuthorizationUrl,
  };

  return provider;
}

export type AuthorizationStart = {
  status: "redirect" | "authorized";
  authorizationUrl?: string;
};

/**
 * Starts (or resumes) the OAuth dance for a connection. Returns the URL the
 * app must open, or `authorized` when stored tokens were still valid/refreshed.
 */
export async function startAuthorization(input: {
  connectionId: string;
  userId: string;
  serverUrl: string;
}): Promise<AuthorizationStart> {
  pendingAuthorizationUrl = null;
  const provider = createConnectionOAuthProvider(input.connectionId, input.userId);
  try {
    const result = await auth(provider, { serverUrl: input.serverUrl });
    if (result === "AUTHORIZED") return { status: "authorized" };
    const url = provider.capturedAuthorizationUrl();
    if (!url) throw new Error("Authorization server did not provide a redirect URL.");
    return { status: "redirect", authorizationUrl: url };
  } catch (error) {
    throw new Error(redactSecrets(error instanceof Error ? error.message : String(error)));
  }
}

/**
 * Completes the flow on the public callback: validates state, exchanges the
 * code (server-side), and persists encrypted tokens. Returns the connection's
 * server URL so the caller can discover tools.
 */
export async function completeAuthorization(input: {
  connectionId: string;
  userId: string;
  serverUrl: string;
  code: string;
  state: string;
  issuer?: string;
}): Promise<void> {
  const provider = createConnectionOAuthProvider(input.connectionId, input.userId);
  try {
    const result = await auth(provider, {
      serverUrl: input.serverUrl,
      authorizationCode: input.code,
      callbackState: input.state,
      ...(input.issuer ? { callbackIssuer: input.issuer } : {}),
    });
    if (result !== "AUTHORIZED") {
      throw new Error("Authorization was not completed.");
    }
  } catch (error) {
    throw new Error(redactSecrets(error instanceof Error ? error.message : String(error)));
  }
}

/** Locates the connection a callback state belongs to (parsed from state). */
export function connectionIdFromState(state: string): string | null {
  const candidate = state.split(".")[0];
  return /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(candidate)
    ? candidate
    : null;
}

export type FreshTokens = { accessToken: string; expired: boolean };

/**
 * Returns a usable access token for a connection, refreshing via `auth()` when
 * the stored token expires within `skewMs`. Throws when the user must reconnect.
 */
export async function getFreshAccessToken(input: {
  connectionId: string;
  userId: string;
  serverUrl: string;
  skewMs?: number;
}): Promise<string> {
  const row = await getConnection(input.userId, input.connectionId);
  if (!row) throw new Error("Connection no longer exists.");
  const credentials = readCredentials(row);
  const tokens = credentials?.oauth;
  if (!tokens?.access_token) {
    throw new Error("This integration is not authorized — reconnect it in Integrations.");
  }

  const skew = input.skewMs ?? 60_000;
  const expiresAt = typeof tokens.expires_at === "number" ? tokens.expires_at : 0;
  const expired = expiresAt > 0 && expiresAt - Date.now() <= skew;

  if (expired) {
    if (!tokens.refresh_token) {
      throw new Error("This integration's access expired — reconnect it in Integrations.");
    }
    const provider = createConnectionOAuthProvider(input.connectionId, input.userId);
    const result = await auth(provider, { serverUrl: input.serverUrl }).catch((error: unknown) => {
      throw new Error(redactSecrets(error instanceof Error ? error.message : String(error)));
    });
    if (result !== "AUTHORIZED") {
      throw new Error("This integration needs reconnecting (refresh failed).");
    }
    const refreshed = await getConnection(input.userId, input.connectionId);
    const next = readCredentials(refreshed!)?.oauth;
    if (!next?.access_token) {
      throw new Error("This integration needs reconnecting.");
    }
    return next.access_token;
  }

  return tokens.access_token;
}
