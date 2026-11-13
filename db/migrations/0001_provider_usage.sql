-- Provider usage tracking (drives the usage meter and fallback decisions).
-- Apply with: supabase db push  |  or paste into the Supabase SQL editor.

create extension if not exists pgcrypto;

create table if not exists provider_usage (
  id bigint generated always as identity primary key,
  user_id uuid not null,
  provider text not null,              -- google|groq|openrouter
  model text not null,                 -- registry id that was attempted
  run_id uuid,
  input_tokens int,
  output_tokens int,
  status text,                         -- ok|rate_limited|error|skipped
  latency_ms int,
  created_at timestamptz default now()
);

create index if not exists provider_usage_user_created_at
  on provider_usage (user_id, created_at);

create index if not exists provider_usage_user_provider_created_at
  on provider_usage (user_id, provider, created_at);

alter table provider_usage enable row level security;

drop policy if exists "provider_usage_select_own" on provider_usage;
create policy "provider_usage_select_own"
  on provider_usage for select
  using (user_id = auth.uid());

drop policy if exists "provider_usage_insert_own" on provider_usage;
create policy "provider_usage_insert_own"
  on provider_usage for insert
  with check (user_id = auth.uid());

-- Retention: the free tier caps the database at 500 MB.
-- (Pruning runs from Inngest later; this is the index that keeps it cheap.)
create index if not exists provider_usage_created_at on provider_usage (created_at);
