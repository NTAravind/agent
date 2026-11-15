# Database Schema (Supabase Postgres)

Keep the DB small (free cap 500 MB): files go to Storage, notes live in GitHub, DB holds metadata, chunks and embeddings. Vector dimension below assumes 768; **set it to your embedding model's real dimension**.

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
  model text default 'google:gemini-flash',   -- registry id "provider:modelId"
  fallback_models text[] default '{}',        -- ordered registry ids
  config jsonb default '{}',
  is_supervisor boolean default false,
  created_at timestamptz default now()
);
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
    ('queued','running','awaiting_approval','succeeded','failed','cancelled')),
  result jsonb, error text,
  model text,
  tokens_used int default 0,
  created_at timestamptz default now(), finished_at timestamptz
);
create table run_events (
  id bigint generated always as identity primary key,
  run_id uuid not null references agent_runs(id) on delete cascade,
  type text not null,                  -- node_start|node_end|tool_call|tool_result|message|error
  payload jsonb,
  created_at timestamptz default now()
);
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

-- Provider usage (drives usage meter and fallback decisions)
create table provider_usage (
  id bigint generated always as identity primary key,
  user_id uuid not null,
  provider text not null,              -- google|groq|openrouter
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
```

## Search function (hybrid)
Expose an RPC `search_notes(query_embedding, query_text, k)` that combines cosine distance on `note_chunks.embedding` with `ts_rank` on `tsv` (reciprocal-rank fusion) and returns chunk, note path, heading, score.

## LangGraph tables
Created by the checkpointer's `setup()` on the same database; don't hand-write them.

## Row Level Security
Enable RLS on every table above. Policy pattern: `using (user_id = auth.uid())`; for child tables join through the parent. `mcp_servers` is read-only for authenticated users. Server code using the service role bypasses RLS, so always filter by `user_id` explicitly in server queries.

## Retention (protect the 500 MB cap)
Prune `run_events` and `provider_usage` older than 30 days; keep `agent_runs` summaries. Truncate large tool outputs before storing. Store files only in Storage.
