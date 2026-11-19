import assert from "node:assert/strict";
import { randomBytes, randomUUID } from "node:crypto";
import { after, beforeEach, describe, it } from "node:test";

import { POST as verifyRoute } from "@/app/api/mcp/connections/[id]/verify/route";
import {
  connectComposio,
  isComposioCallbackState,
  newComposioCallbackState,
  planComposioConnect,
  verifyComposio,
} from "@/lib/mcp/providers/composio";
import type { ServerRow } from "@/lib/mcp/registry";

/**
 * Composio connect/verify tests (pending → authorize → verify flow).
 *
 * `connectComposio` and `verifyComposio` talk to three real systems, so the
 * test harness replaces `globalThis.fetch` and answers like they would:
 *   - Supabase (PostgREST `/rest/v1/*`, GoTrue `/auth/v1/user`),
 *   - Composio (session / connected_accounts / link),
 *   - the session's MCP endpoint (`server/discover` + `tools/list`).
 * `validateEndpoint` still does a REAL DNS lookup of backend.composio.dev,
 * so these tests need network access for DNS only — no HTTP leaves the box.
 *
 * What is asserted (the actual requirements):
 *   - an already-ACTIVE account → `connected` with tools synced, no link;
 *   - no consent yet → `pending` + hosted `authorizationUrl`, NO tool sync,
 *     callback state persisted, entity id = the caller's own user id, and
 *     the platform key never written to the row;
 *   - expired/revoked consent → `expired`/`error` + a fresh link;
 *   - verify re-checks the account (never trusts a session) and polls with
 *     `issueLink: false` stay side-effect free;
 *   - the verify route 404s connections that aren't the caller's.
 */

// All env is read lazily (first client creation), so setting it after the
// imports — before any test runs — is sufficient. Nothing here is real:
// the fetch mock below answers every request these values point at.
const USER_ID = "00000000-0000-4000-8000-000000000001";
const OTHER_USER_ID = "00000000-0000-4000-8000-000000000002";
const CONNECTION_ID = "aaaaaaaa-bbbb-4ccc-8ddd-eeeeeeeeeeee";
const PLATFORM_KEY = "ak_test_platform_key_not_real";

process.env.SUPABASE_URL = "http://supabase.test";
process.env.SUPABASE_ANON_KEY = "anon-test-key";
process.env.SUPABASE_SERVICE_ROLE_KEY = "service-role-test-key";
process.env.ALLOWED_USER_ID = USER_ID;
process.env.COMPOSIO_API_KEY = PLATFORM_KEY;
process.env.ENCRYPTION_KEY = randomBytes(32).toString("hex");
// Never inherit a developer's override — the derived localhost default keeps
// the callback_url assertions deterministic.
delete process.env.MCP_COMPOSIO_CALLBACK_URL;
delete process.env.VERCEL_URL;
delete process.env.VERCEL_PROJECT_PRODUCTION_URL;

// --- Fixtures ---------------------------------------------------------------

const SERVER_ROW: ServerRow = {
  id: "srv_composio_gmail",
  slug: "composio-gmail",
  name: "Gmail",
  description: "Send and read email.",
  instructions: "",
  provider: "composio",
  category: "productivity",
  endpoint: null,
  transport: "http",
  auth_type: "provider_managed",
  config: { toolkits: ["gmail"] },
  capabilities: {},
  icon_url: null,
  is_verified: true,
  is_free_tier: true,
  enabled: true,
  created_by: USER_ID,
  created_at: "2026-11-19T00:00:00.000Z",
  updated_at: "2026-11-19T00:00:00.000Z",
};

const STORED_ENDPOINT = "https://backend.composio.dev/tool_router/trs_seed_1/mcp";
const STORED_LINK = "https://connect.composio.dev/link/stored-old";
const STORED_STATE = "111111111111111111111111111111aa";

function seedConnection(overrides: Record<string, unknown> = {}): Record<string, unknown> {
  return {
    id: CONNECTION_ID,
    user_id: USER_ID,
    mcp_server_id: SERVER_ROW.id,
    provider_connection_id: "trs_seed_1",
    status: "pending",
    auth_type: "provider_managed",
    credentials_ciphertext: null,
    credentials_iv: null,
    credentials_tag: null,
    key_version: null,
    metadata: {
      composio_session: {
        endpoint: STORED_ENDPOINT,
        sessionId: "trs_seed_1",
        createdAt: "2026-11-19T00:00:00.000Z",
        links: {
          gmail: { redirectUrl: STORED_LINK, createdAt: "2026-11-19T00:00:00.000Z" },
        },
        callbackStates: [STORED_STATE],
      },
    },
    created_at: "2026-11-19T00:00:00.000Z",
    updated_at: "2026-11-19T00:00:00.000Z",
    ...overrides,
  };
}

const MOCK_TOOL = {
  name: "GMAIL_SEND_EMAIL",
  description: "Send an email through Gmail.",
  inputSchema: {
    type: "object",
    properties: { to: { type: "string" }, body: { type: "string" } },
    required: ["to", "body"],
  },
};

// --- Fetch harness ----------------------------------------------------------

type FetchCall = {
  url: string;
  method: string;
  headers: Record<string, string>;
  body: string | null;
};

const calls: FetchCall[] = [];
const db = {
  connections: [] as Record<string, unknown>[],
  servers: [] as Record<string, unknown>[],
  tools: [] as Record<string, unknown>[],
  /** Composio connected_accounts items for the entity under test. */
  accounts: [] as Record<string, unknown>[],
};
let sessionCounter = 0;
let linkCounter = 0;
let toolsListCount = 0;

const originalFetch = globalThis.fetch;

function headerRecord(init?: RequestInit): Record<string, string> {
  const out: Record<string, string> = {};
  const headers = init?.headers;
  if (headers instanceof Headers) {
    headers.forEach((value, key) => {
      out[key.toLowerCase()] = value;
    });
  } else if (Array.isArray(headers)) {
    for (const [key, value] of headers) out[key.toLowerCase()] = value;
  } else if (headers) {
    for (const [key, value] of Object.entries(headers)) out[key.toLowerCase()] = String(value);
  }
  return out;
}

function jsonResponse(status: number, body: unknown): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "content-type": "application/json" },
  });
}

function emptyResponse(status: number): Response {
  return new Response(null, { status });
}

/** Minimal PostgREST `eq.` filtering so `user_id=…&id=…` lookups behave. */
function filterRows(
  rows: Record<string, unknown>[],
  params: URLSearchParams,
): Record<string, unknown>[] {
  return rows.filter((row) => {
    for (const [key, value] of params) {
      if (!value.startsWith("eq.")) continue;
      if (String(row[key]) !== value.slice(3)) return false;
    }
    return true;
  });
}

function postgrestResponse(
  table: string,
  method: string,
  url: URL,
  headers: Record<string, string>,
  bodyText: string | null,
): Response | undefined {
  const rows =
    table === "user_mcp_connections"
      ? db.connections
      : table === "mcp_servers"
        ? db.servers
        : table === "mcp_tools"
          ? db.tools
          : undefined;
  if (!rows) throw new Error(`Unexpected table in test: ${table}`);
  const prefer = headers["prefer"] ?? "";
  const wantsObject = (headers["accept"] ?? "").includes("vnd.pgrst.object+json");

  if (method === "GET") {
    return jsonResponse(200, filterRows(rows, url.searchParams));
  }
  if (method === "POST") {
    const payload = (bodyText ? JSON.parse(bodyText) : {}) as Record<string, unknown>;
    const row: Record<string, unknown> = {
      id: randomUUID(),
      created_at: new Date().toISOString(),
      last_checked_at: null,
      ...payload,
    };
    if (table === "user_mcp_connections") {
      // onConflict user_id,mcp_server_id → one row per (user, server).
      db.connections = db.connections.filter(
        (existing) =>
          !(existing.user_id === row.user_id && existing.mcp_server_id === row.mcp_server_id),
      );
      db.connections.push(row);
    } else {
      rows.push(row);
    }
    if (wantsObject) return jsonResponse(201, row);
    if (prefer.includes("return=representation")) return jsonResponse(201, [row]);
    return emptyResponse(201);
  }
  if (method === "PATCH") {
    const payload = (bodyText ? JSON.parse(bodyText) : {}) as Record<string, unknown>;
    const matched = filterRows(rows, url.searchParams);
    for (const row of matched) Object.assign(row, payload);
    if (prefer.includes("return=representation")) return jsonResponse(200, matched);
    return emptyResponse(204);
  }
  if (method === "DELETE") {
    const doomed = new Set(filterRows(rows, url.searchParams));
    for (let index = rows.length - 1; index >= 0; index--) {
      if (doomed.has(rows[index])) rows.splice(index, 1);
    }
    return emptyResponse(204);
  }
  throw new Error(`Unexpected PostgREST method: ${method}`);
}

function composioResponse(url: URL, method: string, bodyText: string | null): Response {
  // The MCP session endpoint (validateEndpoint passed its DNS check already).
  if (url.pathname.endsWith("/mcp")) {
    if (method === "GET") return emptyResponse(405); // inbound-SSE probe: "not supported"
    if (method === "DELETE") return emptyResponse(204);
    const rpc = (bodyText ? JSON.parse(bodyText) : {}) as {
      id?: unknown;
      method?: string;
      params?: { protocolVersion?: string };
    };
    if (rpc.method === "server/discover") {
      return jsonResponse(200, {
        jsonrpc: "2.0",
        id: rpc.id,
        result: {
          supportedVersions: ["2026-07-28", "2025-11-25"],
          capabilities: { tools: {} },
        },
      });
    }
    if (rpc.method === "initialize") {
      return jsonResponse(200, {
        jsonrpc: "2.0",
        id: rpc.id,
        result: {
          protocolVersion: rpc.params?.protocolVersion ?? "2025-11-25",
          capabilities: { tools: {} },
          serverInfo: { name: "composio-mock", version: "1.0.0" },
        },
      });
    }
    if (rpc.method === "tools/list") {
      toolsListCount += 1;
      return jsonResponse(200, {
        jsonrpc: "2.0",
        id: rpc.id,
        result: { tools: [MOCK_TOOL] },
      });
    }
    if (rpc.id === undefined) return emptyResponse(200); // notification
    return jsonResponse(200, {
      jsonrpc: "2.0",
      id: rpc.id,
      error: { code: -32601, message: "Method not found" },
    });
  }
  if (url.pathname === "/api/v3.1/connected_accounts") {
    return jsonResponse(200, {
      items: db.accounts,
      next_cursor: null,
      total_pages: 1,
      current_page: 1,
      total_items: db.accounts.length,
    });
  }
  if (url.pathname.endsWith("/link")) {
    linkCounter += 1;
    return jsonResponse(201, {
      link_token: `lk_${linkCounter}`,
      redirect_url: `https://connect.composio.dev/link/lk_${linkCounter}`,
      connected_account_id: `ca_${linkCounter}`,
    });
  }
  if (url.pathname === "/api/v3.1/tool_router/session") {
    sessionCounter += 1;
    return jsonResponse(201, {
      session_id: `trs_${sessionCounter}`,
      mcp: { type: "http", url: `https://backend.composio.dev/tool_router/trs_${sessionCounter}/mcp` },
    });
  }
  throw new Error(`Unexpected Composio request: ${method} ${url.pathname}`);
}

globalThis.fetch = (async (input: RequestInfo | URL, init?: RequestInit) => {
  const url = new URL(input instanceof Request ? input.url : String(input));
  const method = (init?.method ?? (input instanceof Request ? input.method : "GET")).toUpperCase();
  const headers = headerRecord(init);
  const body = typeof init?.body === "string" ? init.body : null;
  calls.push({ url: url.toString(), method, headers, body });

  if (url.pathname === "/auth/v1/user") {
    // GoTrue: requireUser() → supabaseAnon().auth.getUser(token).
    return jsonResponse(200, {
      id: USER_ID,
      email: "tester@example.com",
      aud: "authenticated",
      role: "authenticated",
      updated_at: "2026-11-19T00:00:00.000Z",
    });
  }
  if (url.pathname.startsWith("/rest/v1/")) {
    const table = url.pathname.slice("/rest/v1/".length).split("?")[0];
    return postgrestResponse(table, method, url, headers, body);
  }
  if (url.hostname === "backend.composio.dev") {
    return composioResponse(url, method, body);
  }
  throw new Error(`Unexpected fetch in test: ${method} ${url.toString()}`);
}) as typeof fetch;

after(() => {
  globalThis.fetch = originalFetch;
});

beforeEach(() => {
  calls.length = 0;
  db.connections = [];
  db.servers = [];
  db.tools = [];
  db.accounts = [];
  sessionCounter = 0;
  linkCounter = 0;
  toolsListCount = 0;
});

// --- Helpers ----------------------------------------------------------------

function findCall(predicate: (call: FetchCall) => boolean): FetchCall | undefined {
  return calls.find(predicate);
}

function connectionWrites(method: "POST" | "PATCH"): FetchCall[] {
  return calls.filter(
    (call) => call.method === method && call.url.includes("/rest/v1/user_mcp_connections"),
  );
}

function persistedStatus(call: FetchCall): string {
  return String((JSON.parse(call.body ?? "{}") as Record<string, unknown>).status);
}

// --- planComposioConnect (the decision core) --------------------------------

describe("planComposioConnect", () => {
  it("already-active path: every toolkit ACTIVE → connected, no link", () => {
    const plan = planComposioConnect({
      toolkits: ["gmail"],
      accounts: { gmail: "ACTIVE" },
    });
    assert.equal(plan.status, "connected");
    assert.equal(plan.linkToolkit, null);
  });

  it("needs-auth path: no account → pending with the toolkit to authorize", () => {
    const plan = planComposioConnect({ toolkits: ["gmail"], accounts: {} });
    assert.equal(plan.status, "pending");
    assert.equal(plan.linkToolkit, "gmail");
  });

  it("never reports connected without evidence (no toolkits configured)", () => {
    const plan = planComposioConnect({ toolkits: [], accounts: {} });
    assert.equal(plan.status, "pending");
    assert.notEqual(plan.status, "connected");
  });

  it("refused/revoked consent → error, expired consent → expired", () => {
    assert.equal(
      planComposioConnect({ toolkits: ["gmail"], accounts: { gmail: "REVOKED" } }).status,
      "error",
    );
    assert.equal(
      planComposioConnect({ toolkits: ["gmail"], accounts: { gmail: "EXPIRED" } }).status,
      "expired",
    );
  });

  it("unknown account state (e.g. a toolkit never authorized) stays pending", () => {
    const plan = planComposioConnect({
      toolkits: ["gmail", "github"],
      accounts: { gmail: "ACTIVE", github: "UNKNOWN" },
    });
    assert.equal(plan.status, "pending");
    assert.equal(plan.linkToolkit, "github");
  });
});

// --- connectComposio --------------------------------------------------------

describe("connectComposio", () => {
  it("already-active path: ACTIVE account → connected + tools synced, no link", async () => {
    db.servers = [SERVER_ROW];
    db.accounts = [{ id: "ca_active", status: "ACTIVE", toolkit: { slug: "gmail" } }];

    const result = await connectComposio({ userId: USER_ID, server: SERVER_ROW });

    assert.equal(result.status, "connected");
    assert.equal(result.toolCount, 1);
    assert.equal(result.authorizationUrl, undefined);
    assert.equal(toolsListCount, 1, "tools are synced once consent is ACTIVE");

    const upserts = connectionWrites("POST");
    assert.equal(upserts.length, 1);
    assert.equal(persistedStatus(upserts[0]), "connected");
    assert.ok(!findCall((call) => call.url.endsWith("/link")), "no hosted link was minted");

    // The Composio entity is always the caller's own user id.
    const accountsCall = findCall((call) => call.url.includes("/api/v3.1/connected_accounts"));
    assert.ok(accountsCall);
    const entity = new URL(accountsCall.url).searchParams.get("user_ids");
    assert.equal(entity, USER_ID);
  });

  it("needs-auth path: no consent → pending + hosted link, NO tool sync", async () => {
    db.servers = [SERVER_ROW];

    const result = await connectComposio({ userId: USER_ID, server: SERVER_ROW });

    assert.equal(result.status, "pending");
    assert.ok(result.authorizationUrl?.startsWith("https://connect.composio.dev/link/"));
    assert.equal(toolsListCount, 0, "tools must not sync before consent is ACTIVE");

    const upserts = connectionWrites("POST");
    assert.equal(upserts.length, 1);
    assert.equal(persistedStatus(upserts[0]), "pending");
    const upsertBody = upserts[0].body ?? "";
    assert.ok(
      !upsertBody.includes(PLATFORM_KEY),
      "the platform key is injected at request time, never stored",
    );

    // The link carries OUR callback_url (connection id + signed state)…
    const link = findCall((call) => call.url.endsWith("/link"));
    assert.ok(link);
    const linkBody = JSON.parse(link.body ?? "{}") as {
      toolkit?: string;
      callback_url?: string;
    };
    assert.equal(linkBody.toolkit, "gmail");
    const callback = new URL(linkBody.callback_url ?? "");
    assert.equal(callback.pathname, "/api/mcp/composio/callback");
    assert.match(callback.searchParams.get("connectionId") ?? "", /^[0-9a-f-]{36}$/);
    const state = callback.searchParams.get("state") ?? "";
    assert.match(state, /^[0-9a-f]{32}$/);

    // …and the same state is persisted on the row (the callback's trust anchor).
    const patch = findCall((call) => call.method === "PATCH");
    assert.ok(patch, "the pending status + link are persisted");
    assert.equal(persistedStatus(patch), "pending");
    const meta = (
      JSON.parse(patch.body ?? "{}") as {
        metadata?: { composio_session?: { callbackStates?: string[] } };
      }
    ).metadata?.composio_session;
    assert.deepEqual(meta?.callbackStates, [state]);
  });

  it("expired consent → expired status + fresh authorizationUrl, no sync", async () => {
    db.servers = [SERVER_ROW];
    db.accounts = [{ id: "ca_old", status: "EXPIRED", toolkit: { slug: "gmail" } }];

    const result = await connectComposio({ userId: USER_ID, server: SERVER_ROW });

    assert.equal(result.status, "expired");
    assert.ok(result.authorizationUrl?.startsWith("https://connect.composio.dev/link/"));
    assert.equal(toolsListCount, 0);
    const upserts = connectionWrites("POST");
    assert.equal(persistedStatus(upserts[0]), "pending"); // first write is the row…
    const patch = findCall((call) => call.method === "PATCH");
    assert.ok(patch);
    assert.equal(persistedStatus(patch), "expired"); // …then the real state lands
  });

  it("refused/revoked consent → error status with a retry link", async () => {
    db.servers = [SERVER_ROW];
    db.accounts = [{ id: "ca_bad", status: "REVOKED", toolkit: { slug: "gmail" } }];

    const result = await connectComposio({ userId: USER_ID, server: SERVER_ROW });

    assert.equal(result.status, "error");
    assert.ok(result.authorizationUrl, "a fresh link lets the user retry");
    assert.equal(toolsListCount, 0);
  });
});

// --- verifyComposio ---------------------------------------------------------

describe("verifyComposio", () => {
  it("re-verifies the account: pending row + ACTIVE → connected with tool sync", async () => {
    db.servers = [SERVER_ROW];
    db.connections = [seedConnection()];
    db.accounts = [{ id: "ca_active", status: "ACTIVE", toolkit: { slug: "gmail" } }];

    const result = await verifyComposio({ userId: USER_ID, connectionId: CONNECTION_ID });

    assert.equal(result.status, "connected");
    assert.equal(result.toolCount, 1);
    assert.equal(toolsListCount, 1);

    const patch = findCall((call) => call.method === "PATCH");
    assert.ok(patch);
    assert.equal(persistedStatus(patch), "connected");
    assert.ok(!findCall((call) => call.url.endsWith("/link")), "nothing to authorize anymore");
  });

  it("polling (issueLink:false) stays pending, mints nothing, writes nothing", async () => {
    db.servers = [SERVER_ROW];
    db.connections = [seedConnection()]; // pending, with a stored link
    db.accounts = [];

    const result = await verifyComposio({
      userId: USER_ID,
      connectionId: CONNECTION_ID,
      issueLink: false,
    });

    assert.equal(result.status, "pending");
    assert.ok(!findCall((call) => call.url.endsWith("/link")), "polls never mint links");
    assert.equal(
      connectionWrites("PATCH").length,
      0,
      "status unchanged → no write while polling",
    );
    assert.equal(toolsListCount, 0);
  });

  it("expired consent + issueLink:true → expired + a FRESH authorizationUrl", async () => {
    db.servers = [SERVER_ROW];
    db.connections = [seedConnection()];
    db.accounts = [{ id: "ca_old", status: "EXPIRED", toolkit: { slug: "gmail" } }];

    const result = await verifyComposio({
      userId: USER_ID,
      connectionId: CONNECTION_ID,
      issueLink: true,
    });

    assert.equal(result.status, "expired");
    assert.ok(result.authorizationUrl);
    assert.notEqual(result.authorizationUrl, STORED_LINK, "the dead link is replaced");
    assert.ok(result.authorizationUrl.startsWith("https://connect.composio.dev/link/"));
    const patch = findCall((call) => call.method === "PATCH");
    assert.ok(patch);
    assert.equal(persistedStatus(patch), "expired");
  });

  it("disconnected rows are never resurrected (no Composio traffic at all)", async () => {
    db.servers = [SERVER_ROW];
    db.connections = [
      seedConnection({ status: "disconnected", metadata: {}, credentials_ciphertext: null }),
    ];
    db.accounts = [{ id: "ca_active", status: "ACTIVE", toolkit: { slug: "gmail" } }];

    const result = await verifyComposio({ userId: USER_ID, connectionId: CONNECTION_ID });

    assert.equal(result.status, "disconnected");
    assert.ok(!findCall((call) => call.url.includes("backend.composio.dev")));
    assert.equal(connectionWrites("PATCH").length, 0);
  });
});

// --- POST /api/mcp/connections/:id/verify (route) ----------------------------

describe("POST /api/mcp/connections/:id/verify", () => {
  function request(issueLink: boolean): Request {
    return new Request("http://localhost/api/mcp/connections/verify", {
      method: "POST",
      headers: {
        authorization: "Bearer test-jwt",
        "content-type": "application/json",
      },
      body: JSON.stringify({ issueLink }),
    });
  }

  it("verifies the caller's connection and returns the real status", async () => {
    db.servers = [SERVER_ROW];
    db.connections = [seedConnection()];
    db.accounts = [{ id: "ca_active", status: "ACTIVE", toolkit: { slug: "gmail" } }];

    const response = await verifyRoute(request(false), {
      params: Promise.resolve({ id: CONNECTION_ID }),
    });

    assert.equal(response.status, 200);
    const body = (await response.json()) as { status?: string; toolCount?: number };
    assert.equal(body.status, "connected");
    assert.equal(body.toolCount, 1);
    assert.ok(!findCall((call) => call.url.endsWith("/link")), "issueLink:false mints nothing");
  });

  it("404s connections that are not the caller's", async () => {
    db.servers = [SERVER_ROW];
    db.connections = [seedConnection({ user_id: OTHER_USER_ID })];
    db.accounts = [{ id: "ca_active", status: "ACTIVE", toolkit: { slug: "gmail" } }];

    const response = await verifyRoute(request(true), {
      params: Promise.resolve({ id: CONNECTION_ID }),
    });

    assert.equal(response.status, 404);
    assert.ok(
      !findCall((call) => call.url.includes("backend.composio.dev")),
      "no provider call happens for someone else's connection",
    );
  });
});

// --- Callback state (the public callback's trust anchor) ---------------------

describe("composio callback state", () => {
  it("accepts only states minted for this connection", () => {
    const state = newComposioCallbackState();
    assert.match(state, /^[0-9a-f]{32}$/);
    assert.equal(isComposioCallbackState(state, [state]), true);
    assert.equal(isComposioCallbackState(`${state.slice(0, 31)}0`, [state]), false);
    assert.equal(isComposioCallbackState(newComposioCallbackState(), [state]), false);
    assert.equal(isComposioCallbackState("", [state]), false);
    assert.equal(isComposioCallbackState(state, []), false);
  });
});
