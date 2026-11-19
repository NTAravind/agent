# Phase 6: Remote MCP Marketplace

**Estimated effort:** 4--6 days\
**Scope:** Hosted/remote MCP integrations only; free-first; multi-user
and multi-agent support.

## Goal

Build a user-controlled MCP marketplace inside the AI agent. Users can
browse available integrations, connect their accounts, select individual
tools, attach integrations to agents, and use those tools during the
next agent run.

**Non-goals for this phase** - Do not build or self-host MCP servers. -
Do not treat a GitHub repository as an executable MCP endpoint. - Do not
build a generic OAuth authorization server. - Do not implement paid
marketplace billing. - Do not expose credentials to the Expo/mobile
client.

## Architecture decisions

1.  **Provider-independent marketplace:** Keep the catalog,
    installations, permissions, and runtime interfaces under our
    control. Providers are adapters, not the source of truth.
2.  **Primary provider:** Start with Composio, subject to confirming
    current free-plan limits and supported AI SDK integration.
3.  **Direct remote MCP:** Support verified vendor-hosted remote MCP
    endpoints using MCP Streamable HTTP.
4.  **Optional providers:** Add Zapier MCP or Apify only after verifying
    their current free allowances, authentication requirements, and
    remote MCP compatibility.
5.  **Separate catalog from user credentials:** A marketplace listing is
    shared; each user's OAuth tokens/API keys are private to that user's
    connection.
6.  **Many-to-many agent access:** An agent can use multiple MCP
    connections, and a connection can be attached to multiple agents.
7.  **Cache tool schemas:** Discover tools on connection and refresh
    them periodically or when explicitly requested. Do not rediscover
    every tool on every agent run.
8.  **Approval by policy:** Use per-agent, per-tool permissions. Require
    approval for write/destructive/high-impact actions by default.

## 6.1 Registry and catalog

Create a shared catalog of verified remote integrations.

### Database: `mcp_servers`

Suggested columns:

  -----------------------------------------------------------------------
  Column                  Type                    Purpose
  ----------------------- ----------------------- -----------------------
  `id`                    UUID                    Primary key

  `slug`                  text                    Stable unique
                                                  identifier

  `name`                  text                    Display name

  `description`           text                    Marketplace description

  `provider`              text                    `composio`, `zapier`,
                                                  `apify`, `direct`

  `category`              text                    Productivity,
                                                  development, research,
                                                  etc.

  `endpoint`              text, nullable          Remote MCP endpoint,
                                                  where applicable

  `transport`             text                    Initially
                                                  `streamable_http`

  `auth_type`             text                    `none`, `api_key`,
                                                  `oauth2`, `pat`, or
                                                  provider-managed

  `capabilities`          jsonb                   Supported MCP
                                                  capabilities

  `config`                jsonb                   Non-secret provider and
                                                  connection metadata

  `is_verified`           boolean                 Admin-reviewed listing

  `is_free_tier`          boolean                 Indicates a verified
                                                  free option, not
                                                  guaranteed unlimited
                                                  usage

  `enabled`               boolean                 Marketplace visibility

  `created_by`            UUID, nullable          Admin creator

  `created_at`            timestamptz             Creation time

  `updated_at`            timestamptz             Last update
  -----------------------------------------------------------------------

### Registry requirements

-   Seed 5--10 verified, vendor-hosted integrations.
-   Include only integrations that can be used without deploying the MCP
    server ourselves.
-   Store GitHub repository links as catalog/source metadata only. A
    repository is not an executable MCP server.
-   Admin-only create, update, disable, and delete operations.
-   Provide search and filters for category, provider, authentication
    type, free-tier availability, and connection status.
-   Clearly distinguish provider subscription costs, API usage charges,
    and MCP platform charges.
-   Re-verify endpoint ownership, authentication, and free-tier claims
    before publishing a listing.

## 6.2 User connection flows

Create a separate table for each user's connection to a catalog
integration.

### Database: `user_mcp_connections`

Suggested columns:

  --------------------------------------------------------------------------
  Column                     Type                    Purpose
  -------------------------- ----------------------- -----------------------
  `id`                       UUID                    Primary key

  `user_id`                  UUID                    Owner

  `mcp_server_id`            UUID                    Catalog integration

  `provider_connection_id`   text, nullable          External provider
                                                     connection ID

  `status`                   text                    `pending`, `connected`,
                                                     `expired`, `error`,
                                                     `disconnected`

  `auth_type`                text                    Actual connection
                                                     method

  `credentials_ciphertext`   text, nullable          Encrypted user
                                                     credentials if stored
                                                     locally

  `credentials_iv`           text, nullable          Encryption IV/nonce

  `credentials_tag`          text, nullable          Authentication tag, if
                                                     stored separately

  `key_version`              text, nullable          Encryption key version

  `metadata`                 jsonb                   Non-secret connection
                                                     metadata

  `last_checked_at`          timestamptz, nullable   Last health check

  `created_at`               timestamptz             Creation time

  `updated_at`               timestamptz             Last update
  --------------------------------------------------------------------------

Add a unique constraint appropriate to the product's account model, such
as `(user_id, mcp_server_id, external_account_id)`, so a user can
connect more than one account where supported.

### Supported connection methods

#### No authentication

-   Connect to a verified public remote MCP endpoint.
-   Perform the MCP initialization handshake.
-   Do not assume a GET request returning JSON proves that an endpoint
    is MCP-compatible.

#### API key

-   Collect the key securely.
-   Encrypt it server-side.
-   Never return it to the client after saving.
-   Send it only to the verified provider/endpoint for which it was
    configured.

#### OAuth 2.0 / OIDC

-   Prefer provider-managed OAuth when available.
-   For direct MCP authorization, implement the applicable MCP
    authorization specification.
-   Validate `state`; use PKCE where applicable.
-   Store access and refresh tokens securely.
-   Support token refresh, revocation, expiry, and reconnect flows.
-   Do not assume every provider uses identical OAuth endpoints or
    scopes.

#### Personal access token

-   Support only for providers that explicitly document PAT
    authentication.
-   Store the token as a user credential, not in the shared catalog.
-   Never assume a GitHub repository PAT makes that repository an MCP
    server.

### Provider-managed authentication

Where Composio or another managed provider owns the OAuth flow, store
its connection/account identifier and relevant non-secret metadata. Do
not copy provider-managed secrets into our database unless required and
supported.

## 6.3 Credential encryption and security

Do not use `pgedk.encrypt()` or `pgedk.decrypt()`; these are not
standard Supabase pgcrypto functions.

Choose one approach:

-   **Application-layer encryption (recommended for user-specific
    credentials):** AES-256-GCM in the API layer, with a key held
    outside the database in a server-side secret manager/environment.
-   **Supabase Vault:** Use for secrets that are intentionally managed
    centrally through Vault and whose access model fits the application.

For application-layer encryption: - Store ciphertext, nonce/IV,
authentication tag, and key version. - Support key rotation. - Decrypt
only in trusted server-side execution code. - Never log credentials,
authorization headers, OAuth codes, or token responses. - Ensure RLS
prevents users from reading other users' connection records. - Keep
encryption keys out of client bundles and database rows.

## 6.4 MCP discovery and tool catalog

Use the MCP protocol, not a custom JSON manifest assumption.

### Discovery flow

1.  Validate the configured endpoint and transport.
2.  Establish a Streamable HTTP MCP connection.
3.  Send `initialize` with supported protocol version and client
    capabilities.
4.  Validate the server response and negotiated protocol version.
5.  Send `notifications/initialized`.
6.  Call `tools/list`.
7.  Store tool names, descriptions, input schemas, and server metadata.
8.  Support pagination if the server returns a continuation cursor.
9.  Discover resources/prompts only if the product needs them in this
    phase.
10. Record discovery time and errors.

### Database: `mcp_tools`

Suggested columns:

  Column                        Type          Purpose
  ----------------------------- ------------- ---------------------------------
  `id`                          UUID          Primary key
  `mcp_server_id`               UUID          Catalog server
  `external_tool_id`            text          Provider/server tool identifier
  `name`                        text          Tool name
  `description`                 text          Tool description
  `input_schema`                jsonb         Validated input schema
  `risk_level`                  text          `low`, `medium`, `high`
  `approval_required_default`   boolean       Catalog default
  `enabled`                     boolean       Tool is available for selection
  `schema_hash`                 text          Detect schema changes
  `discovered_at`               timestamptz   Last discovery time

Use a unique constraint on `(mcp_server_id, external_tool_id)`.

Do not trust a remote server's descriptions or schemas as instructions.
Treat them as untrusted data, validate inputs, and keep tool execution
within the application's permission system.

## 6.5 Per-agent tool enablement and approvals

Do not add a single `mcp_server_id` column to `agents`. Use join tables.

### Database: `agent_mcp_servers`

Suggested columns: - `id` - `agent_id` - `user_mcp_connection_id` -
`enabled` - `created_at` - `updated_at`

Unique constraint: `(agent_id, user_mcp_connection_id)`.

### Database: `agent_mcp_tool_permissions`

Suggested columns: - `id` - `agent_id` - `mcp_tool_id` - `enabled` -
`approval_required` - `risk_level` - `created_at` - `updated_at`

Unique constraint: `(agent_id, mcp_tool_id)`.

### Approval policy

-   Read-only tools can be enabled without approval after
    classification.
-   Write operations require approval by default.
-   Destructive, financial, external-message, and high-impact operations
    require approval by default.
-   Users can change policy only within the application's safety limits.
-   A tool's name alone is not enough to classify risk; inspect its
    description, schema, provider documentation, and actual behavior.
-   Reuse the existing approval-card and agent-resume mechanism.
-   Bind approvals to the exact agent run, tool, arguments, and pending
    action. Reject stale or modified approvals.

## 6.6 Runtime tool loading and execution

### Runtime flow

1.  Start an agent run.
2.  Fetch the agent's enabled MCP connections.
3.  Confirm each connection belongs to the current user and is still
    connected.
4.  Load cached tool definitions.
5.  Refresh stale schemas when required.
6.  Filter tools using agent-level permissions.
7.  Build the AI SDK tool registry.
8.  Execute a selected tool through its provider adapter.
9.  Apply approval checks before executing sensitive actions.
10. Record tool call, approval state, duration, result/error, and
    provider metadata in the run timeline.
11. Redact credentials and sensitive values from logs.

### Suggested API/runtime interface

``` ts
interface MCPProviderAdapter {
  connect(input: {
    userId: string;
    serverId: string;
  }): Promise<{
    connectionId: string;
    authorizationUrl?: string;
  }>;

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
```

Implement adapters for: - `composio` - `direct-remote-mcp` - Optional
later: `zapier` - Optional later: `apify`

Use the provider's official SDK/adapter where available. For direct
remote MCP, use the official MCP TypeScript SDK and the AI SDK MCP
integration where compatible.

### Caching and synchronization

-   Discover tools at connection time and on manual refresh.
-   Cache tool schemas in `mcp_tools`.
-   Refresh on a scheduled sync or when a schema is known to be stale.
-   Do not fetch every manifest on every agent run.
-   Handle removed/changed tools safely; disable stale permissions if a
    tool disappears or its schema changes materially.
-   Keep provider connection health separate from tool schema freshness.

### Network security

Remote MCP endpoints are untrusted network destinations.

-   Require HTTPS for remote endpoints.
-   Validate hostnames and resolved IP addresses.
-   Block loopback, private, link-local, metadata-service, and other
    restricted IP ranges.
-   Defend against DNS rebinding and redirects to restricted
    destinations.
-   Revalidate destinations on connection and request.
-   Apply request timeouts, response-size limits, rate limits, and
    concurrency limits.
-   Do not forward credentials across redirects or to unverified hosts.
-   Prefer a server-side endpoint allowlist for marketplace catalog
    entries.
-   Do not allow arbitrary user-supplied URLs to be fetched without
    strict validation.

## 6.7 API routes

Suggested Next.js API structure:

``` text
apps/api/app/api/mcp/
├── servers/
│   ├── route.ts                    # GET catalog
│   └── [id]/
│       ├── route.ts                # GET details / PUT update / DELETE
│       └── tools/
│           └── route.ts            # GET cached tools / POST discover
├── connections/
│   ├── route.ts                    # GET user's connections
│   ├── [id]/
│   │   ├── route.ts                # GET / DELETE connection
│   │   ├── connect/
│   │   │   └── route.ts            # Start connection
│   │   └── refresh/
│   │       └── route.ts            # Refresh credentials/health
│   └── oauth/
│       └── callback/
│           └── route.ts            # OAuth callback
└── agents/
    └── [agentId]/
        └── servers/
            ├── route.ts            # GET / POST attachments
            └── [connectionId]/
                └── route.ts       # PUT / DELETE attachment
```

All routes must authenticate the user and enforce ownership. Admin
catalog mutation must check the configured admin identity server-side.
Never rely on a client-supplied user ID or `created_by` value for
authorization.

## 6.8 Mobile UI and workflow

### Marketplace

-   Home → Settings → Integrations / MCP marketplace.
-   Search and filter integrations.
-   Show provider, category, supported auth, free-tier caveats, and
    available capabilities.
-   Integration detail screen lists tools and required permissions.

### Connect flow

-   User selects an integration.
-   User clicks Connect.
-   Complete no-auth, API-key, PAT, or OAuth flow.
-   Show connection success/failure.
-   Redirect to integration details.

### Agent configuration

-   Agents → select agent → Edit → Integrations.
-   Attach one or more connected integrations.
-   Enable/disable individual tools.
-   Configure approval requirements.
-   Save changes and use the updated configuration on the next run.

### Runtime timeline

-   Show tool name, provider, status, duration, and concise result.
-   Show approval cards for pending actions.
-   Never show credentials, authorization headers, or sensitive tool
    arguments.

## 6.9 Background jobs

Use Inngest for: - `mcp-server-sync`: refresh catalog metadata and
cached tool schemas on a schedule. - `mcp-connection-health-check`:
check connection state where supported. - `mcp-token-refresh`: refresh
expiring credentials where the provider supports it. -
`mcp-tool-approval-decided`: resume or reject a paused agent action
using the existing approval workflow.

Do not run token refresh or tool discovery in a way that exposes
credentials in job payloads. Pass secure record identifiers and retrieve
secrets server-side.

## 6.10 Phase 6 artifacts

``` text
packages/shared/src/mcp.ts
  Shared types, provider interfaces, tool definitions and connection states.

db/migrations/0008_mcp_marketplace.sql
  mcp_servers
  user_mcp_connections
  mcp_tools
  agent_mcp_servers
  agent_mcp_tool_permissions
  RLS policies and indexes

apps/api/lib/mcp/
  registry.ts
  providers/
    composio.ts
    direct-remote.ts
  discovery.ts
  encryption.ts
  connections.ts
  tools-loader.ts
  approvals.ts
  security/
    validate-endpoint.ts
    redact-secrets.ts

apps/api/lib/inngest/functions.ts
  MCP sync, health checks, token refresh and approval resume.

apps/api/app/api/mcp/
  Catalog, connection, OAuth, discovery and agent attachment routes.

apps/mobile/src/app/mcp.tsx
  Marketplace and connected integrations screen.

apps/mobile/src/lib/mcp.ts
  Client API for catalog, connection and agent configuration.
```

## 6.11 Implementation order

  -----------------------------------------------------------------------
  Day                                 Work
  ----------------------------------- -----------------------------------
  1                                   Schema, RLS, catalog API, seed
                                      initial verified integrations

  2                                   Composio connection adapter and
                                      credential security

  3                                   Direct remote MCP handshake,
                                      discovery, schema cache

  4                                   Agent attachments, tool
                                      permissions, AI SDK runtime loading

  5                                   Approval/resume integration, Expo
                                      marketplace and details UI

  6                                   Agent configuration UI, timeline,
                                      security tests and end-to-end
                                      verification
  -----------------------------------------------------------------------

If the existing approval flow or OAuth provider needs significant
changes, treat the 4--6 day estimate as a target rather than a
guarantee.

## 6.12 Acceptance criteria --- Done when

-   [ ] Admin can seed and manage verified remote integrations.
-   [ ] User can find an integration through marketplace search and
    filters.
-   [ ] User can connect an integration without deploying its server.
-   [ ] No-auth, API-key, and supported OAuth/PAT flows work.
-   [ ] Credentials are encrypted or securely provider-managed.
-   [ ] User can attach multiple integrations to an agent.
-   [ ] User can enable/disable individual tools per agent.
-   [ ] Tool definitions are discovered and cached.
-   [ ] Agent receives only enabled tools for its current user and
    agent.
-   [ ] Agent can execute an MCP tool on its next run.
-   [ ] Tool results appear in the run timeline.
-   [ ] Approval-required tools pause and resume correctly.
-   [ ] Cross-user access, credential leakage, SSRF, timeout, and
    malformed-schema tests pass.
-   [ ] Disconnecting an integration prevents future tool execution and
    revokes credentials where supported.

**Definition of done:** A user can add a verified hosted integration in
three taps or fewer (excluding external OAuth consent), attach it to an
agent, and successfully use one of its tools in the next run.

## Addendum: Composio as a marketplace source (2026-11-19)

The marketplace has **two tabs**, both fed by `GET /api/mcp/servers`
(`?provider=` selects the source):

-   **Built-in** — `provider=direct`: the admin-seeded, vendor-hosted MCP
    listings (unchanged from §6.8).
-   **Composio** — `GET /api/mcp/composio/catalog`: Composio's live toolkit
    catalog (1,700+ apps) proxied server-side from `GET /api/v3.1/toolkits`
    (10-minute in-process cache, ≤100 rows returned, `?q=`/`?category=`
    filters, top-12 category chips). Composio is a *source*, not a listing:
    rows are **not** `mcp_servers` rows until the user connects.

**Materialize on connect:** `POST /api/mcp/connections` accepts
`{ toolkit }` instead of `{ serverId }`. The API upserts an idempotent
`composio-<toolkit>` listing (provider `composio`, `config.toolkits =
[<toolkit>]`, instructions, Composio logo/description) and connects it
through the normal adapter — one Composio tool-router session per listing,
exposing the 6 Composio meta-tools. After that, the existing detail /
tool-cache / attach / approval flow (§6.6) applies unchanged.

Connected-state mapping: a catalog row is *connected* when any connected
`provider=composio` listing has that toolkit in `config.toolkits` (the
original umbrella listing enables its whole toolkit set at once).

Risk: `COMPOSIO_MULTI_EXECUTE_TOOL` reports `destructiveHint: true` in its
MCP annotations → high risk + approval-required (verified against a live
`tools/list`, 2026-11-19); the read-only meta-tools classify as documented
in §5.5 / API_SPEC 5.

## Explicitly deferred

-   Installing MCP servers from arbitrary GitHub repositories.
-   Building or hosting MCP server processes.
-   Arbitrary unverified remote URLs.
-   Marketplace payments and paid integration billing.
-   Public user-submitted marketplace listings.
-   Advanced resource and prompt browsing.
-   Automatic discovery of every MCP server on the internet.

## Key documentation

-   [Model Context Protocol
    specification](https://modelcontextprotocol.io/specification/latest)
-   [MCP TypeScript
    SDK](https://github.com/modelcontextprotocol/typescript-sdk)
-   [Vercel AI SDK MCP
    tools](https://ai-sdk.dev/docs/ai-sdk-core/mcp-tools)
-   [Composio documentation](https://docs.composio.dev/)
-   [Supabase Vault](https://supabase.com/docs/guides/database/vault)
-   [Supabase Row Level
    Security](https://supabase.com/docs/guides/database/postgres/row-level-security)
