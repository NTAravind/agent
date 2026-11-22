-- Phase 13.1: persistent dashboards, widget definitions and immutable snapshots.
create table if not exists public.dashboards (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  title text not null check (char_length(title) between 1 and 200),
  description text check (description is null or char_length(description) <= 2000),
  created_by_agent_id uuid references public.agents(id) on delete set null,
  layout jsonb not null default '{"columns":12,"rowHeight":96,"gap":12}'::jsonb,
  version integer not null default 1 check (version > 0),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index if not exists dashboards_user_updated
  on public.dashboards (user_id, updated_at desc, id desc);

create table if not exists public.dashboard_widgets (
  id uuid primary key default gen_random_uuid(),
  dashboard_id uuid not null references public.dashboards(id) on delete cascade,
  type text not null check (type in ('stat','chart','table','list','markdown','image')),
  title text not null check (char_length(title) between 1 and 200),
  config jsonb not null,
  data_source jsonb,
  position jsonb not null default '{"x":0,"y":0}'::jsonb,
  size jsonb not null default '{"width":3,"height":2}'::jsonb,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index if not exists dashboard_widgets_order
  on public.dashboard_widgets (dashboard_id, created_at, id);

create table if not exists public.dashboard_versions (
  id uuid primary key default gen_random_uuid(),
  dashboard_id uuid not null references public.dashboards(id) on delete cascade,
  version integer not null check (version > 0),
  snapshot jsonb not null,
  created_at timestamptz not null default now(),
  created_by_agent_id uuid references public.agents(id) on delete set null,
  unique (dashboard_id, version)
);

create index if not exists dashboard_versions_recent
  on public.dashboard_versions (dashboard_id, version desc);

alter table public.dashboards enable row level security;
alter table public.dashboard_widgets enable row level security;
alter table public.dashboard_versions enable row level security;

revoke all on table public.dashboards, public.dashboard_widgets, public.dashboard_versions from anon;
revoke all on table public.dashboards, public.dashboard_widgets, public.dashboard_versions from authenticated;
grant all on table public.dashboards, public.dashboard_widgets, public.dashboard_versions to service_role;

drop policy if exists dashboards_select_own on public.dashboards;
create policy dashboards_select_own on public.dashboards
  for select to authenticated using ((select auth.uid()) is not null and user_id = (select auth.uid()));
drop policy if exists dashboards_insert_own on public.dashboards;
create policy dashboards_insert_own on public.dashboards
  for insert to authenticated with check ((select auth.uid()) is not null and user_id = (select auth.uid()));
drop policy if exists dashboards_update_own on public.dashboards;
create policy dashboards_update_own on public.dashboards
  for update to authenticated using (user_id = (select auth.uid())) with check (user_id = (select auth.uid()));
drop policy if exists dashboards_delete_own on public.dashboards;
create policy dashboards_delete_own on public.dashboards
  for delete to authenticated using (user_id = (select auth.uid()));

drop policy if exists dashboard_widgets_select_own on public.dashboard_widgets;
create policy dashboard_widgets_select_own on public.dashboard_widgets
  for select to authenticated using (exists (
    select 1 from public.dashboards d
    where d.id = dashboard_id and d.user_id = (select auth.uid())
  ));
drop policy if exists dashboard_widgets_insert_own on public.dashboard_widgets;
create policy dashboard_widgets_insert_own on public.dashboard_widgets
  for insert to authenticated with check (exists (
    select 1 from public.dashboards d
    where d.id = dashboard_id and d.user_id = (select auth.uid())
  ));
drop policy if exists dashboard_widgets_update_own on public.dashboard_widgets;
create policy dashboard_widgets_update_own on public.dashboard_widgets
  for update to authenticated using (exists (
    select 1 from public.dashboards d
    where d.id = dashboard_id and d.user_id = (select auth.uid())
  )) with check (exists (
    select 1 from public.dashboards d
    where d.id = dashboard_id and d.user_id = (select auth.uid())
  ));
drop policy if exists dashboard_widgets_delete_own on public.dashboard_widgets;
create policy dashboard_widgets_delete_own on public.dashboard_widgets
  for delete to authenticated using (exists (
    select 1 from public.dashboards d
    where d.id = dashboard_id and d.user_id = (select auth.uid())
  ));

drop policy if exists dashboard_versions_select_own on public.dashboard_versions;
create policy dashboard_versions_select_own on public.dashboard_versions
  for select to authenticated using (exists (
    select 1 from public.dashboards d
    where d.id = dashboard_id and d.user_id = (select auth.uid())
  ));
drop policy if exists dashboard_versions_insert_own on public.dashboard_versions;
create policy dashboard_versions_insert_own on public.dashboard_versions
  for insert to authenticated with check (exists (
    select 1 from public.dashboards d
    where d.id = dashboard_id and d.user_id = (select auth.uid())
  ));
drop policy if exists dashboard_versions_update_own on public.dashboard_versions;
drop policy if exists dashboard_versions_delete_own on public.dashboard_versions;

-- Keep metadata, widget replacement and snapshot creation in one transaction.
-- This invoker function is callable only by the server-side service role.
create or replace function public.create_dashboard_revision(
  p_user_id uuid,
  p_dashboard_id uuid,
  p_expected_version integer,
  p_title text,
  p_description text,
  p_created_by_agent_id uuid,
  p_layout jsonb,
  p_widgets jsonb,
  p_snapshot jsonb
) returns integer
language plpgsql
security invoker
set search_path = ''
as $$
declare
  next_version integer;
  widget jsonb;
begin
  if p_expected_version is null then
    perform pg_advisory_xact_lock(hashtextextended('dashboard:create:' || p_user_id::text, 0));
    if (select count(*) from public.dashboards d
        where d.user_id = p_user_id and d.created_at >= now() - interval '1 hour') >= 20 then
      raise exception 'dashboard_creation_rate_limit' using errcode = 'P0001';
    end if;
    insert into public.dashboards (
      id, user_id, title, description, created_by_agent_id, layout, version
    ) values (
      p_dashboard_id, p_user_id, p_title, p_description, p_created_by_agent_id, p_layout, 1
    );
    next_version := 1;
  else
    update public.dashboards
      set title = p_title,
          description = p_description,
          created_by_agent_id = p_created_by_agent_id,
          layout = p_layout,
          version = version + 1,
          updated_at = now()
      where id = p_dashboard_id
        and user_id = p_user_id
        and version = p_expected_version
      returning version into next_version;
    if next_version is null then
      raise exception 'Dashboard changed or is not owned by the caller.' using errcode = 'P0002';
    end if;
    delete from public.dashboard_widgets where dashboard_id = p_dashboard_id;
  end if;

  for widget in select value from jsonb_array_elements(p_widgets)
  loop
    insert into public.dashboard_widgets (
      id, dashboard_id, type, title, config, data_source, position, size
    ) values (
      coalesce(nullif(widget->>'id', '')::uuid, gen_random_uuid()),
      p_dashboard_id,
      widget->>'type',
      widget->>'title',
      widget->'config',
      nullif(widget->'data_source', 'null'::jsonb),
      coalesce(widget->'position', '{"x":0,"y":0}'::jsonb),
      coalesce(widget->'size', '{"width":3,"height":2}'::jsonb)
    );
  end loop;

  insert into public.dashboard_versions (
    dashboard_id, version, snapshot, created_by_agent_id
  ) values (
    p_dashboard_id, next_version, p_snapshot || jsonb_build_object('version', next_version), p_created_by_agent_id
  );

  if next_version > 50 then
    delete from public.dashboard_versions
      where dashboard_id = p_dashboard_id and version <= next_version - 50;
  end if;

  return next_version;
end;
$$;

revoke all on function public.create_dashboard_revision(uuid, uuid, integer, text, text, uuid, jsonb, jsonb, jsonb)
  from public, anon, authenticated;
grant execute on function public.create_dashboard_revision(uuid, uuid, integer, text, text, uuid, jsonb, jsonb, jsonb)
  to service_role;
