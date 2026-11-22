# Phase 0 Performance Baseline

- **Captured:** 2026-11-23
- **Environment:** Supabase Postgres through the `ap-south-1` pooler (`DATABASE_URL`)
- **Scope:** one configured account; no prompts, note text, memories, tool arguments, URLs, or credentials are included
- **Provider calls made for this baseline:** **0**

This is the pre-optimization baseline. Phase 0 adds measurement only; it does not intentionally change latency, model selection, tool behavior, or data access. The traced schema/path is available for the next measured workload after deployment.

## Dataset boundary

The report used the only configured account and a 10-year window, which includes all currently retained data.

| Dataset | Rows / size |
|---|---:|
| Configured accounts | 1 |
| `provider_usage` rows | 6 |
| Successful provider usage rows | 4 |
| Failed provider usage rows | 2 |
| Provider usage time range | 2026-11-22 18:04:35Z to 18:05:16Z |
| `agent_runs` rows | 0 |
| `run_events` rows | 0 |
| Notes / chunks | 4 / 7 |
| Memories | 0 |
| Routines / tasks / calendar events / groups | 0 / 0 / 0 / 0 |

The account has no persisted agent runs or run events, so node latency and Inngest steps/run cannot be calculated from historical rows. The new tracer will populate those metrics on future `PERF_TRACE=1` runs.

Model timing is recorded at the logical `withFallback`/chat-stream attempt boundary. The AI SDK's internal HTTP retry is not exposed as a separate logical attempt, so the report does not claim physical-request counts.

## Report output

Command:

```bash
cd apps/api
node --import tsx --env-file=.env.local scripts/perf-report.ts \
  --user-id <uuid> --since 3650d
```

### Provider/model latency

| Provider | Model | Calls | Skipped | p50 ms | p95 ms | Error % | 429 % | Tokens |
|---|---|---:|---:|---:|---:|---:|---:|---:|
| google | google:gemini-3.5-flash-lite | 2 | 0 | 581 | 607.1 | 0 | 0 | 480 |
| groq | groq:allam-2-7b | 1 | 0 | n/a | n/a | 100 | 0 | 0 |
| groq | groq:gpt-oss-120b | 2 | 0 | n/a | n/a | 0 | 0 | 5,536 |
| openrouter | openrouter:recursive/flint-v1.0-free | 1 | 0 | n/a | n/a | 100 | 0 | 0 |

`n/a` means no latency sample was stored, not zero latency. The two Google latency samples are total model-attempt latency; they are **not** TTFT measurements.

### Per-run metrics

LLM-call and token averages use every `agent_runs` row in the window as the denominator (runs without usage therefore contribute zero). The Inngest-step average uses only runs that contain traced step samples and reports that sample count separately.

| Metric | Value |
|---|---:|
| Average LLM calls/run | n/a |
| Average successful LLM calls/run | n/a |
| Average provider tokens/run | n/a |
| Average persisted tokens/run | n/a |
| Average Inngest steps/run | n/a (0 traced runs) |
| p50/p95 by node type | n/a (0 run events) |

### Chat time to first token

The historical data does not distinguish request stages or TTFT, so the pre-instrumentation breakdown is unavailable. No synthetic/live chat was run because that would either require provider quota or would not measure a real provider TTFT.

After deployment with `PERF_TRACE=1`, the chat route emits these structured, content-free stage records:

1. `auth`
2. `thread_load`
3. `attachments`
4. `memory_search` / `memory_list_fallback`
5. `note_search` (tool-driven, after model start)
6. `prompt_build`
7. `model_ttft`
8. `request_ttft` (end-to-end request start to first content)

The first six stages are nested where applicable: for example, `prompt_build` includes memory retrieval, while `request_ttft` includes auth, thread/attachment work, prompt construction, and model TTFT. The report must treat these as a breakdown, not add them as independent wall-clock totals.

## Query plans (`EXPLAIN (ANALYZE, BUFFERS)`)

The following read-only plans were executed against the configured database. UUIDs are represented as parameters below; the captured user UUID was removed from this document. The tables are currently tiny/empty, so sequential scans are expected and the plans are directional rather than capacity forecasts.

### 1. `searchMemories`

```sql
EXPLAIN (ANALYZE, BUFFERS, FORMAT TEXT)
SELECT *
FROM search_memories(
  :user_id::uuid,
  (
    SELECT nc.embedding
    FROM note_chunks nc
    JOIN notes n ON n.id = nc.note_id
    WHERE n.user_id = :user_id::uuid
      AND nc.embedding IS NOT NULL
    ORDER BY nc.id
    LIMIT 1
  ),
  8
);
```

Key plan output:

```text
Function Scan on search_memories
  Buffers: shared hit=272 dirtied=1
  InitPlan 1
    -> Limit (actual time=1.038..1.040 rows=1)
      -> Nested Loop (actual time=0.020..0.998 rows=7)
        -> Index Scan using notes_user_id_path_key on notes
        -> Bitmap Heap Scan on note_chunks
Planning Time: 0.241 ms
Execution Time: 9.045 ms
```

**Finding:** the RPC is a function scan and the account has no memories. Even the empty result costs about 9 ms. The query's embedding subquery is test scaffolding and is not part of the application request path.

### 2. `search_notes` RPC

```sql
EXPLAIN (ANALYZE, BUFFERS, FORMAT TEXT)
SELECT *
FROM search_notes(
  :user_id::uuid,
  (
    SELECT nc.embedding
    FROM note_chunks nc
    JOIN notes n ON n.id = nc.note_id
    WHERE n.user_id = :user_id::uuid
      AND nc.embedding IS NOT NULL
    ORDER BY nc.id
    LIMIT 1
  ),
  'profile'::text,
  8
);
```

Key plan output:

```text
Function Scan on search_notes
  Buffers: shared hit=467
  InitPlan 1
    -> Limit (actual time=0.057..0.060 rows=1)
      -> Nested Loop (actual time=0.022..0.049 rows=7)
        -> Index Scan using notes_user_id_path_key on notes
        -> Bitmap Heap Scan on note_chunks
Planning Time: 0.274 ms
Execution Time: 70.819 ms
```

**Finding:** this is the slowest measured database operation: about 70.8 ms for only 7 chunks. The function's semantic HNSW query and lexical GIN query are hidden behind the function scan, so a later phase should inspect both branches independently before changing indexes or embeddings.

### 3. Routine-tick due query

```sql
EXPLAIN (ANALYZE, BUFFERS, FORMAT TEXT)
SELECT id, user_id, agent_id, thread_id, name, prompt, schedule, rrule, tz,
       source_text, status, approval_mode, next_run_at, last_run_at,
       consecutive_failures, created_at, updated_at
FROM routines
WHERE status = 'active'
  AND next_run_at IS NOT NULL
  AND next_run_at <= now()
ORDER BY next_run_at ASC
LIMIT 50;
```

Key plan output:

```text
Limit (actual time=0.034..0.035 rows=0)
  -> Sort (Sort Key: next_run_at)
    -> Seq Scan on routines
      Filter: (next_run_at IS NOT NULL AND status = 'active' AND next_run_at <= now())
Planning Time: 0.151 ms
Execution Time: 0.063 ms
```

**Finding:** currently trivial because the table is empty, but the global due query has no due-time index and scans/sorts all active candidates. The existing `idx_routines_user_status` starts with `user_id`, so it does not directly serve this global cron predicate.

### 4. Reminder-tick due task query

```sql
EXPLAIN (ANALYZE, BUFFERS, FORMAT TEXT)
SELECT id, user_id, title, notes, status, due_at, due_all_day, remind_at, rrule, reminded_at
FROM tasks
WHERE status = 'open'
  AND deleted_at IS NULL
  AND remind_at IS NOT NULL
  AND remind_at <= now();
```

Key plan output:

```text
Seq Scan on tasks
  Filter: (deleted_at IS NULL AND remind_at IS NOT NULL
           AND status = 'open' AND remind_at <= now())
Planning Time: 0.226 ms
Execution Time: 0.079 ms
```

**Finding:** trivial with zero tasks. The existing `idx_tasks_user_remind` starts with `user_id`; the global cron predicate does not currently have a matching `remind_at` leading key.

### 5. Reminder-tick calendar-event query

```sql
EXPLAIN (ANALYZE, BUFFERS, FORMAT TEXT)
SELECT id, user_id, title, starts_at, ends_at, all_day, rrule, exdates, reminders
FROM calendar_events
WHERE deleted_at IS NULL
  AND reminders <> '[]'::jsonb;
```

Key plan output:

```text
Index Scan using idx_calendar_events_user_remind on calendar_events
  Buffers: shared hit=3 dirtied=1
Planning Time: 0.090 ms
Execution Time: 1.507 ms
```

**Finding:** the partial index is used, but the application still reads every non-deleted event with reminders and expands recurrences in application code. The query has no time bound, so its cost grows with all reminder-bearing events rather than only a narrow due window.

### 6. Group live-run lookup

```sql
EXPLAIN (ANALYZE, BUFFERS, FORMAT TEXT)
SELECT id, status
FROM agent_runs
WHERE group_id = :group_id::uuid
  AND user_id = :user_id::uuid
  AND parent_run_id IS NULL
  AND status IN ('queued', 'running', 'awaiting_approval', 'paused')
ORDER BY created_at DESC
LIMIT 1;
```

Key plan output:

```text
Limit (actual time=0.013..0.014 rows=0)
  -> Sort (Sort Key: created_at DESC)
    -> Seq Scan on agent_runs
      Filter: (parent_run_id IS NULL AND group_id = ... AND user_id = ... AND status = ANY (...))
Planning Time: 0.175 ms
Execution Time: 0.037 ms
```

**Finding:** trivial with zero runs. The existing `idx_agent_runs_group_id` begins with `group_id`, but there is no composite/filtered index matching this user-scoped live-parent predicate.

### 7. `GET /api/runs/:id` run-event fetch

```sql
EXPLAIN (ANALYZE, BUFFERS, FORMAT TEXT)
SELECT id, run_id, type, payload, created_at
FROM run_events
WHERE run_id = :run_id::uuid
ORDER BY id ASC;
```

Key plan output:

```text
Sort (Sort Key: id)
  -> Seq Scan on run_events
    Filter: (run_id = ...)
Planning Time: 0.085 ms
Execution Time: 0.038 ms
```

**Finding:** trivial with zero events. `run_events_run_id (run_id, id)` exists, but the planner chooses a sequential scan while the table is tiny; a larger dataset is required to verify index behavior.

## Ranked bottlenecks / next evidence needed

1. **Chat TTFT is the primary user-facing unknown.** Instrumented auth, retrieval, prompt, model TTFT, and end-to-end TTFT stages are required before any chat-path optimization.
2. **`search_notes` is the largest measured DB operation (70.8 ms).** Inspect the semantic and lexical branches independently; do not replace one index without measuring both.
3. **The sampled Google model attempt averaged 581 ms (p95 607.1 ms).** This is total attempt latency from only two rows, not TTFT and not enough for a stable percentile.
4. **`search_memories` still costs about 9 ms with an empty memory table.** The application embedding call is excluded from this DB timing, so end-to-end memory recall is likely higher.
5. **Reminder/routine cron predicates are not scale-ready.** They currently scan/sort broad candidate sets and need a larger fixture or production-scale statistics before selecting exact index shapes.
6. **Run/node/Inngest metrics have no sample.** The new trace path must be exercised on a real agent run before graph-call reduction is justified.

## Instrumentation delivered in Phase 0

`PERF_TRACE=1` gates all telemetry. It emits content-free JSON lines and, for run-associated work, `perf` rows in `run_events`.

| Boundary | Instrumentation |
|---|---|
| Single-agent graph | 7 node wrappers: `plan`, `act_llm`, `tool_gate`, `tool_exec`, `observe`, `self_correct`, `finalize` |
| Supervisor graph | 4 node wrappers: `delegate`, `fan_out`, `verify`, `merge` |
| Group graph | 3 node wrappers: `route`, `agent_turn`, `finalize` |
| Inngest | all 11 existing `step.run` callbacks; durable step names are unchanged |
| Models | every `withFallback` provider attempt and each chat-stream attempt, including TTFT |
| Chat | auth, thread load, attachments, prompt build, retrieval, model TTFT, request TTFT |
| Database | every Supabase PostgREST/RPC request plus direct Postgres checkpoint queries |
| Embeddings | every `embedTexts` batch, including model, dimensions, and batch size |
| Web tools | every Tavily `web_search` and direct `fetch_page` operation |

Trace payloads never include prompts, note/memory content, search text, full URLs, tool arguments, authorization data, or raw provider errors. Tracing failure is non-fatal. With `PERF_TRACE` unset or not `1`, the tracer emits nothing and performs no telemetry database writes.

## Reproducing

```bash
# Aggregate persisted telemetry (no provider calls)
cd apps/api
node --import tsx --env-file=.env.local scripts/perf-report.ts \
  --user-id <uuid> --since 30d

# Machine-readable output
node --import tsx --env-file=.env.local scripts/perf-report.ts \
  --user-id <uuid> --since 30d --json
```

To capture a future chat/agent workload, set `PERF_TRACE=1` in the API environment, preserve the JSON stdout lines from the platform logs, and run the report against the same time window. Do not enable tracing continuously in production: run-associated node and step samples add `run_events` writes by design.
