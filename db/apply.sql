-- Provider usage tracking (drives the usage meter and fallback decisions).
-- Apply with: supabase db push  |  or paste into the Supabase SQL editor.

create extension if not exists pgcrypto;

create table if not exists provider_usage (
  id bigint generated always as identity primary key,
  user_id uuid not null,
  provider text not null,              -- google|groq|openrouter|mistral|deepseek|huggingface|cohere
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
-- Chat: threads, messages, uploaded documents and the attachments storage bucket.
-- Apply with: supabase db push  |  or paste into the Supabase SQL editor.

create extension if not exists pgcrypto;

-- Conversations -----------------------------------------------------------
create table if not exists threads (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id),
  agent_id uuid,
  title text,
  model text,
  created_at timestamptz default now(),
  updated_at timestamptz default now()
);

create table if not exists messages (
  id uuid primary key default gen_random_uuid(),
  thread_id uuid not null references threads(id) on delete cascade,
  user_id uuid not null,
  role text not null check (role in ('user','assistant','system','tool')),
  model text,
  parts jsonb not null,
  created_at timestamptz default now()
);

create index if not exists messages_thread_created_at on messages (thread_id, created_at);
create index if not exists threads_user_updated_at on threads (user_id, updated_at desc);

alter table threads enable row level security;
alter table messages enable row level security;

drop policy if exists "threads_select_own" on threads;
create policy "threads_select_own" on threads for select using (user_id = auth.uid());
drop policy if exists "threads_insert_own" on threads;
create policy "threads_insert_own" on threads for insert with check (user_id = auth.uid());
drop policy if exists "threads_update_own" on threads;
create policy "threads_update_own" on threads for update using (user_id = auth.uid());
drop policy if exists "threads_delete_own" on threads;
create policy "threads_delete_own" on threads for delete using (user_id = auth.uid());

drop policy if exists "messages_select_own" on messages;
create policy "messages_select_own" on messages for select using (user_id = auth.uid());
drop policy if exists "messages_insert_own" on messages;
create policy "messages_insert_own" on messages for insert with check (user_id = auth.uid());
drop policy if exists "messages_delete_own" on messages;
create policy "messages_delete_own" on messages for delete using (user_id = auth.uid());

-- Uploaded documents (chat attachments today, parsed documents later) -------
create table if not exists documents (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null,
  storage_path text not null,
  mime text,
  name text,
  size_bytes bigint,
  status text default 'uploaded' check (status in ('uploaded','processing','ready','failed')),
  created_at timestamptz default now()
);

create index if not exists documents_user_created_at on documents (user_id, created_at desc);

alter table documents enable row level security;

drop policy if exists "documents_select_own" on documents;
create policy "documents_select_own" on documents for select using (user_id = auth.uid());
drop policy if exists "documents_insert_own" on documents;
create policy "documents_insert_own" on documents for insert with check (user_id = auth.uid());
drop policy if exists "documents_update_own" on documents;
create policy "documents_update_own" on documents for update using (user_id = auth.uid());
drop policy if exists "documents_delete_own" on documents;
create policy "documents_delete_own" on documents for delete using (user_id = auth.uid());

-- Private storage bucket for attachments ----------------------------------
insert into storage.buckets (id, name, public)
values ('attachments', 'attachments', false)
on conflict (id) do nothing;

drop policy if exists "attachments_read_own" on storage.objects;
create policy "attachments_read_own" on storage.objects for select
  using (bucket_id = 'attachments' and auth.uid()::text = (storage.foldername(name))[1]);

drop policy if exists "attachments_insert_own" on storage.objects;
create policy "attachments_insert_own" on storage.objects for insert
  with check (bucket_id = 'attachments' and auth.uid()::text = (storage.foldername(name))[1]);

drop policy if exists "attachments_delete_own" on storage.objects;
create policy "attachments_delete_own" on storage.objects for delete
  using (bucket_id = 'attachments' and auth.uid()::text = (storage.foldername(name))[1]);

-- 0015: skills (reusable instruction bundles) + per-agent assignment.
--
-- The GitHub vault is the source of truth: a skill is a markdown file at
-- `skills/<slug>/SKILL.md` with frontmatter (name, description, optional
-- tools allowlist). Supabase holds the rebuilt index used by the system
-- prompt and the `load_skill` tool (Rebuildable principle).
--
-- `agent_skills.tools` narrowing lives on the skill row: a skill's `tools`
-- may only ever intersect the agent's current tool set, never add to it.
-- Postgres names inline checks <table>_<column>_check (see 0013).

create table if not exists skills (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null,
  slug text not null,               -- "research-brief" from skills/<slug>/SKILL.md
  name text not null,
  description text not null default '',
  body text not null default '',    -- markdown body (frontmatter stripped)
  tools text[] default '{}',        -- allowlist that can only narrow the agent's tools
  vault_path text,                  -- "skills/<slug>/SKILL.md"
  git_sha text,                     -- blob sha at last index (skip unchanged)
  enabled boolean not null default true,
  created_at timestamptz default now(),
  updated_at timestamptz default now(),
  unique (user_id, slug)
);

alter table skills enable row level security;

drop policy if exists "skills_select_own" on skills;
create policy "skills_select_own" on skills for select using (user_id = auth.uid());
drop policy if exists "skills_insert_own" on skills;
create policy "skills_insert_own" on skills for insert with check (user_id = auth.uid());
drop policy if exists "skills_update_own" on skills;
create policy "skills_update_own" on skills for update using (user_id = auth.uid());
drop policy if exists "skills_delete_own" on skills;
create policy "skills_delete_own" on skills for delete using (user_id = auth.uid());

create table if not exists agent_skills (
  agent_id uuid not null references agents(id) on delete cascade,
  skill_id uuid not null references skills(id) on delete cascade,
  enabled boolean not null default true,
  created_at timestamptz default now(),
  primary key (agent_id, skill_id)
);

create index if not exists agent_skills_skill_id on agent_skills (skill_id);
create index if not exists agent_skills_agent_enabled on agent_skills (agent_id, enabled);

-- Child table: RLS joins through the parent (agents), per DATABASE_SCHEMA.md.
alter table agent_skills enable row level security;
drop policy if exists "agent_skills_select_own" on agent_skills;
create policy "agent_skills_select_own" on agent_skills for select using (exists (
  select 1 from agents a where a.id = agent_skills.agent_id and a.user_id = auth.uid()
));
drop policy if exists "agent_skills_insert_own" on agent_skills;
create policy "agent_skills_insert_own" on agent_skills for insert with check (exists (
  select 1 from agents a where a.id = agent_skills.agent_id and a.user_id = auth.uid()
));
drop policy if exists "agent_skills_update_own" on agent_skills;
create policy "agent_skills_update_own" on agent_skills for update using (exists (
  select 1 from agents a where a.id = agent_skills.agent_id and a.user_id = auth.uid()
));
drop policy if exists "agent_skills_delete_own" on agent_skills;
create policy "agent_skills_delete_own" on agent_skills for delete using (exists (
  select 1 from agents a where a.id = agent_skills.agent_id and a.user_id = auth.uid()
));

-- PostgREST caches the schema; notify it so new tables are visible immediately.
notify pgrst, 'reload schema';

-- Phase 9: Tasks, Calendar, and Notes editing
-- 0016_tasks_calendar.sql

-- Keeps `updated_at` fresh on UPDATE. Defined here so this migration is
-- self-contained (no dependency on an earlier migration's DDL).
CREATE OR REPLACE FUNCTION update_updated_at_column()
RETURNS TRIGGER AS $$
BEGIN
    NEW.updated_at = now();
    RETURN NEW;
END;
$$ LANGUAGE plpgsql;

-- Task lists (user-named containers)
CREATE TABLE IF NOT EXISTS task_lists (
    id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    user_id uuid NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
    name text NOT NULL,
    sort int NOT NULL DEFAULT 0,
    created_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_task_lists_user_sort
    ON task_lists (user_id, sort, created_at);

ALTER TABLE task_lists ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS task_lists_select_own ON task_lists;
CREATE POLICY task_lists_select_own ON task_lists
    FOR SELECT USING (user_id = auth.uid());

DROP POLICY IF EXISTS task_lists_insert_own ON task_lists;
CREATE POLICY task_lists_insert_own ON task_lists
    FOR INSERT WITH CHECK (user_id = auth.uid());

DROP POLICY IF EXISTS task_lists_update_own ON task_lists;
CREATE POLICY task_lists_update_own ON task_lists
    FOR UPDATE USING (user_id = auth.uid()) WITH CHECK (user_id = auth.uid());

DROP POLICY IF EXISTS task_lists_delete_own ON task_lists;
CREATE POLICY task_lists_delete_own ON task_lists
    FOR DELETE USING (user_id = auth.uid());

-- Tasks (hierarchical, with due/remind/recurrence)
CREATE TABLE IF NOT EXISTS tasks (
    id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    user_id uuid NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
    list_id uuid NOT NULL REFERENCES task_lists(id) ON DELETE CASCADE,
    parent_id uuid REFERENCES tasks(id) ON DELETE CASCADE,
    title text NOT NULL,
    notes text,
    status text NOT NULL CHECK (status IN ('open', 'done', 'cancelled')) DEFAULT 'open',
    priority int NOT NULL DEFAULT 0,
    due_at timestamptz,
    due_all_day boolean NOT NULL DEFAULT false,
    remind_at timestamptz,
    rrule text, -- RRULE string for recurrence
    completed_at timestamptz,
    created_by text NOT NULL CHECK (created_by IN ('user', 'agent', 'suggested')) DEFAULT 'user',
    source_run_id uuid REFERENCES agent_runs(id) ON DELETE SET NULL,
    deleted_at timestamptz,
    reminded_at timestamptz, -- last time a reminder push was sent for this task
    created_at timestamptz NOT NULL DEFAULT now(),
    updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_tasks_user_status_due
    ON tasks (user_id, status, due_at) WHERE deleted_at IS NULL;
CREATE INDEX IF NOT EXISTS idx_tasks_user_remind
    ON tasks (user_id, remind_at) WHERE remind_at IS NOT NULL AND deleted_at IS NULL;
CREATE INDEX IF NOT EXISTS idx_tasks_user_list
    ON tasks (user_id, list_id, status, due_at) WHERE deleted_at IS NULL;
CREATE INDEX IF NOT EXISTS idx_tasks_parent
    ON tasks (parent_id) WHERE deleted_at IS NULL;
CREATE INDEX IF NOT EXISTS idx_tasks_source_run
    ON tasks (source_run_id) WHERE source_run_id IS NOT NULL;

ALTER TABLE tasks ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS tasks_select_own ON tasks;
CREATE POLICY tasks_select_own ON tasks
    FOR SELECT USING (user_id = auth.uid());

DROP POLICY IF EXISTS tasks_insert_own ON tasks;
CREATE POLICY tasks_insert_own ON tasks
    FOR INSERT WITH CHECK (user_id = auth.uid());

DROP POLICY IF EXISTS tasks_update_own ON tasks;
CREATE POLICY tasks_update_own ON tasks
    FOR UPDATE USING (user_id = auth.uid()) WITH CHECK (user_id = auth.uid());

DROP POLICY IF EXISTS tasks_delete_own ON tasks;
CREATE POLICY tasks_delete_own ON tasks
    FOR DELETE USING (user_id = auth.uid());

-- Calendar events (with recurrence and reminders)
CREATE TABLE IF NOT EXISTS calendar_events (
    id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    user_id uuid NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
    title text NOT NULL,
    description text,
    starts_at timestamptz NOT NULL,
    ends_at timestamptz NOT NULL,
    all_day boolean NOT NULL DEFAULT false,
    tz text NOT NULL DEFAULT 'Asia/Kolkata',
    location text,
    rrule text, -- RRULE string for recurrence
    exdates timestamptz[] NOT NULL DEFAULT '{}',
    reminders jsonb NOT NULL DEFAULT '[]', -- array of {minutes_before: int, method: 'push'|'email'}
    created_by text NOT NULL DEFAULT 'user', -- 'user' | 'agent' | 'suggested'
    source_run_id uuid REFERENCES agent_runs(id) ON DELETE SET NULL,
    ical_uid text, -- for CalDAV / external sync later
    deleted_at timestamptz,
    created_at timestamptz NOT NULL DEFAULT now(),
    updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_calendar_events_user_starts
    ON calendar_events (user_id, starts_at) WHERE deleted_at IS NULL;
CREATE INDEX IF NOT EXISTS idx_calendar_events_user_remind
    ON calendar_events (user_id, starts_at) WHERE deleted_at IS NULL AND reminders <> '[]'::jsonb;
CREATE INDEX IF NOT EXISTS idx_calendar_events_source_run
    ON calendar_events (source_run_id) WHERE source_run_id IS NOT NULL;

ALTER TABLE calendar_events ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS calendar_events_select_own ON calendar_events;
CREATE POLICY calendar_events_select_own ON calendar_events
    FOR SELECT USING (user_id = auth.uid());

DROP POLICY IF EXISTS calendar_events_insert_own ON calendar_events;
CREATE POLICY calendar_events_insert_own ON calendar_events
    FOR INSERT WITH CHECK (user_id = auth.uid());

DROP POLICY IF EXISTS calendar_events_update_own ON calendar_events;
CREATE POLICY calendar_events_update_own ON calendar_events
    FOR UPDATE USING (user_id = auth.uid()) WITH CHECK (user_id = auth.uid());

DROP POLICY IF EXISTS calendar_events_delete_own ON calendar_events;
CREATE POLICY calendar_events_delete_own ON calendar_events
    FOR DELETE USING (user_id = auth.uid());

-- Expo push tokens
CREATE TABLE IF NOT EXISTS push_tokens (
    id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    user_id uuid NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
    expo_token text NOT NULL UNIQUE,
    platform text NOT NULL, -- 'ios' | 'android'
    last_seen timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_push_tokens_user
    ON push_tokens (user_id);

ALTER TABLE push_tokens ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS push_tokens_select_own ON push_tokens;
CREATE POLICY push_tokens_select_own ON push_tokens
    FOR SELECT USING (user_id = auth.uid());

DROP POLICY IF EXISTS push_tokens_insert_own ON push_tokens;
CREATE POLICY push_tokens_insert_own ON push_tokens
    FOR INSERT WITH CHECK (user_id = auth.uid());

DROP POLICY IF EXISTS push_tokens_update_own ON push_tokens;
CREATE POLICY push_tokens_update_own ON push_tokens
    FOR UPDATE USING (user_id = auth.uid()) WITH CHECK (user_id = auth.uid());

DROP POLICY IF EXISTS push_tokens_delete_own ON push_tokens;
CREATE POLICY push_tokens_delete_own ON push_tokens
    FOR DELETE USING (user_id = auth.uid());

-- Reminder delivery log (one row per scheduled reminder occurrence).
-- The unique key makes the reminder tick idempotent: a reminder is never
-- pushed twice, even if the cron overlaps or retries.
CREATE TABLE IF NOT EXISTS reminder_log (
    id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    user_id uuid NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
    item_type text NOT NULL CHECK (item_type IN ('task', 'event')),
    item_id uuid NOT NULL,
    remind_at timestamptz NOT NULL,
    sent_at timestamptz NOT NULL DEFAULT now()
);

CREATE UNIQUE INDEX IF NOT EXISTS idx_reminder_log_unique
    ON reminder_log (item_type, item_id, remind_at);

CREATE INDEX IF NOT EXISTS idx_reminder_log_user_sent
    ON reminder_log (user_id, sent_at);

ALTER TABLE reminder_log ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS reminder_log_select_own ON reminder_log;
CREATE POLICY reminder_log_select_own ON reminder_log
    FOR SELECT USING (user_id = auth.uid());

DROP POLICY IF EXISTS reminder_log_insert_own ON reminder_log;
CREATE POLICY reminder_log_insert_own ON reminder_log
    FOR INSERT WITH CHECK (user_id = auth.uid());

DROP POLICY IF EXISTS reminder_log_delete_own ON reminder_log;
CREATE POLICY reminder_log_delete_own ON reminder_log
    FOR DELETE USING (user_id = auth.uid());

-- Updated_at triggers
DO $$
BEGIN
    IF NOT EXISTS (SELECT 1 FROM pg_trigger WHERE tgname = 'task_lists_updated_at') THEN
        CREATE TRIGGER task_lists_updated_at
            BEFORE UPDATE ON task_lists
            FOR EACH ROW EXECUTE FUNCTION update_updated_at_column();
    END IF;
    IF NOT EXISTS (SELECT 1 FROM pg_trigger WHERE tgname = 'tasks_updated_at') THEN
        CREATE TRIGGER tasks_updated_at
            BEFORE UPDATE ON tasks
            FOR EACH ROW EXECUTE FUNCTION update_updated_at_column();
    END IF;
    IF NOT EXISTS (SELECT 1 FROM pg_trigger WHERE tgname = 'calendar_events_updated_at') THEN
        CREATE TRIGGER calendar_events_updated_at
            BEFORE UPDATE ON calendar_events
            FOR EACH ROW EXECUTE FUNCTION update_updated_at_column();
    END IF;
END
$$;

-- Grant usage on types if needed
GRANT USAGE ON SCHEMA public TO postgres, anon, authenticated, service_role;

-- PostgREST caches the schema; notify it so the new tables/columns are
-- visible immediately to the Supabase client.
notify pgrst, 'reload schema';-- Phase 10: Routines (chat-first scheduling)
-- 0017_routines.sql

-- Keeps `updated_at` fresh on UPDATE. Defined here so this migration is
-- self-contained (no dependency on an earlier migration's DDL).
CREATE OR REPLACE FUNCTION update_updated_at_column()
RETURNS TRIGGER AS $$
BEGIN
    NEW.updated_at = now();
    RETURN NEW;
END;
$$ LANGUAGE plpgsql;

-- Routines: a scheduled prompt bound to an agent and a thread.
--
-- `schedule` holds the *structured* schedule the model produced (the UI
-- renders it); `rrule` + `tz` are what the scheduler actually uses. The
-- server computes `next_run_at` — model-supplied dates are never trusted.
CREATE TABLE IF NOT EXISTS routines (
    id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    user_id uuid NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
    agent_id uuid REFERENCES agents(id) ON DELETE CASCADE,
    thread_id uuid NOT NULL REFERENCES threads(id) ON DELETE CASCADE,
    name text NOT NULL,
    prompt text NOT NULL,
    schedule jsonb NOT NULL,          -- { frequency, days_of_week?, day_of_month?, time, run_at? }
    rrule text,                       -- RRULE string for recurring routines
    tz text NOT NULL DEFAULT 'Asia/Kolkata',
    source_text text,                 -- the user's original words
    status text NOT NULL DEFAULT 'draft'
        CHECK (status IN ('draft', 'active', 'paused', 'completed')),
    approval_mode text NOT NULL DEFAULT 'queue'
        CHECK (approval_mode IN ('queue', 'deny')),
    next_run_at timestamptz,
    last_run_at timestamptz,
    consecutive_failures int NOT NULL DEFAULT 0,
    created_at timestamptz NOT NULL DEFAULT now(),
    updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_routines_user_status
    ON routines (user_id, status, next_run_at);

CREATE INDEX IF NOT EXISTS idx_routines_agent
    ON routines (agent_id) WHERE agent_id IS NOT NULL;

CREATE INDEX IF NOT EXISTS idx_routines_thread
    ON routines (thread_id);

ALTER TABLE routines ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS routines_select_own ON routines;
CREATE POLICY routines_select_own ON routines
    FOR SELECT USING (user_id = auth.uid());

DROP POLICY IF EXISTS routines_insert_own ON routines;
CREATE POLICY routines_insert_own ON routines
    FOR INSERT WITH CHECK (user_id = auth.uid());

DROP POLICY IF EXISTS routines_update_own ON routines;
CREATE POLICY routines_update_own ON routines
    FOR UPDATE USING (user_id = auth.uid()) WITH CHECK (user_id = auth.uid());

DROP POLICY IF EXISTS routines_delete_own ON routines;
CREATE POLICY routines_delete_own ON routines
    FOR DELETE USING (user_id = auth.uid());

-- Routine runs are ordinary agent runs with two extra columns:
--   routine_id     — the routine that fired
--   scheduled_for  — the occurrence instant it fired for
-- The unique index makes the scheduler idempotent: the same occurrence can
-- never create two runs, even if the cron overlaps or retries.
ALTER TABLE agent_runs ADD COLUMN IF NOT EXISTS routine_id uuid REFERENCES routines(id) ON DELETE SET NULL;
ALTER TABLE agent_runs ADD COLUMN IF NOT EXISTS scheduled_for timestamptz;

-- The user's timezone for this run. "Every Monday at 9" must mean 9 in the
-- user's own zone, so the zone travels with the run (the Inngest worker
-- would otherwise have to guess).
ALTER TABLE agent_runs ADD COLUMN IF NOT EXISTS tz text NOT NULL DEFAULT 'Asia/Kolkata';

CREATE UNIQUE INDEX IF NOT EXISTS idx_agent_runs_routine_occurrence
    ON agent_runs (routine_id, scheduled_for) WHERE routine_id IS NOT NULL;

CREATE INDEX IF NOT EXISTS idx_agent_runs_routine
    ON agent_runs (routine_id) WHERE routine_id IS NOT NULL;

-- Each agent has a primary persistent thread ("agents are chats"). Created
-- lazily the first time the agent is opened.
ALTER TABLE agents ADD COLUMN IF NOT EXISTS primary_thread_id uuid REFERENCES threads(id) ON DELETE SET NULL;

-- Updated-at trigger
DO $$
BEGIN
    IF NOT EXISTS (SELECT 1 FROM pg_trigger WHERE tgname = 'routines_updated_at') THEN
        CREATE TRIGGER routines_updated_at
            BEFORE UPDATE ON routines
            FOR EACH ROW EXECUTE FUNCTION update_updated_at_column();
    END IF;
END
$$;

-- Grant usage on types if needed
GRANT USAGE ON SCHEMA public TO postgres, anon, authenticated, service_role;

-- Phase 11: Agent groups and handoff
-- 0018_agent_groups.sql
--
-- A group is a user-owned collection of agents and a chat context for the
-- handoff/roundtable run. The API uses the service role for writes, but all
-- user-facing rows remain protected by RLS. Service-role queries must still
-- filter by the owning user's user_id (and by group ownership for the child
-- table).

CREATE EXTENSION IF NOT EXISTS pgcrypto;

-- Keeps `updated_at` fresh on UPDATE. Defined here so this migration is
-- self-contained (no dependency on an earlier migration's DDL).
CREATE OR REPLACE FUNCTION update_updated_at_column()
RETURNS TRIGGER AS $$
BEGIN
    NEW.updated_at = now();
    RETURN NEW;
END;
$$ LANGUAGE plpgsql;

-- Agent groups -------------------------------------------------------------
CREATE TABLE IF NOT EXISTS agent_groups (
    id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    user_id uuid NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
    name text NOT NULL,
    description text,
    lead_agent_id uuid REFERENCES agents(id) ON DELETE SET NULL,
    mode text NOT NULL DEFAULT 'handoff'
        CHECK (mode IN ('handoff', 'roundtable')),
    max_hops int NOT NULL DEFAULT 8
        CHECK (max_hops > 0),
    token_budget int NOT NULL DEFAULT 50000
        CHECK (token_budget > 0),
    created_at timestamptz NOT NULL DEFAULT now(),
    updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_agent_groups_user_updated_at
    ON agent_groups (user_id, updated_at DESC);

CREATE INDEX IF NOT EXISTS idx_agent_groups_lead_agent_id
    ON agent_groups (lead_agent_id) WHERE lead_agent_id IS NOT NULL;

-- Group members -----------------------------------------------------------
CREATE TABLE IF NOT EXISTS group_members (
    group_id uuid NOT NULL REFERENCES agent_groups(id) ON DELETE CASCADE,
    agent_id uuid NOT NULL REFERENCES agents(id) ON DELETE CASCADE,
    role text NOT NULL DEFAULT 'member'
        CHECK (role IN ('lead', 'member')),
    created_at timestamptz NOT NULL DEFAULT now(),
    PRIMARY KEY (group_id, agent_id)
);

CREATE INDEX IF NOT EXISTS idx_group_members_agent_id
    ON group_members (agent_id);

CREATE INDEX IF NOT EXISTS idx_group_members_group_role
    ON group_members (group_id, role);

-- A group can have at most one lead membership row.
CREATE UNIQUE INDEX IF NOT EXISTS idx_group_members_one_lead
    ON group_members (group_id) WHERE role = 'lead';

-- Conversations can belong to either an agent or a group.
ALTER TABLE threads
    ADD COLUMN IF NOT EXISTS group_id uuid
        REFERENCES agent_groups(id) ON DELETE SET NULL;

CREATE INDEX IF NOT EXISTS idx_threads_group_id
    ON threads (group_id);

-- Messages can record the agent-to-agent direction and handoff metadata.
ALTER TABLE messages
    ADD COLUMN IF NOT EXISTS from_agent_id uuid
        REFERENCES agents(id) ON DELETE SET NULL;

ALTER TABLE messages
    ADD COLUMN IF NOT EXISTS to_agent_id uuid
        REFERENCES agents(id) ON DELETE SET NULL;

ALTER TABLE messages
    ADD COLUMN IF NOT EXISTS handoff jsonb;

ALTER TABLE messages
    ADD COLUMN IF NOT EXISTS run_id uuid
        REFERENCES agent_runs(id) ON DELETE SET NULL;

CREATE INDEX IF NOT EXISTS idx_messages_from_agent_id
    ON messages (from_agent_id);

CREATE INDEX IF NOT EXISTS idx_messages_to_agent_id
    ON messages (to_agent_id);

CREATE INDEX IF NOT EXISTS idx_messages_run_id
    ON messages (run_id);

-- Runs carry the group context used by the group graph.
ALTER TABLE agent_runs
    ADD COLUMN IF NOT EXISTS group_id uuid
        REFERENCES agent_groups(id) ON DELETE SET NULL;

ALTER TABLE agent_runs
    ADD COLUMN IF NOT EXISTS group_context jsonb NOT NULL DEFAULT '{}'::jsonb;

ALTER TABLE agent_runs
    ADD COLUMN IF NOT EXISTS group_depth int NOT NULL DEFAULT 0;

ALTER TABLE agent_runs
    DROP CONSTRAINT IF EXISTS agent_runs_group_depth_nonnegative;
ALTER TABLE agent_runs
    ADD CONSTRAINT agent_runs_group_depth_nonnegative CHECK (group_depth >= 0);

CREATE INDEX IF NOT EXISTS idx_agent_runs_group_id
    ON agent_runs (group_id);

CREATE INDEX IF NOT EXISTS idx_agent_runs_group_depth
    ON agent_runs (group_id, group_depth);

-- Row-level security ------------------------------------------------------
-- The existing threads, messages, and agent_runs tables have user-scoped
-- policies. This migration re-enables RLS and replaces the relevant insert/
-- update policies with ownership-aware versions for group-linked rows.
ALTER TABLE threads ENABLE ROW LEVEL SECURITY;
ALTER TABLE messages ENABLE ROW LEVEL SECURITY;
ALTER TABLE agent_runs ENABLE ROW LEVEL SECURITY;
ALTER TABLE agent_groups ENABLE ROW LEVEL SECURITY;
ALTER TABLE group_members ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS agent_groups_select_own ON agent_groups;
CREATE POLICY agent_groups_select_own ON agent_groups
    FOR SELECT USING (user_id = auth.uid());

DROP POLICY IF EXISTS agent_groups_insert_own ON agent_groups;
CREATE POLICY agent_groups_insert_own ON agent_groups
    FOR INSERT WITH CHECK (
        user_id = auth.uid()
        AND (
            lead_agent_id IS NULL
            OR EXISTS (
                SELECT 1
                FROM agents a
                WHERE a.id = agent_groups.lead_agent_id
                  AND a.user_id = auth.uid()
            )
        )
    );

DROP POLICY IF EXISTS agent_groups_update_own ON agent_groups;
CREATE POLICY agent_groups_update_own ON agent_groups
    FOR UPDATE USING (user_id = auth.uid())
    WITH CHECK (
        user_id = auth.uid()
        AND (
            lead_agent_id IS NULL
            OR EXISTS (
                SELECT 1
                FROM agents a
                WHERE a.id = agent_groups.lead_agent_id
                  AND a.user_id = auth.uid()
            )
        )
    );

DROP POLICY IF EXISTS agent_groups_delete_own ON agent_groups;
CREATE POLICY agent_groups_delete_own ON agent_groups
    FOR DELETE USING (user_id = auth.uid());

-- Group-linked rows must point only at resources owned by the same user.
-- These policies replace the older user_id-only policies so a direct
-- authenticated database client cannot attach another user's group, agent
-- or run to its own row.
DROP POLICY IF EXISTS threads_insert_own ON threads;
CREATE POLICY threads_insert_own ON threads
    FOR INSERT WITH CHECK (
        user_id = auth.uid()
        AND (
            group_id IS NULL
            OR EXISTS (
                SELECT 1
                FROM agent_groups g
                WHERE g.id = threads.group_id
                  AND g.user_id = auth.uid()
            )
        )
    );

DROP POLICY IF EXISTS threads_update_own ON threads;
CREATE POLICY threads_update_own ON threads
    FOR UPDATE USING (user_id = auth.uid())
    WITH CHECK (
        user_id = auth.uid()
        AND (
            group_id IS NULL
            OR EXISTS (
                SELECT 1
                FROM agent_groups g
                WHERE g.id = threads.group_id
                  AND g.user_id = auth.uid()
            )
        )
    );

DROP POLICY IF EXISTS messages_insert_own ON messages;
CREATE POLICY messages_insert_own ON messages
    FOR INSERT WITH CHECK (
        user_id = auth.uid()
        AND EXISTS (
            SELECT 1
            FROM threads t
            WHERE t.id = messages.thread_id
              AND t.user_id = auth.uid()
        )
        AND (
            from_agent_id IS NULL
            OR EXISTS (
                SELECT 1
                FROM agents a
                WHERE a.id = messages.from_agent_id
                  AND a.user_id = auth.uid()
            )
        )
        AND (
            to_agent_id IS NULL
            OR EXISTS (
                SELECT 1
                FROM agents a
                WHERE a.id = messages.to_agent_id
                  AND a.user_id = auth.uid()
            )
        )
        AND (
            run_id IS NULL
            OR EXISTS (
                SELECT 1
                FROM agent_runs r
                WHERE r.id = messages.run_id
                  AND r.user_id = auth.uid()
            )
        )
    );

DROP POLICY IF EXISTS agent_runs_insert_own ON agent_runs;
CREATE POLICY agent_runs_insert_own ON agent_runs
    FOR INSERT WITH CHECK (
        user_id = auth.uid()
        AND (
            group_id IS NULL
            OR EXISTS (
                SELECT 1
                FROM agent_groups g
                WHERE g.id = agent_runs.group_id
                  AND g.user_id = auth.uid()
            )
        )
        AND (
            agent_id IS NULL
            OR EXISTS (
                SELECT 1
                FROM agents a
                WHERE a.id = agent_runs.agent_id
                  AND a.user_id = auth.uid()
            )
        )
    );

DROP POLICY IF EXISTS agent_runs_update_own ON agent_runs;
CREATE POLICY agent_runs_update_own ON agent_runs
    FOR UPDATE USING (user_id = auth.uid())
    WITH CHECK (
        user_id = auth.uid()
        AND (
            group_id IS NULL
            OR EXISTS (
                SELECT 1
                FROM agent_groups g
                WHERE g.id = agent_runs.group_id
                  AND g.user_id = auth.uid()
            )
        )
        AND (
            agent_id IS NULL
            OR EXISTS (
                SELECT 1
                FROM agents a
                WHERE a.id = agent_runs.agent_id
                  AND a.user_id = auth.uid()
            )
        )
    );

-- Membership is readable and writable only through a group owned by the
-- current user. The agent ownership check prevents a member row from
-- attaching another user's agent to a group.
DROP POLICY IF EXISTS group_members_select_own ON group_members;
CREATE POLICY group_members_select_own ON group_members
    FOR SELECT USING (
        EXISTS (
            SELECT 1
            FROM agent_groups g
            WHERE g.id = group_members.group_id
              AND g.user_id = auth.uid()
        )
        AND EXISTS (
            SELECT 1
            FROM agents a
            WHERE a.id = group_members.agent_id
              AND a.user_id = auth.uid()
        )
    );

DROP POLICY IF EXISTS group_members_insert_own ON group_members;
CREATE POLICY group_members_insert_own ON group_members
    FOR INSERT WITH CHECK (
        EXISTS (
            SELECT 1
            FROM agent_groups g
            WHERE g.id = group_members.group_id
              AND g.user_id = auth.uid()
        )
        AND EXISTS (
            SELECT 1
            FROM agents a
            WHERE a.id = group_members.agent_id
              AND a.user_id = auth.uid()
        )
    );

DROP POLICY IF EXISTS group_members_update_own ON group_members;
CREATE POLICY group_members_update_own ON group_members
    FOR UPDATE USING (
        EXISTS (
            SELECT 1
            FROM agent_groups g
            WHERE g.id = group_members.group_id
              AND g.user_id = auth.uid()
        )
        AND EXISTS (
            SELECT 1
            FROM agents a
            WHERE a.id = group_members.agent_id
              AND a.user_id = auth.uid()
        )
    ) WITH CHECK (
        EXISTS (
            SELECT 1
            FROM agent_groups g
            WHERE g.id = group_members.group_id
              AND g.user_id = auth.uid()
        )
        AND EXISTS (
            SELECT 1
            FROM agents a
            WHERE a.id = group_members.agent_id
              AND a.user_id = auth.uid()
        )
    );

DROP POLICY IF EXISTS group_members_delete_own ON group_members;
CREATE POLICY group_members_delete_own ON group_members
    FOR DELETE USING (
        EXISTS (
            SELECT 1
            FROM agent_groups g
            WHERE g.id = group_members.group_id
              AND g.user_id = auth.uid()
        )
        AND EXISTS (
            SELECT 1
            FROM agents a
            WHERE a.id = group_members.agent_id
              AND a.user_id = auth.uid()
        )
    );

-- Updated-at trigger ------------------------------------------------------
DROP TRIGGER IF EXISTS agent_groups_updated_at ON agent_groups;
CREATE TRIGGER agent_groups_updated_at
    BEFORE UPDATE ON agent_groups
    FOR EACH ROW EXECUTE FUNCTION update_updated_at_column();

-- Grant usage on types if needed
GRANT USAGE ON SCHEMA public TO postgres, anon, authenticated, service_role;
GRANT SELECT, INSERT, UPDATE, DELETE ON agent_groups, group_members
    TO authenticated, service_role;

-- Atomic membership replacement ----------------------------------------------------
-- Swaps a group's whole membership (and lead column) in one transaction, so a
-- concurrent reader never sees a group with missing members and a failed
-- replacement never leaves the lead column disagreeing with the rows.

CREATE OR REPLACE FUNCTION replace_group_members(
    p_group_id uuid,
    p_user_id uuid,
    p_lead_agent_id uuid,
    p_members jsonb
)
RETURNS void
LANGUAGE plpgsql
AS $$
DECLARE
    entry jsonb;
    member_agent_id uuid;
    member_role text;
    member_count int := 0;
BEGIN
    -- Ownership: only the group's owner may replace its membership.
    IF NOT EXISTS (
        SELECT 1 FROM agent_groups g
        WHERE g.id = p_group_id AND g.user_id = p_user_id
    ) THEN
        RAISE EXCEPTION 'group % is not owned by %', p_group_id, p_user_id
            USING ERRCODE = 'no_data_found';
    END IF;

    -- Every member must be an agent owned by the same user.
    FOR entry IN SELECT * FROM jsonb_array_elements(p_members) LOOP
        member_agent_id := (entry ->> 'agentId')::uuid;
        member_role := COALESCE(entry ->> 'role', 'member');
        IF member_role NOT IN ('lead', 'member') THEN
            RAISE EXCEPTION 'invalid member role %', member_role
                USING ERRCODE = 'check_violation';
        END IF;
        IF NOT EXISTS (
            SELECT 1 FROM agents a
            WHERE a.id = member_agent_id AND a.user_id = p_user_id
        ) THEN
            RAISE EXCEPTION 'agent % is not owned by %', member_agent_id, p_user_id
                USING ERRCODE = 'foreign_key_violation';
        END IF;
        member_count := member_count + 1;
    END LOOP;

    IF member_count = 0 THEN
        RAISE EXCEPTION 'a group needs at least one member'
            USING ERRCODE = 'check_violation';
    END IF;
    IF NOT EXISTS (
        SELECT 1 FROM jsonb_array_elements(p_members) item
        WHERE (item ->> 'agentId')::uuid = p_lead_agent_id
          AND (item ->> 'role') = 'lead'
    ) THEN
        RAISE EXCEPTION 'the lead must be a member with the lead role'
            USING ERRCODE = 'check_violation';
    END IF;

    -- Delete first, then insert: the unique one-lead index applies only to the
    -- final set, and both statements commit together or not at all.
    DELETE FROM group_members WHERE group_id = p_group_id;

    INSERT INTO group_members (group_id, agent_id, role)
    SELECT
        p_group_id,
        (item ->> 'agentId')::uuid,
        (item ->> 'role')
    FROM jsonb_array_elements(p_members) AS item;

    UPDATE agent_groups
    SET lead_agent_id = p_lead_agent_id, updated_at = now()
    WHERE id = p_group_id AND user_id = p_user_id;
END;
$$;

-- The service role performs membership replacement on behalf of the caller.
GRANT EXECUTE ON FUNCTION replace_group_members(uuid, uuid, uuid, jsonb)
    TO service_role, authenticated;

-- PostgREST caches the schema; notify it so the new tables/columns are
-- visible immediately to the Supabase client.
notify pgrst, 'reload schema';
