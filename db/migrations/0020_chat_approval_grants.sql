-- Phase 6/7: Ordinary-chat approval grants (separate from durable Task Mode approvals).
--
-- Each inline MCP approval in ordinary chat is recorded here when it is issued
-- and consumed atomically when the approved tool runs. The grant is keyed by
-- the tool call id, which the AI SDK's approval signature already binds, so it
-- cannot be replayed, transplanted to another thread/agent, or used after the
-- underlying MCP connection changed.

create table if not exists chat_approval_grants (
  id uuid primary key default gen_random_uuid(),
  tool_call_id text not null unique,           -- bound by the AI SDK approval signature
  user_id uuid not null,
  thread_id uuid not null references threads(id) on delete cascade,
  agent_id uuid references agents(id) on delete set null,
  connection_id uuid references user_mcp_connections(id) on delete set null,
  tool_name text not null,
  input_digest text not null,                  -- canonicalized input digest
  status text not null default 'pending'
    check (status in ('pending','denied','expired','consumed')),
  expires_at timestamptz not null,
  decided_at timestamptz,
  consumed_at timestamptz,
  created_at timestamptz not null default now()
);

create index if not exists chat_approval_grants_user_pending
  on chat_approval_grants (user_id, status, created_at)
  where status = 'pending';

create index if not exists chat_approval_grants_thread
  on chat_approval_grants (thread_id, status);

alter table chat_approval_grants enable row level security;

drop policy if exists "chat_approval_grants_select_own" on chat_approval_grants;
create policy "chat_approval_grants_select_own" on chat_approval_grants
  for select using (user_id = auth.uid());

drop policy if exists "chat_approval_grants_insert_own" on chat_approval_grants;
create policy "chat_approval_grants_insert_own" on chat_approval_grants
  for insert with check (user_id = auth.uid());

drop policy if exists "chat_approval_grants_update_own" on chat_approval_grants;
create policy "chat_approval_grants_update_own" on chat_approval_grants
  for update using (user_id = auth.uid());

drop policy if exists "chat_approval_grants_delete_own" on chat_approval_grants;
create policy "chat_approval_grants_delete_own" on chat_approval_grants
  for delete using (user_id = auth.uid());
