-- Phase 10: Routines (chat-first scheduling)
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

-- PostgREST caches the schema; notify it so the new tables/columns are
-- visible immediately to the Supabase client.
notify pgrst, 'reload schema';
