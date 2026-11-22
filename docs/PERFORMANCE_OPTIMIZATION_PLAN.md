# Performance Optimization Plan

**Status:** Approved roadmap; Phase 0 in progress  
**Scope:** `autonomous-ai` monorepo (`apps/api`, `apps/mobile`, `packages/shared`, `db`)  
**Goal:** Reduce latency, provider tokens/quota, and durable-work overhead without changing product behavior or weakening security/privacy guarantees.

## Operating rules

- Execute one phase at a time. After each phase, run API/mobile/shared typecheck, lint, and unit tests; report measured before/after results, risks, and rollback instructions; then wait for **“continue”** before starting the next phase.
- Commit each phase separately with a clear message. Keep diffs minimal and reviewable.
- Do not make live provider calls or consume provider quota without explicit approval.
- Do not change infrastructure, destructive database behavior, or provider terms/settings without explicit approval.
- Add or update tests for every behavior-bearing change; never remove tests to make a suite pass.
- Put new database changes in new numbered files under `db/migrations/` and update `db/apply.sql` using the repository convention. Never edit an applied old migration.
- Keep service-role access explicitly scoped by `user_id`; do not change RLS.
- Preserve approval, privacy, group/supervisor, skill, identity, and idempotency invariants listed below.

## Non-negotiable invariants

1. Every service-role query remains scoped by `user_id`; RLS is untouched.
2. Sensitive-tool approval semantics remain unchanged: `needsApproval`, Supervisor child deny mode, park/interrupt, approval, resume, denial, and expiry.
3. `private_ok` remains enforced: non-private models never receive notes, memories, or rolling summaries; private-safe group turns stay on a Google-only chain; a private-capable member cannot hand work to a non-private member.
4. Skills can only narrow the currently available tool set. Group tools are never narrowed away.
5. Supervisor graph behavior and output remain unchanged. Groups remain a separate mechanism.
6. Model arguments never supply dates, `userId`, `agentId`, or `threadId`.
7. Reminder idempotency (`reminder_log`) and routine idempotency (`unique(routine_id, scheduled_for)`) remain intact.

## Phase 0 — Profile (no behavior changes)

### Work

- Add `PERF_TRACE=1` gated, lightweight timing for:
  - every LangGraph node in the single-agent, Supervisor, and group runtimes;
  - every Inngest `step.run` and relevant event handler;
  - every model attempt in `withFallback`;
  - database calls in the chat route and agent runtime;
  - embedding calls;
  - Tavily `web_search` and `fetch_page` calls.
- Record durations in existing `run_events.payload` where a run ID is available; otherwise emit one structured JSON console line. Do not add latency-sensitive writes when tracing is disabled.
- Add `apps/api/scripts/perf-report.ts` to aggregate `run_events` and `provider_usage`:
  - p50/p95 by node type;
  - p50/p95 latency and error/429 rates by provider/model;
  - average LLM attempts/calls per run;
  - average Inngest steps per run;
  - tokens per run.
- Measure chat time-to-first-token by stage: auth, thread load, attachments, memory/note retrieval, prompt build, and model TTFT.
- Run and save `EXPLAIN (ANALYZE, BUFFERS)` findings for:
  - `searchMemories`;
  - `search_notes` RPC;
  - routine-tick due query;
  - reminder-tick due queries;
  - group live-run lookup;
  - run-event fetch for `GET /api/runs/:id`.
- Publish `docs/perf/BASELINE.md` with dataset boundaries, exact SQL, numbers, and ranked bottlenecks.

### Acceptance

- Tracing is absent (and behaviorally inert) unless `PERF_TRACE=1`.
- The report script handles empty data and does not call providers.
- Explain output is clearly marked as environment-dependent and never exposes secrets/private content.
- Typecheck, lint, and unit tests pass; Phase 0 is committed and then execution stops.

## Phase 1 — Quick wins (low risk)

### Work

- **Auth:** if Supabase uses asymmetric JWT signing keys, verify locally with cached JWKS/`getClaims`; preserve the existing user object shape. If keys are symmetric, document it and skip this optimization.
- **Chat latency:** parallelize independent thread, attachment, memory, and note work; skip private-context retrieval for trivial acknowledgements using a deterministic heuristic; move non-critical writes (`chat/completed`, usage persistence) off the response-critical path with `after()`/`waitUntil`.
- **Usage writes:** batch/fire-and-forget provider usage without delaying model responses.
- **Prompt cache locality:** stable system/skill/tool prefix first, volatile memories/notes/run state last; sort tool declarations by name.
- **Web cache:** add a user-scoped Postgres cache for normalized web-search queries (1 hour) and page URLs (15 minutes), with size caps and an explicit bypass flag.
- **Indexes:** add a new migration for due-task reminders, calendar reminders, due routines, live group-parent lookup, and run-event reads; verify planner usage with `EXPLAIN`.
- **Deployment guardrails:** document matching Vercel/Supabase regions and transaction-pooler usage; add a startup warning when `DATABASE_URL` is not a pooler URL, without changing infrastructure.

### Acceptance

- Privacy/approval/group/supervisor/skill/idempotency tests remain green.
- Report before/after latency, calls, steps, and tokens; document the symmetry-key auth result.
- Typecheck, lint, and unit tests pass; Phase 1 is committed and then execution stops.

## Phase 2 — Model layer

### Work

- Add a provider/model circuit breaker to `withFallback`: open after 429/5xx/timeout, exponential cooldown from 2 to 10 minutes, half-open probe after cooldown, and `skipped: circuit_open` logging.
- Use per-instance state plus a lightweight shared convergence mechanism derived from usage or a small table.
- Add configurable per-attempt TTFT and total timeouts (short for fast nodes, longer for final nodes).
- Preserve capability gating, `private_ok`, and Google-only private-safe chains exactly; circuit state must never cross a privacy boundary.

### Acceptance

- Tests prove breaker open/half-open/close, capability-skip interaction, and Google-only private-safe routing.
- Typecheck, lint, and unit tests pass; Phase 2 is committed and then execution stops.

## Phase 3 — Agent graph (highest payoff/highest risk)

### Work

- Reduce LLM calls by folding continuation/revision/finish into `act_llm` structured output and invoking `observe` only for failure, cap, or ambiguity.
- Route trivial goals around `plan`, with deterministic/fast-model checks and a one-step fallback.
- Merge adjacent cheap work into fewer Inngest steps only where no `interrupt()` boundary is crossed; never merge across `tool_gate`’s interrupt.
- Execute independent tools concurrently with a cap of four while preserving tool-log order and truncation caps.
- Attach only tool groups actually available to the agent while preserving core tools, group-tool protection, and skill narrowing.

### Acceptance

- Existing graph, approval, group, privacy, and skill tests remain green.
- New tests prove approval park/resume, Supervisor deny mode, narrowing-only skills, and group tools surviving late rounds.
- Compare calls/run and steps/run on five fixed research goals with deterministic mocks. Ask before any live-quota comparison.
- Typecheck, lint, and unit tests pass; Phase 3 is committed and then execution stops.

## Phase 4 — Background work

### Work

- Debounce memory extraction per thread and persist `last_extracted_message_id` as a cursor.
- Hash vault chunks individually, skip unchanged embeddings, batch embedding requests, and debounce webhook bursts.
- Merge reminder and routine ticks into one minute cron with an indexed early-exit while preserving both idempotency contracts.
- Move retention pruning for `run_events` and `provider_usage` to one daily batched delete or `pg_cron` where supported.
- Evaluate `halfvec` after checking the deployed pgvector version; provide a reversible migration/plan and do not apply destructive changes without approval.

### Acceptance

- Cursor, chunk-hash, cron, and idempotency behavior has tests.
- No schema rollback/destructive operation occurs without approval.
- Typecheck, lint, and unit tests pass; Phase 4 is committed and then execution stops.

## Phase 5 — Supervisor and run streaming

### Work

- Execute Supervisor children as separate Inngest invocations while preserving retry idempotency, `approvalMode: "deny"`, and output shape.
- Extend `GET /api/runs/:id?after=<event id>` with ETag/304; preserve the full response by default.
- Mobile: poll incrementally (or use RLS-safe Realtime), batch token state updates per animation frame, memoize bubbles, use FlashList for chat/notes, lazy-load heavy screens, and use React Query stale-while-revalidate for tasks/agents/notes lists.

### Acceptance

- Supervisor semantics and run API backward compatibility remain intact.
- Typecheck, lint, and unit tests pass; Phase 5 is committed, reported, and execution stops.

## Rollback strategy

- Each phase is one isolated commit and can be reverted without reverting prior phases.
- Schema changes use additive migrations where possible; include explicit down/reversal steps in the phase report before any destructive proposal.
- Runtime flags allow targeted disablement (for example `PERF_TRACE=0` or a web-cache bypass flag) without a rollback.
- Never reset or rewrite historical migrations/commits.
