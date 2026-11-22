import { randomBytes, timingSafeEqual } from "node:crypto";

import type { MCPConnectionStatus } from "@agent/shared";

import { isConfigured, optionalEnv } from "@/lib/env";
import {
  getConnection,
  getConnectionForServer,
  readCredentials,
  updateConnection,
  upsertConnection,
  type ConnectionRow,
} from "@/lib/mcp/connections";
import { listRemoteTools, syncServerTools } from "@/lib/mcp/discovery";
import { redactSecrets } from "@/lib/mcp/security/redact-secrets";
import { validateEndpoint } from "@/lib/mcp/security/validate-endpoint";
import { getServer, type ServerRow } from "@/lib/mcp/registry";

/**
 * Composio provider adapter (Phase 6 plan §6.2, "primary provider").
 *
 * Composio owns the OAuth flow; we get a per-user MCP session endpoint back
 * from their session API and treat it as a direct remote endpoint for
 * discovery/execution. Requires `COMPOSIO_API_KEY` (server-only env).
 *
 * A session is NOT authorization (fix 2026-11-19): creating one only proves
 * the user id exists in Composio — no consent has been given. The connection
 * reads `connected` only when Composio reports an ACTIVE connected account
 * for EVERY toolkit the listing enables; until then it is `pending` (or
 * `expired`/`error`) and the app opens a hosted auth link. Verified live
 * against v3.1 on 2026-11-19:
 *
 * - POST /api/v3.1/tool_router/session — creates the MCP session:
 *   body `{ user_id, toolkits: { enable: [slug…] } }` → 201 flat response
 *   `{ session_id, mcp: { type: "http", url } }`. `user_id` is ALWAYS the
 *   caller's own app user id — one Composio entity per user, never a
 *   shared/env-provided id.
 * - GET  /api/v3.1/connected_accounts?user_ids=<user>&toolkit_slugs=a,b…
 *   → `{ items: [{ id, status, toolkit: { slug } }] }`, newest first, with
 *   statuses INITIALIZING → INITIATED → ACTIVE | EXPIRED | FAILED | REVOKED
 *   | INACTIVE (an unopened link expires after ~10 minutes).
 * - POST /api/v3.1/tool_router/session/{id}/link  body `{ toolkit, callback_url }`
 *   → 201 `{ link_token, redirect_url, connected_account_id }`; 404 when the
 *   toolkit has no auth config yet (created once, then retried).
 * - The MCP endpoint is authenticated with the same Platform key, sent as
 *   `x-api-key`; injected from env at request time — never stored.
 * - `tools/list` returns Composio's meta-tools (COMPOSIO_SEARCH_TOOLS,
 *   COMPOSIO_MULTI_EXECUTE_TOOL, …), but tools are never synced/cached for
 *   an account that is not ACTIVE yet.
 *
 * Flow: connect → { status: pending, authorizationUrl } → user signs in on
 * the hosted link → GET callback / POST verify re-checks the account →
 * `connected` + tool sync. Free plan (Hobby): 100,000 tool calls/month,
 * 2,000 req/min. Without COMPOSIO_API_KEY every call fails fast.
 */

const COMPOSIO_SESSION_URL = "https://backend.composio.dev/api/v3.1/tool_router/session";
const COMPOSIO_ACCOUNTS_URL = "https://backend.composio.dev/api/v3.1/connected_accounts";
const COMPOSIO_AUTH_CONFIGS_URL = "https://backend.composio.dev/api/v3.1/auth_configs";
const SESSION_TIMEOUT_MS = 20_000;

/** Metadata key holding the per-user Composio MCP endpoint + auth state. */
const SESSION_METADATA_KEY = "composio_session";

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
  const slugs = configuredToolkits(config);
  return slugs.length > 0 ? { enable: slugs } : undefined;
}

/** Listing config `toolkits` → the flat slug list the account check needs. */
function configuredToolkits(config: ServerRow["config"]): string[] {
  const raw = config?.toolkits;
  if (Array.isArray(raw)) {
    return raw.filter((slug): slug is string => typeof slug === "string");
  }
  if (raw && typeof raw === "object") {
    // Older rows stored the request shape ({ enable: [...] }); accept both.
    const enable = (raw as { enable?: unknown }).enable;
    if (Array.isArray(enable)) {
      return enable.filter((slug): slug is string => typeof slug === "string");
    }
  }
  return [];
}

/** `no_auth` toolkits need no consent — never gate them on an account. */
function isNoAuthListing(config: ServerRow["config"]): boolean {
  return config?.noAuth === true;
}

const nowIso = (): string => new Date().toISOString();

// --- Connection metadata ----------------------------------------------------

/** One hosted auth link we minted (reused by "Finish connecting"). */
type ComposioLink = {
  linkToken?: string;
  redirectUrl: string;
  connectedAccountId?: string;
  createdAt: string;
};

type ComposioSessionMeta = {
  endpoint?: string;
  sessionId?: string | null;
  createdAt?: string;
  toolCount?: number;
  verifiedAt?: string;
  lastError?: string | null;
  /** Toolkit → the hosted link last minted for it. */
  links?: Record<string, ComposioLink>;
  /** States minted for GET /api/mcp/composio/callback (the trust anchor). */
  callbackStates?: string[];
};

function sessionMeta(row: ConnectionRow): ComposioSessionMeta {
  const raw = row.metadata?.[SESSION_METADATA_KEY];
  return raw && typeof raw === "object" ? (raw as ComposioSessionMeta) : {};
}

/** Toolkit → the connected-account id our stored link created (if any). */
function linkedAccountIds(meta: ComposioSessionMeta): Record<string, string | undefined> {
  const out: Record<string, string | undefined> = {};
  for (const [toolkit, link] of Object.entries(meta.links ?? {})) {
    if (link?.connectedAccountId) out[toolkit] = link.connectedAccountId;
  }
  return out;
}

// --- Callback state (public callback's trust anchor) ------------------------

/** Fresh state for the hosted-auth callback; bound to one connection row. */
export function newComposioCallbackState(): string {
  return randomBytes(16).toString("hex");
}

/** True when `state` was minted for this connection (timing-safe compare). */
export function isComposioCallbackState(state: string, valid: readonly string[]): boolean {
  if (!state) return false;
  const candidate = Buffer.from(state);
  return valid.some((raw) => {
    const expected = Buffer.from(raw);
    return expected.length === candidate.length && timingSafeEqual(expected, candidate);
  });
}

/**
 * Absolute URL of GET /api/mcp/composio/callback with the connection id +
 * signed state baked in (Composio appends its own params after ours).
 * `MCP_COMPOSIO_CALLBACK_URL` overrides the derived host.
 */
function composioCallbackUrl(connectionId: string, state: string): string {
  const explicit = optionalEnv("MCP_COMPOSIO_CALLBACK_URL")?.trim();
  const host = optionalEnv("VERCEL_PROJECT_PRODUCTION_URL") ?? optionalEnv("VERCEL_URL");
  const base = explicit
    ? explicit.replace(/\/$/, "")
    : host
      ? `https://${host}/api/mcp/composio/callback`
      : "http://localhost:3000/api/mcp/composio/callback";
  const url = new URL(base);
  url.searchParams.set("connectionId", connectionId);
  url.searchParams.set("state", state);
  return url.toString();
}

// --- Connected-account state (pure decisions) -------------------------------

export type ComposioAccountStatus =
  | "INITIALIZING"
  | "INITIATED"
  | "ACTIVE"
  | "EXPIRED"
  | "FAILED"
  | "REVOKED"
  | "INACTIVE"
  | "UNKNOWN";

const ACCOUNT_STATUSES = new Set<string>([
  "INITIALIZING",
  "INITIATED",
  "ACTIVE",
  "EXPIRED",
  "FAILED",
  "REVOKED",
  "INACTIVE",
  "UNKNOWN",
]);

/** Unknown/absent values read as `UNKNOWN` → never satisfied → never connected. */
export function normalizeComposioAccountStatus(raw: unknown): ComposioAccountStatus {
  const value = typeof raw === "string" ? raw.toUpperCase() : "";
  return ACCOUNT_STATUSES.has(value) ? (value as ComposioAccountStatus) : "UNKNOWN";
}

type ComposioAccountItem = {
  id?: string;
  status?: string;
  toolkit?: { slug?: string } | null;
};

/**
 * Picks the account row that represents `toolkit` for this entity: a live
 * ACTIVE account always wins (an abandoned attempt can't hide a working
 * one), then the account our stored link minted (our latest attempt), then
 * the most recent row — the API returns `updated_at` desc when we ask.
 */
export function pickComposioAccountStatus(
  items: readonly ComposioAccountItem[],
  toolkit: string,
  linkedAccountId?: string,
): ComposioAccountStatus | undefined {
  const rows = items.filter((item) => item.toolkit?.slug === toolkit);
  if (rows.length === 0) return undefined;
  if (rows.some((row) => normalizeComposioAccountStatus(row.status) === "ACTIVE")) {
    return "ACTIVE";
  }
  if (linkedAccountId) {
    const linked = rows.find((row) => row.id === linkedAccountId);
    if (linked) return normalizeComposioAccountStatus(linked.status);
  }
  return normalizeComposioAccountStatus(rows[0]?.status);
}

export type ComposioPlan = {
  status: "connected" | "pending" | "expired" | "error";
  /** Toolkit that still needs consent — the link we may mint for it. */
  linkToolkit: string | null;
  reason:
    | "all_toolkits_active"
    | "awaiting_consent"
    | "consent_expired"
    | "account_not_usable"
    | "no_toolkits_configured";
};

/**
 * Pure decision shared by connect/verify/refresh: `connected` only when
 * EVERY configured toolkit has an ACTIVE account (or the listing is
 * `no_auth`) — a session on its own proves nothing. Absent/unknown states
 * stay `pending`, so a toolkit the user never authorized can never read as
 * connected for anyone (state comes from accounts, keyed by user id).
 */
export function planComposioConnect(input: {
  toolkits: readonly string[];
  accounts: Readonly<Record<string, ComposioAccountStatus | undefined>>;
  noAuth?: boolean;
}): ComposioPlan {
  const { toolkits, accounts } = input;
  if (toolkits.length === 0) {
    // Nothing to authorize against; never claim connected without evidence.
    return { status: "pending", linkToolkit: null, reason: "no_toolkits_configured" };
  }
  const satisfied = (toolkit: string) =>
    input.noAuth === true || accounts[toolkit] === "ACTIVE";
  const missing = toolkits.find((toolkit) => !satisfied(toolkit));
  if (missing === undefined) {
    return { status: "connected", linkToolkit: null, reason: "all_toolkits_active" };
  }
  const statuses = toolkits.map((toolkit) => accounts[toolkit]);
  if (statuses.some((status) => status === "FAILED" || status === "REVOKED" || status === "INACTIVE")) {
    return { status: "error", linkToolkit: missing, reason: "account_not_usable" };
  }
  if (statuses.some((status) => status === "EXPIRED")) {
    return { status: "expired", linkToolkit: missing, reason: "consent_expired" };
  }
  return { status: "pending", linkToolkit: missing, reason: "awaiting_consent" };
}

/** Reads this entity's connected accounts for the listed toolkits (live). */
async function fetchComposioAccounts(input: {
  entity: string;
  toolkits: readonly string[];
  linked?: Readonly<Record<string, string | undefined>>;
}): Promise<Record<string, ComposioAccountStatus | undefined>> {
  if (input.toolkits.length === 0) return {};
  const url = new URL(COMPOSIO_ACCOUNTS_URL);
  url.searchParams.set("user_ids", input.entity);
  url.searchParams.set("toolkit_slugs", input.toolkits.join(","));
  url.searchParams.set("limit", "100");
  url.searchParams.set("order_by", "updated_at");
  url.searchParams.set("order_direction", "desc");

  const response = await fetch(url, {
    headers: { "x-api-key": requireComposioKey() },
    cache: "no-store",
    signal: AbortSignal.timeout(SESSION_TIMEOUT_MS),
  });
  if (!response.ok) {
    // Surface Composio's own error body (redacted) — a bare status code is
    // undiagnosable in the app ("internal error: returned 401").
    const detail = await response.text().catch(() => "");
    const summary = redactSecrets(detail.slice(0, 400)).trim() || "no details";
    const status = response.status;
    throw Object.assign(
      new Error(`Composio connected-account check failed (${status}): ${summary}`),
      status >= 400 && status < 500 ? { status, code: "bad_request" } : {},
    );
  }
  const body = (await response.json()) as { items?: ComposioAccountItem[] };
  const items = body.items ?? [];
  const out: Record<string, ComposioAccountStatus | undefined> = {};
  for (const toolkit of input.toolkits) {
    out[toolkit] = pickComposioAccountStatus(items, toolkit, input.linked?.[toolkit]);
  }
  return out;
}

// --- Hosted auth links ------------------------------------------------------

/** The link is only ever opened in a browser → allow Composio's own hosts. */
function isSafeComposioRedirect(value: string): boolean {
  try {
    const url = new URL(value);
    return (
      url.protocol === "https:" &&
      (url.hostname === "composio.dev" || url.hostname.endsWith(".composio.dev"))
    );
  } catch {
    return false;
  }
}

async function createComposioManagedAuthConfig(toolkit: string): Promise<void> {
  const response = await fetch(COMPOSIO_AUTH_CONFIGS_URL, {
    method: "POST",
    headers: { "Content-Type": "application/json", "x-api-key": requireComposioKey() },
    body: JSON.stringify({
      toolkit: { slug: toolkit },
      auth_config: { type: "use_composio_managed_auth" },
    }),
    signal: AbortSignal.timeout(SESSION_TIMEOUT_MS),
  });
  // 409 = the config already exists (another request won the race).
  if (!response.ok && response.status !== 409) {
    const detail = await response.text().catch(() => "");
    const summary = redactSecrets(detail.slice(0, 300)).trim();
    throw Object.assign(
      new Error(
        `Composio could not prepare sign-in for "${toolkit}" (${response.status})` +
          `${summary ? `: ${summary}` : "."}`,
      ),
      { status: 400, code: "bad_request" },
    );
  }
}

/**
 * Mints the hosted auth link for one toolkit inside the user's session
 * (POST /tool_router/session/{id}/link — verified live 2026-11-19).
 */
async function mintComposioLink(input: {
  sessionId: string;
  toolkit: string;
  callbackUrl: string;
}): Promise<{ linkToken?: string; redirectUrl: string; connectedAccountId?: string }> {
  const url = `${COMPOSIO_SESSION_URL}/${encodeURIComponent(input.sessionId)}/link`;
  const send = () =>
    fetch(url, {
      method: "POST",
      headers: { "Content-Type": "application/json", "x-api-key": requireComposioKey() },
      body: JSON.stringify({ toolkit: input.toolkit, callback_url: input.callbackUrl }),
      signal: AbortSignal.timeout(SESSION_TIMEOUT_MS),
    });

  let response = await send();
  if (response.status === 404) {
    // Documented 404: "no auth config exists for the toolkit" → create the
    // Composio-managed config and retry once.
    await createComposioManagedAuthConfig(input.toolkit);
    response = await send();
  }
  if (!response.ok) {
    const detail = await response.text().catch(() => "");
    const summary = redactSecrets(detail.slice(0, 400)).trim() || "no details";
    const status = response.status;
    throw Object.assign(
      new Error(`Composio could not start the sign-in flow (${status}): ${summary}`),
      status >= 400 && status < 500 ? { status, code: "bad_request" } : {},
    );
  }
  const body = (await response.json()) as {
    link_token?: string;
    redirect_url?: string;
    connected_account_id?: string;
  };
  const redirectUrl = typeof body.redirect_url === "string" ? body.redirect_url : "";
  if (!redirectUrl || !isSafeComposioRedirect(redirectUrl)) {
    throw new Error("Composio returned an unexpected sign-in URL.");
  }
  return {
    ...(body.link_token ? { linkToken: body.link_token } : {}),
    redirectUrl,
    ...(body.connected_account_id ? { connectedAccountId: body.connected_account_id } : {}),
  };
}

/**
 * Returns the hosted auth link for `toolkit`: reuses the stored one while
 * its flow can still be finished, or mints a new one (`fresh` after
 * expired/failed consent — the old link is dead). Needs a session id.
 */
async function ensureComposioLink(input: {
  connectionId: string;
  sessionId: string | null;
  toolkit: string;
  meta: ComposioSessionMeta;
  fresh?: boolean;
}): Promise<{
  authorizationUrl?: string;
  links: Record<string, ComposioLink>;
  callbackStates: string[];
  minted: boolean;
}> {
  const links = { ...(input.meta.links ?? {}) };
  const callbackStates = [...(input.meta.callbackStates ?? [])];
  const stored = links[input.toolkit];

  if (!input.fresh && stored?.redirectUrl) {
    return { authorizationUrl: stored.redirectUrl, links, callbackStates, minted: false };
  }
  if (!input.sessionId) {
    // No session to hang a link on; the caller surfaces the stored (or
    // absent) URL and the UI falls back to a full reconnect.
    return { authorizationUrl: stored?.redirectUrl, links, callbackStates, minted: false };
  }

  const state = newComposioCallbackState();
  const minted = await mintComposioLink({
    sessionId: input.sessionId,
    toolkit: input.toolkit,
    callbackUrl: composioCallbackUrl(input.connectionId, state),
  });
  links[input.toolkit] = {
    ...(minted.linkToken ? { linkToken: minted.linkToken } : {}),
    redirectUrl: minted.redirectUrl,
    ...(minted.connectedAccountId ? { connectedAccountId: minted.connectedAccountId } : {}),
    createdAt: nowIso(),
  };
  callbackStates.push(state);
  return {
    authorizationUrl: minted.redirectUrl,
    links,
    // Bounded so metadata can't grow without limit across reconnects.
    callbackStates: callbackStates.slice(-20),
    minted: true,
  };
}

// --- Sessions ---------------------------------------------------------------

type ComposioSessionFacts = {
  endpoint: string;
  sessionId: string | null;
  headers: Record<string, string>;
  /** False when we just created it (a sync retry would be pointless). */
  reused: boolean;
};

/** Creates a fresh Tool Router session for `userId` (SSRF-validated URL). */
async function createComposioSession(input: {
  userId: string;
  server: ServerRow;
}): Promise<ComposioSessionFacts> {
  const apiKey = requireComposioKey();
  const toolkits = sessionToolkits(input.server.config);

  let session: ComposioSessionResponse;
  try {
    const response = await fetch(COMPOSIO_SESSION_URL, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "x-api-key": apiKey,
      },
      body: JSON.stringify({
        // ALWAYS the caller's own id: one Composio entity per app user, so
        // users can never end up sharing accounts through a fallback id.
        user_id: input.userId,
        // Allowlist from the catalog listing's config, in the object form the
        // API validates (a bare array → 400 "payload.toolkits: Invalid input").
        ...(toolkits ? { toolkits } : {}),
      }),
      signal: AbortSignal.timeout(SESSION_TIMEOUT_MS),
    });
    if (!response.ok) {
      const detail = await response.text().catch(() => "");
      const summary = redactSecrets(detail.slice(0, 400)).trim() || "no details";
      const status = response.status;
      throw Object.assign(
        new Error(`Composio session API rejected the request (${status}): ${summary}`),
        status >= 400 && status < 500 ? { status, code: "bad_request" } : {},
      );
    }
    session = (await response.json()) as ComposioSessionResponse;
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

  return {
    endpoint: validated.url.toString(),
    sessionId,
    headers: serverHeaders ?? {},
    reused: false,
  };
}

/**
 * Reuses the stored session (its endpoint was SSRF-validated when written)
 * or creates one. `force` mints a fresh session even when one is stored.
 */
async function resolveComposioSession(input: {
  userId: string;
  server: ServerRow;
  row: ConnectionRow | null;
  force?: boolean;
}): Promise<ComposioSessionFacts> {
  const meta = input.row ? sessionMeta(input.row) : {};
  if (!input.force && meta.endpoint && meta.sessionId) {
    const headers = input.row
      ? (readCredentials(input.row) as ComposioCredentials | null)?.composio?.sessionHeaders
      : undefined;
    return { endpoint: meta.endpoint, sessionId: meta.sessionId, headers: headers ?? {}, reused: true };
  }
  return createComposioSession({ userId: input.userId, server: input.server });
}

// --- Tool sync --------------------------------------------------------------

/** Discovers tools on the session endpoint and refreshes the server cache. */
async function syncSessionTools(input: {
  endpoint: string;
  headers: Record<string, string>;
  serverId: string;
}): Promise<number> {
  try {
    const tools = await listRemoteTools({ endpoint: input.endpoint, headers: mcpHeaders(input.headers) });
    await syncServerTools(input.serverId, tools);
    return tools.length;
  } catch (error) {
    throw new Error(redactSecrets(error instanceof Error ? error.message : String(error)));
  }
}

/**
 * Syncs tools, re-creating the session once when Composio has retired the
 * stored one (a freshly created session failing is a real error — no retry).
 */
async function syncSessionWithRetry(input: {
  userId: string;
  server: ServerRow;
  session: ComposioSessionFacts;
}): Promise<{ toolCount: number; session: ComposioSessionFacts }> {
  try {
    const toolCount = await syncSessionTools({
      endpoint: input.session.endpoint,
      headers: input.session.headers,
      serverId: input.server.id,
    });
    return { toolCount, session: input.session };
  } catch (primary) {
    if (!input.session.reused) throw primary;
    const session = await createComposioSession({ userId: input.userId, server: input.server });
    const toolCount = await syncSessionTools({
      endpoint: session.endpoint,
      headers: session.headers,
      serverId: input.server.id,
    });
    return { toolCount, session };
  }
}

// --- Credentials ------------------------------------------------------------

type ComposioCredentials = {
  composio?: {
    sessionHeaders?: Record<string, string>;
    entityUserId?: string;
  };
};

async function readComposioSession(
  row: ConnectionRow,
): Promise<ComposioCredentials["composio"] | undefined> {
  return (readCredentials(row) as ComposioCredentials | null)?.composio;
}

// --- Connect / verify / refresh --------------------------------------------

export type ComposioConnectResult = {
  connectionId: string;
  serverId: string;
  status: MCPConnectionStatus;
  toolCount?: number;
  /** Set when the user must authorize: open this in a browser. */
  authorizationUrl?: string;
};

export type ComposioVerifyResult = {
  status: MCPConnectionStatus;
  toolCount?: number;
  authorizationUrl?: string;
  message?: string;
};

const PLAN_MESSAGES: Record<ComposioPlan["reason"], string> = {
  all_toolkits_active: "",
  awaiting_consent: "Waiting for you to finish signing in.",
  consent_expired: "The sign-in link expired — start the sign-in again.",
  account_not_usable: "Authorization was refused or revoked — reconnect to try again.",
  no_toolkits_configured: "This integration has no toolkit configured.",
};

/**
 * Connects the user's account for one listing:
 * 1. create/reuse the Tool Router session (SSRF-validated endpoint),
 * 2. ask Composio whether an ACTIVE account already exists for the toolkits,
 * 3. only then decide — ACTIVE everywhere → sync tools → `connected`;
 *    otherwise → `pending` (+ hosted `authorizationUrl` to finish signing in).
 *
 * Tools are never synced before the account is verified as ACTIVE.
 */
export async function connectComposio(input: {
  userId: string;
  server: ServerRow;
}): Promise<ComposioConnectResult> {
  const toolkits = configuredToolkits(input.server.config);
  const noAuth = isNoAuthListing(input.server.config);

  // The Composio entity is ALWAYS the authenticated user id: never a
  // client-supplied value or a privileged id read from configuration.
  const entity = input.userId;

  const existing = await getConnectionForServer(input.userId, input.server.id);
  let session = await resolveComposioSession({
    userId: input.userId,
    server: input.server,
    row: existing,
  });

  const previous = existing ? sessionMeta(existing) : {};
  const meta: ComposioSessionMeta = {
    ...(previous.links ? { links: previous.links } : {}),
    ...(previous.callbackStates?.length ? { callbackStates: previous.callbackStates } : {}),
    ...(typeof previous.toolCount === "number" ? { toolCount: previous.toolCount } : {}),
    createdAt: previous.createdAt ?? nowIso(),
    endpoint: session.endpoint,
    sessionId: session.sessionId,
  };

  const accounts = await fetchComposioAccounts({
    entity,
    toolkits,
    linked: linkedAccountIds(previous),
  });
  const plan = planComposioConnect({ toolkits, accounts, noAuth });

  if (plan.status === "connected") {
    // Consent already ACTIVE (possibly granted through another session for
    // the same entity): discover tools first, persist `connected` only after.
    const synced = await syncSessionWithRetry({ userId: input.userId, server: input.server, session });
    session = synced.session;
    meta.endpoint = session.endpoint;
    meta.sessionId = session.sessionId;
    const row = await upsertConnection({
      userId: input.userId,
      serverId: input.server.id,
      authType: "provider_managed",
      status: "connected",
      credentials: {
        composio: {
          sessionHeaders: session.headers,
          entityUserId: entity,
        },
      },
      metadata: {
        [SESSION_METADATA_KEY]: {
          ...meta,
          toolCount: synced.toolCount,
          verifiedAt: nowIso(),
          lastError: null,
        },
      },
      providerConnectionId: session.sessionId,
    });
    return {
      connectionId: row.id,
      serverId: input.server.id,
      status: "connected",
      toolCount: synced.toolCount,
    };
  }

  // Not authorized yet → persist `pending` (the callback needs its id), then
  // hand the app the hosted link to open in a browser.
  const row = await upsertConnection({
    userId: input.userId,
    serverId: input.server.id,
    authType: "provider_managed",
    status: "pending",
    credentials: {
      composio: {
        sessionHeaders: session.headers,
        entityUserId: entity,
      },
    },
    metadata: { [SESSION_METADATA_KEY]: meta },
    providerConnectionId: session.sessionId,
  });

  let authorizationUrl: string | undefined;
  let links = meta.links;
  let callbackStates = meta.callbackStates;
  if (plan.linkToolkit) {
    const link = await ensureComposioLink({
      connectionId: row.id,
      sessionId: session.sessionId,
      toolkit: plan.linkToolkit,
      meta,
      // Expired/failed consent → the stored link is dead; start over.
      fresh: plan.status !== "pending",
    });
    authorizationUrl = link.authorizationUrl;
    links = link.links;
    callbackStates = link.callbackStates;
  }

  await updateConnection(input.userId, row.id, {
    status: plan.status,
    metadata: {
      [SESSION_METADATA_KEY]: {
        ...meta,
        ...(links ? { links } : {}),
        ...(callbackStates ? { callbackStates } : {}),
        ...(plan.status === "pending" ? { lastError: null } : {}),
      },
    },
  });

  return {
    connectionId: row.id,
    serverId: input.server.id,
    status: plan.status,
    ...(authorizationUrl ? { authorizationUrl } : {}),
  };
}

/**
 * Re-checks a connection against Composio's own connected-account state —
 * the public callback, POST /connections/:id/verify and refresh all end up
 * here. A session is never treated as authorization: `connected` requires
 * ACTIVE accounts plus a successful tool sync, and when consent is still
 * needed the result can carry the link to finish it (`issueLink`).
 *
 * Polling passes `issueLink: false` so it stays side-effect free (no link
 * minted, no write while the status is unchanged).
 */
export async function verifyComposio(input: {
  userId: string;
  connectionId: string;
  /** Issue/reuse the hosted auth link. Defaults to true (user-initiated). */
  issueLink?: boolean;
}): Promise<ComposioVerifyResult> {
  const row = await getConnection(input.userId, input.connectionId);
  if (!row) {
    throw Object.assign(new Error("Connection no longer exists."), {
      status: 404,
      code: "not_found",
    });
  }
  if (row.status === "disconnected") {
    return { status: "disconnected", message: "This integration is disconnected — connect it again." };
  }
  const server = await getServer(row.mcp_server_id);
  if (!server || server.provider !== "composio") {
    throw Object.assign(new Error("This is not a Composio connection."), {
      status: 400,
      code: "bad_request",
    });
  }

  const toolkits = configuredToolkits(server.config);
  const noAuth = isNoAuthListing(server.config);
  const previous = sessionMeta(row);

  const accounts = await fetchComposioAccounts({
    entity: input.userId,
    toolkits,
    linked: linkedAccountIds(previous),
  });
  const plan = planComposioConnect({ toolkits, accounts, noAuth });

  if (plan.status === "connected") {
    let session: ComposioSessionFacts;
    let toolCount: number;
    try {
      session = await resolveComposioSession({ userId: input.userId, server, row });
      const synced = await syncSessionWithRetry({ userId: input.userId, server, session });
      session = synced.session;
      toolCount = synced.toolCount;
    } catch (error) {
      // Account is ACTIVE but the tools can't load → honest error state
      // (the next verify/refresh retries the sync).
      const message = redactSecrets(error instanceof Error ? error.message : String(error));
      await updateConnection(input.userId, row.id, {
        status: "error",
        metadata: {
          [SESSION_METADATA_KEY]: { ...previous, verifiedAt: nowIso(), lastError: message },
        },
      });
      return { status: "error", message };
    }
    await updateConnection(input.userId, row.id, {
      status: "connected",
      providerConnectionId: session.sessionId,
      metadata: {
        [SESSION_METADATA_KEY]: {
          ...previous,
          endpoint: session.endpoint,
          sessionId: session.sessionId,
          toolCount,
          verifiedAt: nowIso(),
          lastError: null,
        },
      },
    });
    return { status: "connected", toolCount };
  }

  // Still needs authorization (or failed/expired) → persist the real status
  // and, when the caller wants a link, mint/reuse the hosted one.
  let authorizationUrl: string | undefined;
  let links = previous.links;
  let callbackStates = previous.callbackStates;
  let minted = false;
  if (plan.linkToolkit && input.issueLink !== false) {
    // Minting needs a session id; legacy rows without one get a fresh session.
    const session = await resolveComposioSession({ userId: input.userId, server, row });
    const link = await ensureComposioLink({
      connectionId: row.id,
      sessionId: session.sessionId,
      toolkit: plan.linkToolkit,
      meta: previous,
      fresh: plan.status !== "pending", // expired/failed → brand-new link
    });
    authorizationUrl = link.authorizationUrl;
    links = link.links;
    callbackStates = link.callbackStates;
    minted = link.minted;
  }

  const statusChanged = row.status !== plan.status;
  if (statusChanged || minted) {
    await updateConnection(input.userId, row.id, {
      status: plan.status,
      metadata: {
        [SESSION_METADATA_KEY]: {
          ...previous,
          ...(links ? { links } : {}),
          ...(callbackStates ? { callbackStates } : {}),
          verifiedAt: nowIso(),
          ...(plan.status === "pending" ? { lastError: null } : {}),
        },
      },
    });
  }

  return {
    status: plan.status,
    ...(authorizationUrl ? { authorizationUrl } : {}),
    ...(PLAN_MESSAGES[plan.reason] ? { message: PLAN_MESSAGES[plan.reason] } : {}),
  };
}

/**
 * Health check: re-verifies the connected account and re-syncs tools. A
 * fresh session alone NEVER means connected — status comes from Composio's
 * account state, and expired/revoked consent comes back with a new link.
 */
export async function refreshComposio(input: {
  userId: string;
  connectionId: string;
}): Promise<{
  toolCount: number;
  status: MCPConnectionStatus;
  authorizationUrl?: string;
  message?: string;
}> {
  const result = await verifyComposio({
    userId: input.userId,
    connectionId: input.connectionId,
    issueLink: true,
  });
  return {
    toolCount: result.toolCount ?? 0,
    status: result.status,
    ...(result.authorizationUrl ? { authorizationUrl: result.authorizationUrl } : {}),
    ...(result.message ? { message: result.message } : {}),
  };
}

/** Executes a tool on the user's Composio session endpoint. */
export async function executeComposioTool(input: {
  userId: string;
  connectionId: string;
  externalToolId: string;
  args: Record<string, unknown>;
}): Promise<unknown> {
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
