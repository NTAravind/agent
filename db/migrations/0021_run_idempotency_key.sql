-- Phase 7: Idempotency key for agent runs to prevent duplicate execution on retries.
--
-- The key is client-supplied (a UUID) and unique per user, so a retried
-- "start task" request resolves to the run that was already created instead
-- of starting a second one (and repeating its side effects).

alter table agent_runs
  add column if not exists idempotency_key text;

create unique index if not exists agent_runs_user_idempotency_key
  on agent_runs (user_id, idempotency_key)
  where idempotency_key is not null;

-- Old keys are kept with the run they created; a run row is the audit trail
-- of the task, so the key is never rewritten or reused.
