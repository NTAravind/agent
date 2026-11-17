-- Provider catalog used by the web dashboard and mobile model chooser.
create table if not exists provider_models (
  provider text not null check (provider in ('google','groq','openrouter')),
  model_id text not null,
  app_id text not null unique,
  label text not null,
  capabilities jsonb not null default '{}'::jsonb,
  context_window int,
  tier text not null default 'paid' check (tier in ('free','paid')),
  metadata jsonb not null default '{}'::jsonb,
  mobile_enabled boolean not null default false,
  fetched_at timestamptz not null default now(),
  primary key (provider, model_id)
);
alter table provider_models enable row level security;

