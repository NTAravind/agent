-- Phase 7: Prior-conversation context for Task Mode runs.
-- A Task Mode turn on an existing thread continues that conversation, so the
-- run stores a bounded snapshot of the earlier turns and the graph reads it.

alter table agent_runs
  add column if not exists thread_context jsonb not null default '{}'::jsonb;
