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
notify pgrst, 'reload schema';