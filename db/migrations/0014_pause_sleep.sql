-- 0014: run pause/resume + agent sleep/wake.
--
-- `paused` joins the run status set: a paused run stops at the next graph
-- node boundary (the node wrappers in apps/api/lib/agent/graph.ts check the
-- status) and resumes from its LangGraph checkpoint via `run/resumed`.
-- `agents.sleeping` marks a slept agent: sleep pauses all of its active
-- runs, and POST /api/agents/run rejects new tasks until it wakes.
-- Postgres names inline checks <table>_<column>_check (see 0013).

alter table agent_runs drop constraint if exists agent_runs_status_check;
alter table agent_runs add constraint agent_runs_status_check
  check (status in ('queued','running','awaiting_approval','succeeded','failed','cancelled','paused'));

alter table agents add column if not exists sleeping boolean default false;
