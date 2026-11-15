-- Phase 4: approvals for sensitive tools (write_note, future MCP tools).
-- Apply with the other migrations (Supabase SQL editor).

create table if not exists approvals (
  id uuid primary key default gen_random_uuid(),
  run_id uuid not null references agent_runs(id) on delete cascade,
  user_id uuid not null,
  tool_name text, args jsonb, reason text,
  status text default 'pending' check (status in ('pending','approved','denied','expired')),
  decided_at timestamptz, expires_at timestamptz
);

create index if not exists approvals_user_status
  on approvals (user_id, status, created_at);

alter table approvals enable row level security;

drop policy if exists "approvals_select_own" on approvals;
create policy "approvals_select_own" on approvals for select using (user_id = auth.uid());
drop policy if exists "approvals_insert_own" on approvals;
create policy "approvals_insert_own" on approvals for insert with check (user_id = auth.uid());
drop policy if exists "approvals_update_own" on approvals;
create policy "approvals_update_own" on approvals for update using (user_id = auth.uid());
drop policy if exists "approvals_delete_own" on approvals;
create policy "approvals_delete_own" on approvals for delete using (user_id = auth.uid());
