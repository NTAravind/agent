-- Phase 5: canvases — persisted JSON UI specs rendered natively by the app.
-- Apply with the other migrations (Supabase SQL editor).

create table if not exists canvases (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null,
  title text not null,
  spec jsonb not null,                 -- validated against shared zod Canvas schema
  data_sources jsonb default '[]',     -- refreshable queries
  version int default 1,
  created_by_run uuid,
  created_at timestamptz default now(), updated_at timestamptz default now()
);

create index if not exists canvases_user_updated
  on canvases (user_id, updated_at desc);

alter table canvases enable row level security;

drop policy if exists "canvases_select_own" on canvases;
create policy "canvases_select_own" on canvases for select using (user_id = auth.uid());
drop policy if exists "canvases_insert_own" on canvases;
create policy "canvases_insert_own" on canvases for insert with check (user_id = auth.uid());
drop policy if exists "canvases_update_own" on canvases;
create policy "canvases_update_own" on canvases for update using (user_id = auth.uid());
drop policy if exists "canvases_delete_own" on canvases;
create policy "canvases_delete_own" on canvases for delete using (user_id = auth.uid());
