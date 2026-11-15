-- Phase 3: agent runs and their event timeline.
-- Apply with the other migrations (Supabase SQL editor).

create table if not exists agent_runs (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null,
  agent_id uuid,
  thread_id uuid,
  parent_run_id uuid references agent_runs(id),
  goal text not null,
  status text default 'queued' check (status in
    ('queued','running','awaiting_approval','succeeded','failed','cancelled')),
  result jsonb,
  error text,
  model text,
  tokens_used int default 0,
  created_at timestamptz default now(),
  finished_at timestamptz
);

create index if not exists agent_runs_user_created_at
  on agent_runs (user_id, created_at desc);

create table if not exists run_events (
  id bigint generated always as identity primary key,
  run_id uuid not null references agent_runs(id) on delete cascade,
  type text not null,                  -- node_start|node_end|tool_call|tool_result|message|error
  payload jsonb,
  created_at timestamptz default now()
);

create index if not exists run_events_run_id on run_events (run_id, id);

alter table agent_runs enable row level security;
alter table run_events enable row level security;

drop policy if exists "agent_runs_select_own" on agent_runs;
create policy "agent_runs_select_own" on agent_runs for select using (user_id = auth.uid());
drop policy if exists "agent_runs_insert_own" on agent_runs;
create policy "agent_runs_insert_own" on agent_runs for insert with check (user_id = auth.uid());
drop policy if exists "agent_runs_update_own" on agent_runs;
create policy "agent_runs_update_own" on agent_runs for update using (user_id = auth.uid());
drop policy if exists "agent_runs_delete_own" on agent_runs;
create policy "agent_runs_delete_own" on agent_runs for delete using (user_id = auth.uid());

drop policy if exists "run_events_select_own" on run_events;
create policy "run_events_select_own" on run_events for select
  using (exists (select 1 from agent_runs r where r.id = run_events.run_id and r.user_id = auth.uid()));
drop policy if exists "run_events_insert_own" on run_events;
create policy "run_events_insert_own" on run_events for insert
  with check (exists (select 1 from agent_runs r where r.id = run_events.run_id and r.user_id = auth.uid()));
