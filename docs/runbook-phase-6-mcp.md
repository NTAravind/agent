# Phase 6: MCP store (4–6 days)
- [ ] Seed registry (hand-pick 5–10 remote servers)
- [ ] Connect flows (none / API key / OAuth), encrypted credentials
- [ ] Per-agent tool enablement, approval flags, runtime tool loading
**Done when:** add a server in ≤ 3 taps and use its tool in the next run.

## 6.1: MCP server registry
- The MCP registry is stored in Supabase (`mcp_servers` table).
- Schema: `id`, `name`, `description`, `capabilities`, `config`, `encrypted_credentials`, `enabled`, `created_by`, `created_at`, `updated_at`.
- Only admins (users with ALLOWED_USER_ID) can manage MCP servers.
- Allowed server origins: GitHub `user/p` / `org/repo` → stored with `type: github`; remote URLs → `type: http` (HTTPS).

## 6.2: Connection flows
- **None / direct**: Insert a server with `config: { type: "none" }`. The UI offers a button "Add server directly” — user enters a URL; a GET request checks it’s a valid JSON MCP server (returns a minimal handshake response).
- **API key**: Server config includes `auth: { type: "header", key: "X-API-Key", value: ... }`. Encrypted with Supabase encryption.
- **OAuth 2.0 / OIDC**: Server config includes `auth: { type: "oauth2", clientId, clientSecret, authorizeUrl, tokenUrl, scope, redirectUrl }`. Encrypt `clientSecret` and token state; secrets stored as JSON.
- **PAT (Personal Access Token)**: For GitHub repos, store as `token: "ghp_..."`. Use it to pull the latest MCP manifest from `<https://api.github.com/repos/owner/repo/contents/mcp.json>`.

## 6.3: Encrypted credentials
- Supabase has `pgcrypto` — use `pgedk.encrypt()` with a secret key from the provider layer.
- On reading, decrypt with `pgedk.decrypt()`.

## 6.4: Per-agent tool enablement + approval
- Add `mcp_server_id` to the `agents` table: each agent can call tools from a specific MCP server.
- Tool approval: the same approval flow used for `write_note` applies: if a tool is in the `approval_required` set (extends `SENSITIVE_TOOLS` to include MCP tools that need approval), hitting it in the act node will interrupt → approval card.

## 6.5: Runtime loading
- On agent start (or agent enable change), call `mcp.load(mcp_server_id)` → fetch the server manifest from its URL (with auth) → parse MCP manifest (tools, resources, prompts). Tools are added to the agent’s tool declarations (non-sensitive, sensitive detection via `approval_required`).

## 6.6: UI + workflow
- **Add MCP server**: Home → Settings → MCP servers → "Add server” → choose type → fill config → save. Redirect to server details page.
- **Server detail**: View name, URL, capabilities, toggle `enabled`. “Load tools” button fetches manifest.
- **Add to agent**: Agents → select agent → "Edit” → “MCP servers” tab → enable a server → save. The agent’s graph recompiles (context changes do not checkpoint, but tool discovery happens at runtime).
- **Use MCP tool**: During a run, the agent’s `act_llm` calls may include a tool from the MCP server (non-sensitive or approval-gated). If `write_note`-like, same approval flow.

### Done-when
- In the MCP store UI, add a GitHub repo as an MCP server.
- Edit an agent, attach that server.
- Start an agent run that calls a tool from that server.
- Verify the tool result appears in the run timeline.
- Verify approval works for any tool listed in `approval_required` (including MCP tools).

**Phase 6 artifacts:**
- `packages/shared/src/mcp.ts` – shared types, `EncryptedCredentials` helper.
- `db/migrations/0008_mcp_servers.sql` – `mcp_servers` table.
- `apps/api/lib/mcp/` – discovery (fetch, auth), encryption (Supabase pgcrypto), registry (list/create/update/delete), tools loader (merge to agent’s graph).
- `apps/api/lib/inngest/functions.ts` – `mcp-server-sync` (cron to re-sync manifests), `mcp-tool-approval-decided` (resume agent runs).
- `apps/api/app/api/mcp/` – GET /servers, GET /servers/:id, POST /servers (create), PUT /servers/:id (update), DELETE /servers/:id; per-server load tools endpoint.
- `apps/mobile/src/app/mcp.tsx` – Settings screen for adding / viewing / editing MCP servers; Agent detail screen for MCP server attachment.
- `apps/mobile/src/lib/mcp.ts` – client API for the above.
