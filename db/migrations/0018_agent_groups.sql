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
