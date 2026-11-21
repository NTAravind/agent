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
