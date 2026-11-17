-- Phase 6: Remote MCP Marketplace (runbook-phase-6-mcp.md)
-- Apply with the other migrations (Supabase SQL editor).

create extension if not exists pgcrypto;

-- 6.1: Catalog
create table if not exists mcp_servers (
  id uuid primary key default gen_random_uuid(),
  slug text not null unique,
  name text not null,
  description text not null,
  provider text not null check (provider in ('composio', 'zapier', 'apify', 'direct')),
  category text not null,
  endpoint text,
  transport text not null check (transport in ('streamable_http', 'http', 'stdio')),
  auth_type text not null check (auth_type in ('none', 'api_key', 'oauth2', 'pat', 'provider_managed')),
  capabilities jsonb default '{}',
  config jsonb default '{}',
  is_verified boolean default false,
  is_free_tier boolean default false,
  enabled boolean default true,
  created_by uuid,
  created_at timestamptz default now(),
  updated_at timestamptz default now()
);

create index if not exists mcp_servers_enabled_category on mcp_servers (enabled, category);
create index if not exists mcp_servers_enabled_auth_type on mcp_servers (enabled, auth_type);

alter table mcp_servers enable row level security;
drop policy if exists "mcp_servers_select_own" on mcp_servers;
create policy "mcp_servers_select_own" on mcp_servers for select using (user_id = auth.uid());
drop policy if exists "mcp_servers_admin_insert" on mcp_servers;
create policy "mcp_servers_admin_insert" on mcp_servers for insert with check (user_id = auth.uid());
drop policy if exists "mcp_servers_admin_update" on mcp_servers;
create policy "mcp_servers_admin_update" on mcp_servers for update using (user_id = auth.uid());
drop policy if exists "mcp_servers_admin_delete" on mcp_servers;
create policy "mcp_servers_admin_delete" on mcp_servers for delete using (user_id = auth.uid());

-- 6.2: User connections
create table if not exists user_mcp_connections (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null,
  mcp_server_id uuid not null references mcp_servers(id) on delete cascade,
  provider_connection_id text,
  status text not null check (status in ('pending', 'connected', 'expired', 'error', 'disconnected')),
  auth_type text not null check (auth_type in ('none', 'api_key', 'oauth2', 'pat', 'provider_managed')),
  credentials_ciphertext text,
  credentials_iv text,
  credentials_tag text,
  key_version text,
  metadata jsonb default '{}',
  last_checked_at timestamptz,
  created_at timestamptz default now(),
  updated_at timestamptz default now(),
  unique (user_id, mcp_server_id, provider_connection_id)
);

create index if not exists user_mcp_connections_user_status on user_mcp_connections (user_id, status, mcp_server_id);

alter table user_mcp_connections enable row level security;
drop policy if exists "user_mcp_connections_select_own" on user_mcp_connections;
create policy "user_mcp_connections_select_own" on user_mcp_connections for select using (user_id = auth.uid());
drop policy if exists "user_mcp_connections_insert_own" on user_mcp_connections;
create policy "user_mcp_connections_insert_own" on user_mcp_connections for insert with check (user_id = auth.uid());
drop policy if exists "user_mcp_connections_update_own" on user_mcp_connections;
create policy "user_mcp_connections_update_own" on user_mcp_connections for update using (user_id = auth.uid());
drop policy if exists "user_mcp_connections_delete_own" on user_mcp_connections;
create policy "user_mcp_connections_delete_own" on user_mcp_connections for delete using (user_id = auth.uid());

-- 6.4: Tool catalog
create table if not exists mcp_tools (
  id uuid primary key default gen_random_uuid(),
  mcp_server_id uuid not null references mcp_servers(id) on delete cascade,
  external_tool_id text not null,
  name text not null,
  description text not null default '',
  input_schema jsonb default '{}',
  risk_level text not null check (risk_level in ('low', 'medium', 'high')),
  approval_required_default boolean default false,
  enabled boolean default true,
  schema_hash text not null,
  discovered_at timestamptz not null default now(),
  unique (mcp_server_id, external_tool_id)
);

create index if not exists mcp_tools_server_enabled on mcp_tools (mcp_server_id, enabled);

alter table mcp_tools enable row level security;
drop policy if exists "mcp_tools_select_own" on mcp_tools;
create policy "mcp_tools_select_own" on mcp_tools for select using (user_id = auth.uid());
drop policy if exists "mcp_tools_admin_insert" on mcp_tools;
create policy "mcp_tools_admin_insert" on mcp_tools for insert with check (user_id = auth.uid());
drop policy if exists "mcp_tools_admin_update" on mcp_tools;
create policy "mcp_tools_admin_update" on mcp_tools for update using (user_id = auth.uid());
drop policy if exists "mcp_tools_admin_delete" on mcp_tools;
create policy "mcp_tools_admin_delete" on mcp_tools for delete using (user_id = auth.uid());

-- 6.5: Agent attachments
create table if not exists agent_mcp_servers (
  id uuid primary key default gen_random_uuid(),
  agent_id uuid not null,
  user_mcp_connection_id uuid not null references user_mcp_connections(id) on delete cascade,
  enabled boolean default true,
  created_at timestamptz default now(),
  updated_at timestamptz default now(),
  unique (agent_id, user_mcp_connection_id)
);

create index if not exists agent_mcp_servers_agent_enabled on agent_mcp_servers (agent_id, enabled);

alter table agent_mcp_servers enable row level security;
drop policy if exists "agent_mcp_servers_select_own" on agent_mcp_servers;
create policy "agent_mcp_servers_select_own" on agent_mcp_servers for select using (user_id = auth.uid());
drop policy if exists "agent_mcp_servers_insert_own" on agent_mcp_servers;
create policy "agent_mcp_servers_insert_own" on agent_mcp_servers for insert with check (user_id = auth.uid());
drop policy if exists "agent_mcp_servers_update_own" on agent_mcp_servers;
create policy "agent_mcp_servers_update_own" on agent_mcp_servers for update using (user_id = auth.uid());
drop policy if exists "agent_mcp_servers_delete_own" on agent_mcp_servers;
create policy "agent_mcp_servers_delete_own" on agent_mcp_servers for delete using (user_id = auth.uid());

-- 6.5: Per-tool permissions
create table if not exists agent_mcp_tool_permissions (
  id uuid primary key default gen_random_uuid(),
  agent_id uuid not null,
  mcp_tool_id uuid not null references mcp_tools(id) on delete cascade,
  enabled boolean default true,
  approval_required boolean default false,
  risk_level text not null check (risk_level in ('low', 'medium', 'high')),
  created_at timestamptz default now(),
  updated_at timestamptz default now(),
  unique (agent_id, mcp_tool_id)
);

create index if not exists agent_mcp_tool_permissions_agent_enabled on agent_mcp_tool_permissions (agent_id, enabled);

alter table agent_mcp_tool_permissions enable row level security;
drop policy if exists "agent_mcp_tool_permissions_select_own" on agent_mcp_tool_permissions;
create policy "agent_mcp_tool_permissions_select_own" on agent_mcp_tool_permissions for select using (user_id = auth.uid());
drop policy if exists "agent_mcp_tool_permissions_insert_own" on agent_mcp_tool_permissions;
create policy "agent_mcp_tool_permissions_insert_own" on agent_mcp_tool_permissions for insert with check (user_id = auth.uid());
drop policy if exists "agent_mcp_tool_permissions_update_own" on agent_mcp_tool_permissions;
create policy "agent_mcp_tool_permissions_update_own" on agent_mcp_tool_permissions for update using (user_id = auth.uid());
drop policy if exists "agent_mcp_tool_permissions_delete_own" on agent_mcp_tool_permissions;
create policy "agent_mcp_tool_permissions_delete_own" on agent_mcp_tool_permissions for delete using (user_id = auth.uid());
