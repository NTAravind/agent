-- Phase 6: Remote MCP Marketplace (docs/prompts/phase-6-remote-mcp-marketplace.md)
-- Apply with the other migrations (Supabase SQL editor).
--
-- Contains:
--   1. agents          — per DATABASE_SCHEMA.md (was never created; runs already
--                        carry agent_id, and MCP attachments are per-agent)
--   2. mcp_servers     — shared marketplace catalog (admin-seeded, read-only
--                        for authenticated users)
--   3. user_mcp_connections — per-user credentials (encrypted app-side, AES-256-GCM)
--   4. mcp_tools       — discovered tool catalog (cached schemas)
--   5. agent_mcp_servers / agent_mcp_tool_permissions — many-to-many attach +
--                        per-tool enable/approval policy
--   6. Seed: 10 verified vendor-hosted remote MCP endpoints (2026-11-17)

-- ---------------------------------------------------------------------------
-- 1. Agents
-- ---------------------------------------------------------------------------
create table if not exists agents (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null,
  name text not null,
  avatar jsonb not null default '{"type":"emoji","value":"🤖","color":"#7F9DFF"}'::jsonb,
  role text,
  system_prompt text,
  -- Registry id "provider:model-id". NULL = use the app default model chain
  -- (the spec's 'google:gemini-flash' default no longer exists in the registry).
  model text,
  fallback_models text[] default '{}',
  config jsonb default '{}',
  is_supervisor boolean default false,
  created_at timestamptz default now()
);

create index if not exists agents_user_created_at on agents (user_id, created_at desc);

alter table agents enable row level security;
drop policy if exists "agents_select_own" on agents;
create policy "agents_select_own" on agents for select using (user_id = auth.uid());
drop policy if exists "agents_insert_own" on agents;
create policy "agents_insert_own" on agents for insert with check (user_id = auth.uid());
drop policy if exists "agents_update_own" on agents;
create policy "agents_update_own" on agents for update using (user_id = auth.uid());
drop policy if exists "agents_delete_own" on agents;
create policy "agents_delete_own" on agents for delete using (user_id = auth.uid());

-- ---------------------------------------------------------------------------
-- 2. Marketplace catalog
-- ---------------------------------------------------------------------------
create table if not exists mcp_servers (
  id uuid primary key default gen_random_uuid(),
  slug text not null unique,
  name text not null,
  description text not null default '',
  provider text not null check (provider in ('composio', 'zapier', 'apify', 'direct')),
  category text not null default 'other',
  endpoint text,
  transport text not null default 'streamable_http'
    check (transport in ('streamable_http', 'http', 'stdio')),
  auth_type text not null check (auth_type in ('none', 'api_key', 'oauth2', 'pat', 'provider_managed')),
  -- Non-secret provider config: header name/format for api_key, OAuth scopes,
  -- repository links, pricing notes. Never secrets.
  config jsonb not null default '{}',
  capabilities jsonb not null default '{"tools": true}',
  icon_url text,
  is_verified boolean not null default false,
  is_free_tier boolean not null default false,
  enabled boolean not null default true,
  created_by uuid,
  created_at timestamptz default now(),
  updated_at timestamptz default now()
);

create index if not exists mcp_servers_enabled_category on mcp_servers (enabled, category);
create index if not exists mcp_servers_enabled_auth_type on mcp_servers (enabled, auth_type);

alter table mcp_servers enable row level security;
-- Catalog is shared: read-only for any signed-in user. Writes happen only via
-- the service role (the API checks ALLOWED_USER_ID before mutating).
drop policy if exists "mcp_servers_select_authenticated" on mcp_servers;
create policy "mcp_servers_select_authenticated" on mcp_servers
  for select using (auth.uid() is not null);

-- ---------------------------------------------------------------------------
-- 3. Per-user connections
-- ---------------------------------------------------------------------------
create table if not exists user_mcp_connections (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null,
  mcp_server_id uuid not null references mcp_servers(id) on delete cascade,
  -- Provider's own connection/account id (Composio session id, …).
  provider_connection_id text,
  status text not null default 'pending'
    check (status in ('pending', 'connected', 'expired', 'error', 'disconnected')),
  auth_type text not null check (auth_type in ('none', 'api_key', 'oauth2', 'pat', 'provider_managed')),
  -- AES-256-GCM payload (see lib/mcp/encryption.ts): base64(iv).base64(tag).base64(ciphertext),
  -- plus key_version for rotation. NULL for auth_type 'none'.
  credentials_ciphertext text,
  credentials_iv text,
  credentials_tag text,
  key_version text,
  -- Non-secret connection metadata (token expiry, provider account label, OAuth state).
  metadata jsonb not null default '{}',
  last_checked_at timestamptz,
  created_at timestamptz default now(),
  updated_at timestamptz default now(),
  -- One connection per user per server (single-user product; see DATABASE_SCHEMA.md).
  unique (user_id, mcp_server_id)
);

create index if not exists user_mcp_connections_user_status
  on user_mcp_connections (user_id, status, mcp_server_id);

alter table user_mcp_connections enable row level security;
drop policy if exists "user_mcp_connections_select_own" on user_mcp_connections;
create policy "user_mcp_connections_select_own" on user_mcp_connections
  for select using (user_id = auth.uid());
drop policy if exists "user_mcp_connections_insert_own" on user_mcp_connections;
create policy "user_mcp_connections_insert_own" on user_mcp_connections
  for insert with check (user_id = auth.uid());
drop policy if exists "user_mcp_connections_update_own" on user_mcp_connections;
create policy "user_mcp_connections_update_own" on user_mcp_connections
  for update using (user_id = auth.uid());
drop policy if exists "user_mcp_connections_delete_own" on user_mcp_connections;
create policy "user_mcp_connections_delete_own" on user_mcp_connections
  for delete using (user_id = auth.uid());

-- ---------------------------------------------------------------------------
-- 4. Discovered tool catalog (schemas cached; refreshed by connect/refresh/sync)
-- ---------------------------------------------------------------------------
create table if not exists mcp_tools (
  id uuid primary key default gen_random_uuid(),
  mcp_server_id uuid not null references mcp_servers(id) on delete cascade,
  external_tool_id text not null,
  name text not null,
  description text not null default '',
  input_schema jsonb not null default '{}',
  risk_level text not null default 'medium' check (risk_level in ('low', 'medium', 'high')),
  -- Catalog default; per-agent rows in agent_mcp_tool_permissions may relax it
  -- (never for risk_level = 'high' — enforced in the API).
  approval_required_default boolean not null default true,
  enabled boolean not null default true,
  schema_hash text not null,
  discovered_at timestamptz not null default now(),
  unique (mcp_server_id, external_tool_id)
);

create index if not exists mcp_tools_server_enabled on mcp_tools (mcp_server_id, enabled);

alter table mcp_tools enable row level security;
-- Shared with the catalog: read-only for signed-in users; service role writes.
drop policy if exists "mcp_tools_select_authenticated" on mcp_tools;
create policy "mcp_tools_select_authenticated" on mcp_tools
  for select using (auth.uid() is not null);

-- ---------------------------------------------------------------------------
-- 5. Per-agent attachment + per-tool policy
-- ---------------------------------------------------------------------------
create table if not exists agent_mcp_servers (
  id uuid primary key default gen_random_uuid(),
  agent_id uuid not null references agents(id) on delete cascade,
  user_mcp_connection_id uuid not null references user_mcp_connections(id) on delete cascade,
  enabled boolean not null default true,
  created_at timestamptz default now(),
  updated_at timestamptz default now(),
  unique (agent_id, user_mcp_connection_id)
);

create index if not exists agent_mcp_servers_agent_enabled
  on agent_mcp_servers (agent_id, enabled);

alter table agent_mcp_servers enable row level security;
drop policy if exists "agent_mcp_servers_select_own" on agent_mcp_servers;
create policy "agent_mcp_servers_select_own" on agent_mcp_servers
  for select using (exists (
    select 1 from agents a where a.id = agent_mcp_servers.agent_id and a.user_id = auth.uid()
  ));
drop policy if exists "agent_mcp_servers_insert_own" on agent_mcp_servers;
create policy "agent_mcp_servers_insert_own" on agent_mcp_servers
  for insert with check (exists (
    select 1 from agents a where a.id = agent_mcp_servers.agent_id and a.user_id = auth.uid()
  ));
drop policy if exists "agent_mcp_servers_update_own" on agent_mcp_servers;
create policy "agent_mcp_servers_update_own" on agent_mcp_servers
  for update using (exists (
    select 1 from agents a where a.id = agent_mcp_servers.agent_id and a.user_id = auth.uid()
  ));
drop policy if exists "agent_mcp_servers_delete_own" on agent_mcp_servers;
create policy "agent_mcp_servers_delete_own" on agent_mcp_servers
  for delete using (exists (
    select 1 from agents a where a.id = agent_mcp_servers.agent_id and a.user_id = auth.uid()
  ));

create table if not exists agent_mcp_tool_permissions (
  id uuid primary key default gen_random_uuid(),
  agent_id uuid not null references agents(id) on delete cascade,
  mcp_tool_id uuid not null references mcp_tools(id) on delete cascade,
  enabled boolean not null default true,
  -- risk_level = 'high' rows are always approval_required (API-enforced).
  approval_required boolean not null default true,
  risk_level text not null default 'medium' check (risk_level in ('low', 'medium', 'high')),
  created_at timestamptz default now(),
  updated_at timestamptz default now(),
  unique (agent_id, mcp_tool_id)
);

create index if not exists agent_mcp_tool_permissions_agent_enabled
  on agent_mcp_tool_permissions (agent_id, enabled);

alter table agent_mcp_tool_permissions enable row level security;
drop policy if exists "agent_mcp_tool_permissions_select_own" on agent_mcp_tool_permissions;
create policy "agent_mcp_tool_permissions_select_own" on agent_mcp_tool_permissions
  for select using (exists (
    select 1 from agents a where a.id = agent_mcp_tool_permissions.agent_id and a.user_id = auth.uid()
  ));
drop policy if exists "agent_mcp_tool_permissions_insert_own" on agent_mcp_tool_permissions;
create policy "agent_mcp_tool_permissions_insert_own" on agent_mcp_tool_permissions
  for insert with check (exists (
    select 1 from agents a where a.id = agent_mcp_tool_permissions.agent_id and a.user_id = auth.uid()
  ));
drop policy if exists "agent_mcp_tool_permissions_update_own" on agent_mcp_tool_permissions;
create policy "agent_mcp_tool_permissions_update_own" on agent_mcp_tool_permissions
  for update using (exists (
    select 1 from agents a where a.id = agent_mcp_tool_permissions.agent_id and a.user_id = auth.uid()
  ));
drop policy if exists "agent_mcp_tool_permissions_delete_own" on agent_mcp_tool_permissions;
create policy "agent_mcp_tool_permissions_delete_own" on agent_mcp_tool_permissions
  for delete using (exists (
    select 1 from agents a where a.id = agent_mcp_tool_permissions.agent_id and a.user_id = auth.uid()
  ));

-- ---------------------------------------------------------------------------
-- 6. Seed — verified vendor-hosted remote MCP endpoints (probed 2026-11-17)
--    All are streamable HTTP. 'none' = works without credentials (rate-limited
--    anonymous tier); oauth2 = MCP-spec OAuth (RFC 8414 discovery + DCR + PKCE,
--    handled by @ai-sdk/mcp auth()).
--    Re-verify before publishing a listing as is_verified (spec requirement).
-- ---------------------------------------------------------------------------
insert into mcp_servers
  (slug, name, description, provider, category, endpoint, transport, auth_type,
   config, capabilities, is_verified, is_free_tier)
values
  ('context7', 'Context7',
   'Up-to-date library documentation and code examples. Connect to ask about any framework or CLI with current docs.',
   'direct', 'development', 'https://mcp.context7.com/mcp', 'streamable_http', 'none',
   '{"metadata": {"docs": "https://context7.com", "pricing": "Free anonymous tier; API key raises limits."}}'::jsonb,
   '{"tools": true}', true, true),

  ('exa', 'Exa',
   'Neural web search and page fetch. Returns clean, citation-ready results for current information and news.',
   'direct', 'research', 'https://mcp.exa.ai/mcp', 'streamable_http', 'none',
   '{"metadata": {"docs": "https://docs.exa.ai", "pricing": "Free anonymous tier; API key raises limits."}}'::jsonb,
   '{"tools": true}', true, true),

  ('firecrawl', 'Firecrawl',
   'Scrape and search the web: markdown, links, screenshots and structured extraction from any URL.',
   'direct', 'research', 'https://mcp.firecrawl.dev/mcp', 'streamable_http', 'none',
   '{"metadata": {"docs": "https://docs.firecrawl.dev", "pricing": "Free anonymous tier; API key raises limits."}}'::jsonb,
   '{"tools": true}', true, true),

  ('notion', 'Notion',
   'Search and read your Notion workspace: pages, databases and blocks. OAuth connects your own Notion account.',
   'direct', 'productivity', 'https://mcp.notion.com/mcp', 'streamable_http', 'oauth2',
   '{"metadata": {"docs": "https://developers.notion.com/docs/mcp", "pricing": "Free with a Notion account."}}'::jsonb,
   '{"tools": true}', true, true),

  ('sentry', 'Sentry',
   'Read your Sentry issues, alerts and project health. OAuth connects your own Sentry organization.',
   'direct', 'development', 'https://mcp.sentry.dev/mcp', 'streamable_http', 'oauth2',
   '{"metadata": {"docs": "https://docs.sentry.io/product/sentry-mcp/", "pricing": "Free tier available."}}'::jsonb,
   '{"tools": true}', true, true),

  ('cloudflare', 'Cloudflare',
   'Inspect Workers, KV, R2 and analytics for your Cloudflare account. OAuth connects your own account.',
   'direct', 'development', 'https://mcp.cloudflare.com/mcp', 'streamable_http', 'oauth2',
   '{"metadata": {"docs": "https://developers.cloudflare.com/agents/model-context-protocol/mcp-server/", "pricing": "Free with a Cloudflare account."}}'::jsonb,
   '{"tools": true}', true, true),

  ('stripe', 'Stripe',
   'Look up Stripe products, prices, payments and customers in read-only mode. OAuth connects your own Stripe account.',
   'direct', 'finance', 'https://mcp.stripe.com', 'streamable_http', 'oauth2',
   '{"metadata": {"docs": "https://docs.stripe.com/mcp", "pricing": "Free with a Stripe account; test-mode by default."}}'::jsonb,
   '{"tools": true}', true, true),

  ('tavily', 'Tavily',
   'AI-orientated web search with follow-up queries. OAuth connects your Tavily account (free tier: 1,000 credits/month).',
   'direct', 'research', 'https://mcp.tavily.com/mcp', 'streamable_http', 'oauth2',
   '{"metadata": {"docs": "https://docs.tavily.com", "pricing": "Free: 1,000 credits/month, no card."}}'::jsonb,
   '{"tools": true}', true, true),

  ('supabase', 'Supabase',
   'Inspect your Supabase projects: schema, logs and edge functions. OAuth connects your own Supabase account.',
   'direct', 'development', 'https://mcp.supabase.com/mcp', 'streamable_http', 'oauth2',
   '{"metadata": {"docs": "https://supabase.com/docs/ai-tools/mcp", "pricing": "Free with a Supabase project."}}'::jsonb,
   '{"tools": true}', true, true),

  ('apify', 'Apify',
   'Run and manage Apify actors and scrape datasets. OAuth connects your own Apify account ($5 free credit).',
   'direct', 'automation', 'https://mcp.apify.com', 'streamable_http', 'oauth2',
   '{"metadata": {"docs": "https://docs.apify.com/ai/mcp-server", "pricing": "Free $5 credit for new accounts."}}'::jsonb,
   '{"tools": true}', true, true)

on conflict (slug) do nothing;

-- PostgREST caches the schema; notify it so new tables/columns are visible
-- without waiting for its reload interval.
notify pgrst, 'reload schema';
