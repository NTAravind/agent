# MCP Marketplace & Composio Integrations — Developer Specification

> **Source of truth:** This document reflects the implementation as of 2026-11-19. If code and this spec diverge, the code wins — update this document.

---

## 1. Architecture Overview

The MCP Marketplace is a **two-tier system**:

```
┌─────────────────────────────────────────────────────────────────────┐
│                         MARKETPLACE CATALOG                         │
│  (mcp_servers table — global, admin-seeded, read-only for users)   │
│  ┌─────────────────┐  ┌─────────────────┐  ┌─────────────────────┐  │
│  │  Direct/Remote  │  │     Composio    │  │    Composio         │  │
│  │  (provider=     │  │    (provider=   │  │    Catalog Tab      │  │
│  │   direct)       │  │   composio)     │  │  (dynamic, 1700+)   │  │
│  │  — fixed list   │  │  — fixed list   │  │  — NOT in mcp_      │  │
│  │  hand-seeded    │  │  materialized   │  │  servers until      │  │
│  │                 │  │  on first       │  │  user clicks        │  │
│  │                 │  │  connect        │  │  Connect            │  │
│  └─────────────────┘  └─────────────────┘  └─────────────────────┘  │
└─────────────────────────────────────────────────────────────────────┘
                              │
                              ▼
┌─────────────────────────────────────────────────────────────────────┐
│                      PER-USER CONNECTIONS                           │
│  (user_mcp_connections — one per user per server, encrypted creds)  │
│  ┌──────────────┐  ┌──────────────┐  ┌──────────────────────────┐  │
│  │  Direct:     │  │  Composio:   │  │  OAuth/API key:          │  │
│  │  api_key /   │  │  provider_   │  │  OAuth callback /        │  │
│  │  oauth2 /    │  │  managed     │  │  API key stored encrypted│  │
│  │  pat         │  │  (session    │  │  in credentials_ciphertext│  │
│  │              │  │   endpoint)  │  │                           │  │
│  └──────────────┘  └──────────────┘  └──────────────────────────┘  │
└─────────────────────────────────────────────────────────────────────┘
                              │
                              ▼
┌─────────────────────────────────────────────────────────────────────┐
│                      AGENT ATTACHMENTS                              │
│  (agent_mcp_servers + agent_mcp_tool_permissions)                   │
│  User enables a connection for an agent → tools discovered,         │
│  cached, and filtered by per-agent permission rows.                 │
└─────────────────────────────────────────────────────────────────────┘
```

---

## 2. Database Schema (Relevant Tables)

| Table | Purpose | Key Columns |
|-------|---------|-------------|
| `mcp_servers` | Global marketplace catalog (admin-managed) | `id, slug, name, provider, category, endpoint, auth_type, config, capabilities, icon_url, is_verified, is_free_tier, enabled` |
| `user_mcp_connections` | Per-user credential store (encrypted) | `id, user_id, mcp_server_id, provider_connection_id, status, auth_type, credentials_ciphertext/iv/tag, metadata` |
| `mcp_tools` | Cached tool definitions per server | `id, mcp_server_id, external_tool_id, name, description, input_schema, risk_level, approval_required_default, enabled, schema_hash, discovered_at` |
| `agent_mcp_servers` | Agent ↔ Connection attachment | `id, agent_id, user_mcp_connection_id, enabled` |
| `agent_mcp_tool_permissions` | Per-agent tool overrides | `id, agent_id, mcp_tool_id, enabled, approval_required, risk_level` |

> **Note:** The `DATABASE_SCHEMA.md` file has an older schema. The implementation uses the tables above (see `apps/api/lib/mcp/registry.ts`, `connections.ts`, `discovery.ts`, `tools-loader.ts`).

---

## 3. Marketplace Catalog (mcp_servers)

### 3.1 Provider Types

```typescript
// packages/shared/src/mcp.ts
export const MCPProviderSchema = z.enum(["composio", "zapier", "apify", "direct"]);
export type MCPProvider = "composio" | "zapier" | "apify" | "direct";
```

| Provider | Description | Auth Type | Endpoint |
|----------|-------------|-----------|----------|
| `direct` | Hand-seeded remote MCP servers (stdio/http/streamable_http) | `none`, `api_key`, `oauth2`, `pat` | Stored in `endpoint` column |
| `composio` | Composio toolkits materialized on first connect | `provider_managed` | **Null** — resolved per-session via Composio API |
| `zapier` / `apify` | Reserved for future providers | — | — |

### 3.2 Listing Lifecycle

```
Admin creates listing (POST /api/mcp/servers)
        │
        ▼
mcp_servers row created (enabled=true)
        │
        ▼
User browses catalog (GET /api/mcp/servers)
        │
        ▼
User clicks Connect (POST /api/mcp/connections)
        │
        ├── For direct: OAuth/API key flow → encrypted creds stored
        │
        └── For composio: ensureComposioListing(toolkit) →
            materialize composio-<toolkit> row →
            create session via Composio API →
            store endpoint in connection metadata
```

### 3.3 Key Columns for Composio Listings

When a Composio toolkit is materialized via `ensureComposioListing()`:

```typescript
// apps/api/lib/mcp/composio-catalog.ts:260-286
await supabaseAdmin().from("mcp_servers").upsert({
  slug: `composio-${normalized.replaceAll("_", "-")}`,  // e.g., "composio-gmail"
  name: info?.name ?? normalized,
  description: (info?.meta?.description ?? "").slice(0, 500),
  instructions: COMPOSIO_INSTRUCTIONS,  // static setup guidance
  provider: "composio",
  category: marketplaceCategory(info ?? {}),  // maps to: productivity, development, finance, research, other
  endpoint: null,                           // <-- NULL! Resolved at connect time
  transport: "streamable_http",
  auth_type: "provider_managed",
  config: { toolkits: [normalized] },       // <-- The toolkit slug(s) to enable
  capabilities: { tools: true },
  icon_url: info?.meta?.logo ?? null,
  is_verified: true,
  is_free_tier: true,
  enabled: true,
  created_by: null, // system-created listing
}, { onConflict: "slug" });
```

---

## 4. Composio Catalog Tab (Dynamic Source)

**This is NOT the same as the `mcp_servers` catalog.** It's a live, browsable view of Composio's 1,700+ toolkits fetched from their API.

### 4.1 Data Flow

```
GET /api/mcp/composio/catalog?q=&category=
        │
        ▼
composioCatalogConfigured() → checks COMPOSIO_API_KEY
        │
        ▼
fetchAllToolkits() → GET https://backend.composio.dev/api/v3.1/toolkits
        │           (paginated, cursor-based, cached 10 min, max 2500 items)
        │
        ▼
listComposioCatalog() merges in user's connection state:
        - connectedToolkitMap() reads mcp_servers where provider=composio
        - config.toolkits = ["gmail"] → maps slug to server row
        │
        ▼
Returns ComposioCatalogResult:
{
  items: ComposioCatalogItem[],      // 100 max (RESULT_CAP)
  total: number,                     // matches before cap
  categories: string[]               // top 12 categories for filter chips
}
```

### 4.2 ComposioCatalogItem Shape

```typescript
// apps/api/lib/mcp/composio-catalog.ts:129-144
export type ComposioCatalogItem = {
  toolkit: string;          // Composio slug ("gmail")
  name: string;             // Display name
  description: string;      // Truncated to 500 chars
  logo: string | null;      // Icon URL
  category: string | null;  // Composio's raw category id
  toolCount: number;        // meta.tools_count
  authSchemes: string[];    // composio_managed_auth_schemes || auth_schemes
  serverId: string | null;  // mcp_servers.id if materialized
  connected: boolean;       // User has active connection
  connectionId: string | null;
  connectionStatus: string | null;  // pending/connected/expired/error
};
```

### 4.3 Category Mapping

```typescript
// apps/api/lib/mcp/composio-catalog.ts:118-127
function marketplaceCategory(toolkit: ComposioToolkit): string {
  const ids = toolkitCategories(toolkit);
  if (ids.some((id) => ["email", "productivity", "scheduling & booking", "communication"].includes(id))) {
    return "productivity";
  }
  if (ids.some((id) => id.startsWith("developer"))) return "development";
  if (ids.some((id) => ["finance", "payments", "banking"].includes(id))) return "finance";
  if (ids.some((id) => ["search", "research", "data"].includes(id))) return "research";
  return "other";
}
```

---

## 5. Composio Connection Flow (Provider-Managed Auth)

### 5.1 Key Difference: No Stored Credentials

Unlike `direct` providers, **Composio connections do NOT store OAuth tokens or API keys**. Instead:

1. **Server-side** `COMPOSIO_API_KEY` (Platform key, `ak_...`) creates a per-user **MCP session**
2. The session returns an **MCP endpoint URL** + optional headers
3. The **endpoint URL** is stored in `connection.metadata.composio_session.endpoint` (validated via SSRF check)
4. **Headers from Composio** are encrypted in `connection.credentials_ciphertext`
4. The **Platform API key** is injected at request time from env — **never stored**

### 5.2 connectComposio() Step-by-Step

A session is **not** authorization (fix 2026-11-19): creating one only proves the
user id exists in Composio — no consent has been given. The connection reads
`connected` **only** when Composio reports an ACTIVE connected account for every
toolkit the listing enables.

```typescript
// apps/api/lib/mcp/providers/composio.ts
export async function connectComposio(input: {
  userId: string;
  server: ServerRow;              // The materialized composio-<toolkit> row
}): Promise<{
  connectionId: string;
  serverId: string;
  status: MCPConnectionStatus;    // connected | pending | expired | error
  toolCount?: number;
  authorizationUrl?: string;      // set when the user must sign in first
}>
```

| Step | Action |
|------|--------|
| 1 | Validate `COMPOSIO_API_KEY` exists and is a Platform key (`ak_...`), not Connect consumer key (`ck_...`) |
| 2 | Build `toolkits: { enable: [slug] }` from `server.config.toolkits` (`config.noAuth` listings skip the account gate) |
| 3 | Reuse the stored session, or POST `https://backend.composio.dev/api/v3.1/tool_router/session` with `{ user_id, toolkits }` — `user_id` is **always the caller's own app user id** (one Composio entity per user, no shared/env fallback) |
| 4 | SSRF-validate the returned `mcp.url` via `validateEndpoint()` |
| 5 | `GET /api/v3.1/connected_accounts?user_ids=<userId>&toolkit_slugs=<toolkits>` → per-toolkit account status (`ACTIVE`, `EXPIRED`, `FAILED`, `REVOKED`, …) |
| 6 | `planComposioConnect()` decides: every toolkit ACTIVE → `connected`; any FAILED/REVOKED/INACTIVE → `error`; any EXPIRED → `expired`; otherwise → `pending` |
| 7a | **connected path**: `listRemoteTools()` → `syncServerTools()` → upsert with `status: "connected"` (tools sync happens **only after** ACTIVE) |
| 7b | **pending path**: upsert with `status: "pending"`, then mint (or reuse) the hosted link via `POST /tool_router/session/{id}/link { toolkit, callback_url }` → return `authorizationUrl` |
| 8 | The app opens `authorizationUrl` in a browser, then polls `POST /api/mcp/connections/:id/verify` (every 2s, max 60s) until the status lands on `connected` |

`callback_url` points at `GET /api/mcp/composio/callback?connectionId=…&state=<32-hex>`;
the `state` nonce is stored in `metadata.composio_session.callbackStates[]` and is
the public callback's only trust anchor (compared timing-safely).

### 5.3 Session Metadata Structure

```typescript
// Stored in connection.metadata.composio_session
{
  endpoint: "https://backend.composio.dev/tool_router/...",  // SSRF-validated URL
  sessionId: "trs_abc123",                                   // Composio session id
  createdAt: "2026-11-19T12:00:00.000Z",
  toolCount: 42,                                             // Updated after sync
  verifiedAt: "2026-11-19T12:05:00.000Z",                    // Last account check
  lastError: null | "…redacted…",                            // Last sync failure
  links: {                                                   // Hosted auth links we minted
    gmail: {
      redirectUrl: "https://connect.composio.dev/link/…",
      connectedAccountId: "ca_…",                            // picked in the account check
      createdAt: "2026-11-19T12:01:00.000Z",
    },
  },
  callbackStates: ["<32-hex nonce>", …],                     // bounded to the last 20
}
```

### 5.4 Refresh / Reconnect / Verify

```typescript
// apps/api/lib/mcp/providers/composio.ts
export async function verifyComposio(input: {
  userId: string;
  connectionId: string;
  issueLink?: boolean;   // default true; polling passes false (side-effect free)
}): Promise<{
  status: MCPConnectionStatus;
  toolCount?: number;
  authorizationUrl?: string;   // set when consent is expired/failed (fresh link)
  message?: string;
}>

// refreshComposio() = verifyComposio({ issueLink: true }) + toolCount: number
```

- **Never trusts a session**: `connected` requires ACTIVE accounts **plus** a
  successful tool sync — a freshly created session alone changes nothing.
- `issueLink: false` (polling) → no link is minted and **nothing is written**
  while the status is unchanged (one Composio read per poll).
- `issueLink: true` (button taps, refresh, callback) → expired/failed consent
  gets a **fresh** hosted link; pending consent reuses the stored one.
- If the account is ACTIVE but Composio retired the stored session, the sync
  fails once and the adapter re-creates the session, then retries once.
- A `disconnected` row is returned as-is and never resurrected.
- All three entry points end in the same function: `POST /connections/:id/verify`,
  `POST /connections/:id/refresh`, and the public `GET /composio/callback`.

---

## 6. Tool Discovery & Caching (syncServerTools)

### 6.1 Discovery Flow

```typescript
// apps/api/lib/mcp/discovery.ts:126-174
export async function listRemoteTools(input: DiscoverInput): Promise<DiscoveredTool[]>
```

| Step | Action |
|------|--------|
| 1 | SSRF-validate endpoint via `validateEndpoint()` |
| 2 | Create MCP client via `@ai-sdk/mcp` with `redirect: "error"` (prevents SSRF bypass) |
| 3 | Paginated `client.listTools()` (max 5 pages, 100 tools total) |
| 4 | Normalize each tool: sanitize name, cap description, validate schema size (max 8KB) |
| 5 | Classify risk via `classifyToolRisk()` (annotations + description heuristics) |
| 6 | Return `DiscoveredTool[]` with `schemaHash` for change detection |

### 6.2 Sync to Database

```typescript
// apps/api/lib/mcp/discovery.ts:182-241
export async function syncServerTools(
  serverId: string,
  tools: DiscoveredTool[]
): Promise<{ added: number; updated: number; removed: number }>
```

| Action | SQL |
|--------|-----|
| Upsert new/changed tools | `INSERT ... ON CONFLICT (mcp_server_id, external_tool_id) DO UPDATE` |
| Disable stale tools | `UPDATE mcp_tools SET enabled=false WHERE ... NOT IN (discoveredIds)` |
| **Never delete** | Permission rows reference `mcp_tool_id` |

### 6.3 DiscoveredTool Shape

```typescript
// apps/api/lib/mcp/discovery.ts:28-36
export type DiscoveredTool = {
  externalToolId: string;      // Cleaned server-provided name
  name: string;                // Same as externalToolId (for display)
  description: string;         // Sanitized, capped
  inputSchema: Record<string, unknown>;  // Validated JSON Schema, max 8KB
  riskLevel: "low" | "medium" | "high";
  approvalRequiredDefault: boolean;
  schemaHash: string;          // SHA256 of canonicalized schema (32 hex chars)
};
```

---

## 7. Runtime Tool Loading (loadAgentMcpTools)

At **run start**, the agent's MCP tools are loaded:

```typescript
// apps/api/lib/mcp/tools-loader.ts:84-263
export async function loadAgentMcpTools(
  userId: string,
  agentId: string | null
): Promise<McpToolRuntime>
```

### 7.1 Loading Pipeline

```
1. agent_mcp_servers → enabled attachments for this agent
        │
        ▼
2. user_mcp_connections → filter by connectionIds, status=connected
        │
        ▼
3. mcp_servers → filter by serverIds, enabled=true
        │
        ▼
4. mcp_tools → filter by serverIds, enabled=true
        │
        ▼
5. agent_mcp_tool_permissions → per-agent overrides (enabled, approval_required, risk_level)
        │
        ▼
6. Assemble LoadedMcpTool[] with namespaced names:
   mcp_<serverSlug>_<toolName>  (e.g., mcp_composio_gmail_send_email)
        │
        ▼
7. Sort: approvalRequired=false first, then deterministic by slug:name
        │
        ▼
8. Cap at MAX_MCP_TOOLS_PER_RUN (20), preferring read-only tools
        │
        ▼
9. Build AI SDK tool declarations + execution handlers
```

### 7.2 Namespacing

```typescript
// apps/api/lib/mcp/tools-loader.ts:56-71
export function namespacedToolName(serverSlug: string, externalToolId: string): string {
  const slug = sanitizeFragment(serverSlug) || "server";
  const toolPart = sanitizeFragment(externalToolId) || "tool";
  const base = `mcp_${slug}_${toolPart}`.slice(0, 60);
  return /^[a-zA-Z_]/.test(base) ? base : `mcp_${base}`.slice(0, 60);
}
```

- Prevents remote tools from shadowing built-ins (`web_search`, `write_note`, etc.)
- Gemini-compatible: `^[a-zA-Z0-9_-]+$`, starts with letter/underscore

### 7.3 Execution Dispatch

```typescript
// apps/api/lib/mcp/tools-loader.ts:242-259
execute: async (name, args) => {
  const entry = tools.get(name);
  if (entry.provider === "composio") {
    return executeComposioTool({ userId, connectionId: entry.connectionId, externalToolId: entry.externalToolId, args });
  }
  return executeDirectTool({ userId, connectionId: entry.connectionId, externalToolId: entry.externalToolId, args });
}
```

| Provider | Execution Function |
|----------|-------------------|
| `composio` | `executeComposioTool()` → calls user's session endpoint with `x-api-key` from env |
| `direct` | `executeDirectTool()` → uses stored credentials (api_key/oauth2/pat) |

---

## 8. API Routes Summary

| Route | Method | Purpose |
|-------|--------|---------|
| `/api/mcp/servers` | GET | List catalog with `connected` flag |
| `/api/mcp/servers` | POST | Admin create listing |
| `/api/mcp/servers/:id` | GET/PUT/DELETE | Admin manage listing |
| `/api/mcp/composio/catalog` | GET | **Dynamic** Composio toolkit browser (per-user `connected` / `connectionStatus`) |
| `/api/mcp/connections` | POST | Connect: `{ serverId }` or `{ toolkit: "gmail" }` → `{ status, authorizationUrl? }` (pending until authorized) |
| `/api/mcp/connections/:id` | DELETE | Disconnect |
| `/api/mcp/connections/:id/verify` | POST | Re-check with the provider (Composio account check); body `{ issueLink?: boolean }`, returns `{ status, authorizationUrl?, message? }` |
| `/api/mcp/connections/:id/refresh` | POST | Re-verify + re-sync tools (Composio returns `status` + `authorizationUrl` when consent expired) |
| `/api/mcp/connections/:id/tools` | GET | Live tool list from remote |
| `/api/mcp/agents/:agentId/servers` | PUT | Attach connection to agent |
| `/api/mcp/agents/:agentId/tools` | PUT | Per-tool permissions for agent |
| `/api/mcp/oauth/callback` | GET | OAuth completion (direct providers only) |
| `/api/mcp/composio/callback` | GET | Public hosted-consent redirect (signed `state` anchor) → deep-links back to the app |

---

## 9. Adding a New Composio Integration (For Admins)

### 9.1 Zero-Code: User Self-Serve

Users **do not need admin action** to add a Composio integration:

1. User opens **Composio Catalog tab** in the app
2. Searches/browses for a toolkit (e.g., "Notion", "Linear", "HubSpot")
3. Taps **Connect**
4. System calls `ensureComposioListing("notion")` → creates `composio-notion` in `mcp_servers`
5. Creates/ reuses the Composio session → checks for an ACTIVE account → opens the hosted sign-in link (`status: "pending"`)
6. User finishes sign-in; `verify` flips the row to `connected` and syncs tools
7. User attaches to agent → done

### 9.2 Admin: Pre-Seed a Composio Listing

If you want a Composio toolkit visible in the **main catalog tab** (not just Composio tab):

```bash
# Via API (admin only)
POST /api/mcp/servers
{
  "slug": "composio-linear",
  "name": "Linear (Composio)",
  "description": "Issue tracking, projects, and roadmaps via Composio",
  "instructions": "1. Tap Connect — Composio opens Linear's consent screen.\n2. Your agent gets Composio's helper tools...\n3. Tools that change data ask for approval the first time.",
  "provider": "composio",
  "category": "development",
  "endpoint": null,
  "transport": "streamable_http",
  "authType": "provider_managed",
  "config": { "toolkits": ["linear"] },
  "capabilities": { "tools": true },
  "iconUrl": "https://composio.dev/logos/linear.png",
  "isVerified": true,
  "isFreeTier": true,
  "enabled": true
}
```

### 9.3 Admin: Add a Direct Remote MCP Server

```bash
POST /api/mcp/servers
{
  "slug": "github-mcp",
  "name": "GitHub MCP",
  "description": "Official GitHub MCP server for repos, issues, PRs",
  "instructions": "1. Create a GitHub Personal Access Token with repo scope.\n2. Tap Connect and paste the token.",
  "provider": "direct",
  "category": "development",
  "endpoint": "https://api.githubcopilot.com/mcp/",
  "transport": "streamable_http",
  "authType": "pat",
  "config": { "headerName": "Authorization", "prefix": "Bearer " },
  "capabilities": { "tools": true },
  "iconUrl": "https://github.githubassets.com/favicon.ico",
  "isVerified": true,
  "isFreeTier": true,
  "enabled": true
}
```

---

## 10. Key Implementation Files

| File | Responsibility |
|------|----------------|
| `apps/api/lib/mcp/registry.ts` | Catalog CRUD (`mcp_servers`), `listCatalog()` with connection merge |
| `apps/api/lib/mcp/composio-catalog.ts` | Dynamic Composio toolkit browser, `ensureComposioListing()` |
| `apps/api/lib/mcp/providers/composio.ts` | Session + hosted auth-link lifecycle, account verification (`planComposioConnect`), tool execution |
| `apps/api/app/api/mcp/connections/[id]/verify/route.ts` | Re-check with the provider (status polling + button taps) |
| `apps/api/app/api/mcp/composio/callback/route.ts` | Public hosted-consent redirect (signed `state` → deep link) |
| `apps/api/lib/mcp/__tests__/composio-connect.test.ts` | connect/verify decision + verify-route tests (fetch-mocked) |
| `apps/api/lib/mcp/discovery.ts` | `listRemoteTools()`, `syncServerTools()`, `discoverServerTools()` |
| `apps/api/lib/mcp/connections.ts` | Encrypted credential storage, connection lifecycle |
| `apps/api/lib/mcp/tools-loader.ts` | Runtime tool loading, namespacing, execution dispatch |
| `apps/api/lib/mcp/security/validate-endpoint.ts` | SSRF protection for all outbound MCP calls |
| `apps/api/lib/mcp/risk.ts` | Tool risk classification (annotations + description heuristics) |
| `packages/shared/src/mcp.ts` | Shared Zod schemas & types (API contract) |

---

## 11. Security Considerations

| Layer | Protection |
|-------|------------|
| **SSRF** | `validateEndpoint()` blocks private IPs, localhost, metadata endpoints; `redirect: "error"` on MCP client |
| **Secrets** | Credentials encrypted via AES-256-GCM (`apps/api/lib/mcp/encryption.ts`); Platform API key **never stored**, injected from env at request time |
| **Composio entity** | The `user_id` sent to Composio is always the caller's own app user id — no shared/env fallback id, so two users can never share one entity |
| **Consent anchor** | The hosted-consent callback is public but must carry the per-connection `state` nonce minted at link time (`callbackStates[]`, timing-safe compare) |
| **Untrusted Input** | Tool descriptions sanitized, schemas size-capped (8KB), risk re-classified server-side |
| **Approval** | High-risk tools default `approval_required=true`; can be overridden per-agent but **never disabled for `riskLevel=high`** |
| **RLS** | All tables have `user_id = auth.uid()` policies; server uses service role + explicit `user_id` filters |

---

## 12. Free-Tier Constraints (Verified 2026-11-19)

| Resource | Limit |
|----------|-------|
| Composio Hobby Plan | 100,000 tool calls/month, 2,000 req/min |
| Supabase Free | 500 MB database, 2 GB bandwidth |
| Vercel Hobby | 100 GB-hours serverless, 100 GB bandwidth |
| Inngest Free | 1M function invocations/month |

**Design decisions driven by these limits:**
- Tool cache capped at 100 tools/server
- 20 tools max per agent run
- Tool output truncated at 8KB before storage
- 10-minute cache on Composio catalog fetch
- `run_events` and `provider_usage` pruned after 30 days

---

## 13. Troubleshooting Common Issues

| Symptom | Likely Cause | Fix |
|---------|--------------|-----|
| `COMPOSIO_API_KEY is a Composio Connect consumer key` | Env has `ck_...` key | Replace with Platform API key (`ak_...`) from Composio Dashboard → Settings → Project Settings → API Keys |
| `Composio did not return an MCP session endpoint` | API changed response shape | Check `ComposioSessionResponse` parsing in `connectComposio()` for new wrapper |
| `Endpoint rejected: ...` on connect | SSRF validation failed | Ensure Composio returns a public HTTPS URL; check `validateEndpoint()` allowlist |
| Tools not appearing after connect | `syncServerTools` failed | Check logs for `listRemoteTools` errors; verify session endpoint is reachable |
| `Unknown MCP tool` at execution | Tool not in loaded runtime | Verify agent has attachment, connection is `connected`, tool is `enabled` in cache |
| Row stuck on **Finish connecting** | Consent never completed, or the hosted link expired unused (~10 min) | Tap **Finish connecting** again — verify mints a fresh link; check `connected_accounts` status in Composio |
| Row shows **Reconnect** after working | Composio returned `EXPIRED` / `REVOKED` for the account | Tap **Reconnect** → fresh `authorizationUrl`; completing sign-in restores `connected` |
| Everything `pending` after migration `0013` | Rows were reset from false `connected` → `pending` | Expected: `POST /connections/:id/verify` flips to `connected` **only** when an ACTIVE account exists |

---

## 14. Extending to New Providers (Zapier, Apify, etc.)

The provider interface is defined in `packages/shared/src/mcp.ts`:

```typescript
export interface MCPProviderAdapter {
  connect(input: { userId, serverId, credentials? }): Promise<{ connectionId, authorizationUrl? }>;
  discoverTools(connectionId): Promise<MCPToolDefinition[]>;
  loadTools(input: { connectionId, enabledToolIds }): Promise<Record<string, unknown>>;
  executeTool(input: { connectionId, toolName, arguments }): Promise<unknown>;
  disconnect(connectionId): Promise<void>;
}
```

To add a provider:
1. Add to `MCPProviderSchema` enum in shared types
2. Create `apps/api/lib/mcp/providers/<provider>.ts` implementing the adapter
3. Register in `apps/api/lib/mcp/providers/index.ts`
4. Update `tools-loader.ts` execution dispatch
5. Add catalog seeding script or admin UI

---

*Generated from implementation as of 2026-11-19. Update this document when the code changes.*
