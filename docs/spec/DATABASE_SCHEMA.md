# Database Schema (Supabase Postgres)

Keep the DB small (free cap 500 MB): files go to Storage, notes live in GitHub, DB holds metadata, chunks and embeddings. Vector dimension below assumes 768; **set it to your embedding model's real dimension**. Supabase Auth users are limited to one by `db/migrations/20261122132549_single_account_auth.sql`; the trigger serializes concurrent sign-ups and rejects later account creation.

```sql
create extension if not exists vector;
create extension if not exists pgcrypto;

-- Conversations
create table threads (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id),
  agent_id uuid,
  title text,
  created_at timestamptz default now(),
  updated_at timestamptz default now()
);
create table messages (
  id uuid primary key default gen_random_uuid(),
  thread_id uuid not null references threads(id) on delete cascade,
  user_id uuid not null,
  role text not null check (role in ('user','assistant','system','tool')),
  agent_id uuid,                   -- agent that authored the message, when applicable
  model text,                      -- registry id that produced it
  parts jsonb not null,            -- AI SDK UI message parts
  created_at timestamptz default now()
);
create index on messages (thread_id, created_at);

-- Memory
create table memories (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null,
  kind text check (kind in ('fact','preference','decision','task')),
  content text not null,
  source_thread_id uuid,
  embedding vector(768),
  created_at timestamptz default now(),
  updated_at timestamptz default now()
);
create index on memories using hnsw (embedding vector_cosine_ops);

-- Second brain (index of the GitHub vault)
create table notes (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null,
  path text not null,              -- e.g. "Projects/Idea.md"
  title text,
  frontmatter jsonb,
  content_hash text not null,
  git_sha text,
  updated_at timestamptz default now(),
  unique (user_id, path)
);
create table note_chunks (
  id uuid primary key default gen_random_uuid(),
  note_id uuid not null references notes(id) on delete cascade,
  idx int not null,
  heading text,
  content text not null,
  embedding vector(768),
  tsv tsvector generated always as (to_tsvector('english', content)) stored
);
create index on note_chunks using hnsw (embedding vector_cosine_ops);
create index on note_chunks using gin (tsv);
create table note_links (
  from_note uuid references notes(id) on delete cascade,
  to_path text not null,           -- target by path/title; may be unresolved
  primary key (from_note, to_path)
);

-- Uploaded documents (files in Storage)
create table documents (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null,
  storage_path text not null,
  mime text, name text, size_bytes bigint,
  status text default 'uploaded' check (status in ('uploaded','processing','ready','failed')),
  created_at timestamptz default now()
);

-- Agents & MCP
create table agents (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null,
  name text not null,
  avatar jsonb not null default '{"type":"emoji","value":"🤖","color":"#7F9DFF"}'::jsonb, -- type: emoji|icon|image; image value is a Storage path
  role text,
  system_prompt text,
  model text,                        -- registry id "provider:modelId"; NULL = app default (migration 0010)
  fallback_models text[] default '{}',        -- ordered registry ids
  config jsonb default '{}',
  is_supervisor boolean default false,
  sleeping boolean default false,           -- asleep: active runs paused, new tasks rejected (migration 0014)
  created_at timestamptz default now()
);
-- Storage buckets: `attachments` (chat files) and `avatars` (agent identity
-- images, private — migration 0011; signed upload via POST /api/agents/:id/avatar,
-- signed read URLs minted by the API). Migration 0011 also backfills
-- threads.agent_id with each user's oldest agent for pre-agent threads.
create table mcp_servers (            -- registry (global, seeded)
  id uuid primary key default gen_random_uuid(),
  slug text unique not null,
  name text not null,
  description text,
  url text not null,                   -- streamable HTTP endpoint
  auth_type text check (auth_type in ('none','api_key','oauth')),
  icon_url text,
  default_requires_approval boolean default true
);
create table mcp_connections (        -- per user credentials
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null,
  server_id uuid not null references mcp_servers(id),
  credentials_enc bytea,               -- AES-256-GCM ciphertext (app-level)
  credentials_iv bytea,
  status text default 'active',
  created_at timestamptz default now(),
  unique (user_id, server_id)
);
create table agent_mcp_tools (
  id uuid primary key default gen_random_uuid(),
  agent_id uuid not null references agents(id) on delete cascade,
  connection_id uuid not null references mcp_connections(id) on delete cascade,
  tool_name text,                      -- null = all tools of the server
  requires_approval boolean default true
);
create unique index on agent_mcp_tools (agent_id, connection_id, coalesce(tool_name,''));

-- Runs, events, approvals
create table agent_runs (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null,
  agent_id uuid, thread_id uuid,
  parent_run_id uuid references agent_runs(id),
  goal text not null,
  status text default 'queued' check (status in
    ('queued','running','awaiting_approval','paused','succeeded','failed','cancelled')), -- 'paused' via migration 0014
  result jsonb, error text,
  model text,
  tokens_used int default 0,
  created_at timestamptz default now(), finished_at timestamptz
);
create table run_events (
  id bigint generated always as identity primary key,
  run_id uuid not null references agent_runs(id) on delete cascade,
  type text not null,                  -- node_start|node_end|tool_call|tool_result|message|error|perf
  payload jsonb,
  created_at timestamptz default now()
);
-- `perf` rows are content-free Phase 0 timings and are emitted only when PERF_TRACE=1.
create index on run_events (run_id, id);
create table approvals (
  id uuid primary key default gen_random_uuid(),
  run_id uuid not null references agent_runs(id) on delete cascade,
  user_id uuid not null,
  tool_name text, args jsonb, reason text,
  status text default 'pending' check (status in ('pending','approved','denied','expired')),
  decided_at timestamptz, expires_at timestamptz
);

-- Canvas
create table canvases (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null,
  title text not null,
  spec jsonb not null,                 -- validated against shared zod Canvas schema
  data_sources jsonb default '[]',     -- refreshable queries
  version int default 1,
  created_by_run uuid,
  created_at timestamptz default now(), updated_at timestamptz default now()
);

-- Persistent dashboards (Phase 13): separate workspaces, widget rows and immutable revisions.
create table dashboards (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  title text not null,
  description text,
  created_by_agent_id uuid references agents(id) on delete set null,
  layout jsonb not null default '{"columns":12,"rowHeight":96,"gap":12}'::jsonb,
  version int not null default 1 check (version > 0),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create index dashboards_user_updated on dashboards (user_id, updated_at desc, id desc);

create table dashboard_widgets (
  id uuid primary key default gen_random_uuid(),
  dashboard_id uuid not null references dashboards(id) on delete cascade,
  type text not null check (type in ('stat','chart','table','list','markdown','image')),
  title text not null,
  config jsonb not null,
  data_source jsonb,
  position jsonb not null default '{"x":0,"y":0}'::jsonb,
  size jsonb not null default '{"width":3,"height":2}'::jsonb,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create index dashboard_widgets_order on dashboard_widgets (dashboard_id, created_at, id);

create table dashboard_versions (
  id uuid primary key default gen_random_uuid(),
  dashboard_id uuid not null references dashboards(id) on delete cascade,
  version int not null check (version > 0),
  snapshot jsonb not null,
  created_at timestamptz not null default now(),
  created_by_agent_id uuid references agents(id) on delete set null,
  unique (dashboard_id, version)
);
create index dashboard_versions_recent on dashboard_versions (dashboard_id, version desc);

-- Phase 13.2: durable refresh requests and bounded per-widget outcomes.
create table dashboard_refresh_runs (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  dashboard_id uuid not null references dashboards(id) on delete cascade,
  requested_by_agent_id uuid references agents(id) on delete set null,
  status text not null default 'queued'
    check (status in ('queued','running','succeeded','partial_failed','failed','no_op')),
  widget_results jsonb not null default '[]'::jsonb,
  error text,
  created_at timestamptz not null default now(),
  started_at timestamptz,
  finished_at timestamptz
);
create index dashboard_refresh_runs_recent on dashboard_refresh_runs (dashboard_id, created_at desc);
create index dashboard_refresh_runs_user_recent on dashboard_refresh_runs (user_id, created_at desc);

-- Provider model catalog and user-controlled mobile availability
create table provider_models (
  provider text not null check (provider in ('google','groq','openrouter','mistral','deepseek','huggingface','cohere')),
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
-- Service role only; dashboard API authenticates the single app account.

-- Provider usage (drives usage meter and fallback decisions)
create table provider_usage (
  id bigint generated always as identity primary key,
  user_id uuid not null,
  provider text not null,              -- google|groq|openrouter|mistral|deepseek|huggingface|cohere
  model text not null,
  run_id uuid,
  input_tokens int, output_tokens int,
  status text,                         -- ok|rate_limited|error|fallback_from
  latency_ms int,
  created_at timestamptz default now()
);
create index on provider_usage (user_id, provider, created_at);

-- Monitors (website change tracking)
create table monitors (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null,
  url text not null, selector text,
  schedule text default '0 * * * *',
  last_hash text, last_checked timestamptz, active boolean default true
);
create table monitor_snapshots (
  id uuid primary key default gen_random_uuid(),
  monitor_id uuid references monitors(id) on delete cascade,
  hash text, summary_of_change text,
  created_at timestamptz default now()
);

-- Skills (Phase 8): progressive-disclosure instruction bundles.
-- The GitHub vault (`skills/<slug>/SKILL.md`) is the source of truth; this
-- table is the searchable index.
create table skills (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null,
  slug text not null,
  name text not null,
  description text not null,            -- one line, used for discovery
  body text not null default '',         -- full markdown, loaded on demand
  tools text[] default '{}',            -- allowlist that can only NARROW tools
  vault_path text not null,
  git_sha text,
  enabled boolean default true,
  created_at timestamptz default now(), updated_at timestamptz default now(),
  unique (user_id, slug)
);
create table agent_skills (
  agent_id uuid not null references agents(id) on delete cascade,
  skill_id uuid not null references skills(id) on delete cascade,
  enabled boolean default true,
  primary key (agent_id, skill_id)
);

-- Productivity (Phase 9): tasks, calendar, reminders.
-- The database is snake_case; the API is camelCase (mappers in
-- apps/api/lib/productivity.ts).
create table task_lists (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null,
  name text not null,
  sort int default 0,
  created_at timestamptz default now(), updated_at timestamptz default now()
);
create table tasks (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null,
  list_id uuid not null references task_lists(id) on delete cascade,
  parent_id uuid references tasks(id) on delete cascade,   -- subtasks
  title text not null,
  notes text,
  status text default 'open' check (status in ('open','done','cancelled')),
  priority int default 0,
  due_at timestamptz,
  due_all_day boolean default false,
  remind_at timestamptz,
  rrule text,                          -- stored, expanded on read
  reminded_at timestamptz,             -- last delivery (quick inspection)
  completed_at timestamptz,
  created_by text default 'user' check (created_by in ('user','agent','suggested')),
  source_run_id uuid,                  -- set for agent-created rows
  deleted_at timestamptz,              -- soft delete everywhere
  created_at timestamptz default now(), updated_at timestamptz default now()
);
create index on tasks (user_id, status, due_at);
create index on tasks (user_id, remind_at) where remind_at is not null;

create table calendar_events (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null,
  title text not null,
  description text,
  starts_at timestamptz not null,
  ends_at timestamptz not null,
  all_day boolean default false,
  tz text default 'Asia/Kolkata',
  location text,
  rrule text,                          -- stored, expanded on read
  exdates timestamptz[] default '{}',
  reminders jsonb default '[]',        -- [{ minutesBefore, method }]
  created_by text default 'user' check (created_by in ('user','agent','suggested')),
  source_run_id uuid,
  ical_uid text,
  deleted_at timestamptz,
  created_at timestamptz default now(), updated_at timestamptz default now()
);
create index on calendar_events (user_id, starts_at);

create table push_tokens (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null,
  expo_token text not null unique,
  platform text not null check (platform in ('ios','android')),
  last_seen timestamptz default now(),
  created_at timestamptz default now()
);

-- Idempotent reminder delivery: one row per (item, scheduled instant).
create table reminder_log (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null,
  item_type text not null check (item_type in ('task','event')),
  item_id uuid not null,
  remind_at timestamptz not null,
  sent_at timestamptz default now(),
  unique (item_type, item_id, remind_at)
);
```

## Routines (Phase 10)

A routine is a scheduled prompt bound to an agent and a thread. The model proposes a
**structured** schedule; the server derives the RRULE and computes the concrete instants in the
user's timezone — model-supplied dates are never stored.

```sql
create table routines (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null,
  agent_id uuid references agents(id) on delete cascade,
  thread_id uuid not null references threads(id) on delete cascade,
  name text not null,
  prompt text not null,
  schedule jsonb not null,              -- { frequency, days_of_week?, day_of_month?, time, run_at? }
  rrule text,                           -- RRULE for recurring routines (null for one-shot)
  tz text not null default 'Asia/Kolkata',
  source_text text,                     -- the user's original wording
  status text not null default 'draft'
    check (status in ('draft','active','paused','completed')),
  approval_mode text not null default 'queue'
    check (approval_mode in ('queue','deny')),
  next_run_at timestamptz,              -- null until the user confirms (activate)
  last_run_at timestamptz,
  consecutive_failures int not null default 0,
  created_at timestamptz default now(), updated_at timestamptz default now()
);
create index on routines (user_id, status, next_run_at);

-- A routine-fired run: the unique key makes one occurrence create one run.
alter table agent_runs add column routine_id uuid references routines(id) on delete set null;
alter table agent_runs add column scheduled_for timestamptz;
alter table agent_runs add column tz text not null default 'Asia/Kolkata';
create unique index idx_agent_runs_routine_occurrence
  on agent_runs (routine_id, scheduled_for) where routine_id is not null;

-- Agents are chats: the first thread opened for an agent becomes its primary thread.
alter table agents add column primary_thread_id uuid references threads(id) on delete set null;
```

## Agent groups and handoff (Phase 11)

A group is a user-owned collection of agents and a durable chat context. The group parent run
routes between members; each member turn is a child run of the existing single-agent graph.

```sql
create table agent_groups (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  name text not null,
  description text,
  lead_agent_id uuid references agents(id) on delete set null,
  mode text not null default 'handoff' check (mode in ('handoff', 'roundtable')),
  max_hops int not null default 8 check (max_hops > 0),
  token_budget int not null default 50000 check (token_budget > 0),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table group_members (
  group_id uuid not null references agent_groups(id) on delete cascade,
  agent_id uuid not null references agents(id) on delete cascade,
  role text not null default 'member' check (role in ('lead', 'member')),
  created_at timestamptz not null default now(),
  primary key (group_id, agent_id)
);

alter table threads
  add column group_id uuid references agent_groups(id) on delete set null;

alter table messages
  add column from_agent_id uuid references agents(id) on delete set null,
  add column to_agent_id uuid references agents(id) on delete set null,
  add column handoff jsonb,
  add column run_id uuid references agent_runs(id) on delete set null;

alter table agent_runs
  add column group_id uuid references agent_groups(id) on delete set null,
  add column group_context jsonb not null default '{}'::jsonb,
  add column group_depth int not null default 0 check (group_depth >= 0);
```

`messages.handoff` stores `{ from, to, task }`. `agent_runs.group_context` stores the bounded
handoff brief, rolling group summary, membership snapshot, and privacy policy needed to
reconstruct a member turn after an approval resume. On the **parent** run it also stores the
durable `summary` and `tokensUsed` of the group, so a follow-up run in the same conversation
continues from it. The child relationship continues to use `agent_runs.parent_run_id`;
`group_depth` distinguishes a normal member turn from a nested ask.

The membership snapshot in `group_context` is a convenience, never a source of truth: an approval
resume re-reads the live group and re-derives the acting member from the run row's `agent_id`.

Indexes cover `(user_id, updated_at desc)` for groups, membership by agent and role,
`threads.group_id`, message agent/run references, and `(group_id, group_depth)` for runs.

**Atomic membership replacement.** Replacing a group's membership deletes and re-inserts every
row, so it runs in one transaction through the `replace_group_members` RPC: it checks that the
caller owns the group and every member agent, that the lead is one of the members, then swaps the
rows and the `lead_agent_id` column together. A concurrent reader never observes a group with
missing members or with a lead column that disagrees with the rows.

```sql
create or replace function replace_group_members(
  p_group_id uuid,
  p_user_id uuid,
  p_lead_agent_id uuid,
  p_members jsonb
) returns void language plpgsql as $$ ... $$;
```

## Ordinary-chat approval grants (Phase 6/7)

The durable Task Mode gate keeps its decisions in `approvals`. Ordinary chat uses the AI SDK's
inline approval flow, so it needs its own, server-side record of what was approved:

```sql
create table chat_approval_grants (
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
```

The row is written when the approval is issued and consumed atomically (`pending → consumed`,
guarded by `status = 'pending'`) before the MCP call runs. `tool_call_id` is unique, so one signed
approval is one execution: it cannot be replayed, transplanted to another thread/agent, reused
after the MCP connection changed, or used after `expires_at`. A denial flips the row to `denied`.

## Task Mode run columns (Phase 7)

```sql
alter table agent_runs
  add column idempotency_key text,
  add column thread_context jsonb not null default '{}'::jsonb;

create unique index agent_runs_user_idempotency_key
  on agent_runs (user_id, idempotency_key) where idempotency_key is not null;
```

`idempotency_key` is the client-supplied UUID from the `idempotency-key` header. It is unique per
user, so a retried start request resolves to the run that was already created instead of starting
a second task. `thread_context` stores the bounded snapshot of the earlier turns of the
conversation a task continues (`{ "turns": [{ "role", "text" }] }`).

## Search function (hybrid)
Expose an RPC `search_notes(query_embedding, query_text, k)` that combines cosine distance on `note_chunks.embedding` with `ts_rank` on `tsv` (reciprocal-rank fusion) and returns chunk, note path, heading, score.

## LangGraph tables
Created by the checkpointer's `setup()` on the same database; don't hand-write them.

## Row Level Security
Enable RLS on every table above. The normal policy pattern is `using (user_id = auth.uid())`; child tables join through the parent. Phase 11 additionally replaces the `threads`, `messages`, and `agent_runs` insert/update policies with ownership-aware checks, so a direct authenticated database client cannot attach another user's group, agent, thread, or run. `group_members` joins through both the owned group and the owned agent. `mcp_servers` is read-only for authenticated users. Server code using the service role bypasses RLS, so always filter by `user_id` explicitly in server queries.

For Phase 13 dashboards, enable RLS on dashboard, widget, version and refresh-run tables. The dashboard policy scopes `user_id` to `auth.uid()` for select/insert/update/delete. Widget and version policies use an `exists` check against the owning dashboard (`dashboard_id` and `user_id = auth.uid()`). Refresh-run policies require both the row `user_id` and the owning dashboard to match `auth.uid()`. Revoke Data API access from `anon` and `authenticated` because dashboard access goes through authenticated server routes; grant server-side service access explicitly. Server APIs still authenticate first and filter every service-role query by the caller's `user_id`. Version history keeps the latest 50 snapshots per dashboard. Refresh requests are limited to 10 per dashboard per hour and their per-widget outcomes are bounded to the dashboard's widget cap.

## Memory kinds (Phase 9)
`memories.kind` still accepts `'task'` for historical rows, but extraction no longer writes it: a detected task becomes a row in `tasks` with `created_by = 'suggested'`, which the app shows as a suggestion to accept or dismiss. This keeps one todo store instead of two.

## Routine triggers (Phase 10)
A routine inserts a **trigger message** into its thread with `role = 'user'` and a part marked
`{ type: 'routine-trigger', source: 'routine', routine_id, routine_name }`. The app renders it as a
chip, not a normal user bubble, and memory extraction skips it — the routine's prompt is not
something the user said.

## Retention (protect the 500 MB cap)
Prune `run_events` and `provider_usage` older than 30 days; keep `agent_runs` summaries. Group context is bounded before persistence and group message/run rows follow the same run retention policy. Truncate large tool outputs before storing. Store files only in Storage.
