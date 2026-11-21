# Architecture

## 1. Overview
```
 Expo app ──HTTPS (JWT)──► Next.js on Vercel ──► AI SDK ──► Gemini
   │  ▲                       │   │   │
   │  │ stream/poll           │   │   └─► LangGraph graphs ──► tools / MCP servers
   │  └───────────────────────┘   │
   │                              ├─► Inngest (durable runs, cron, fan-out) ─► calls back /api/inngest
   ▼                              ▼
 Supabase Auth            Supabase Postgres (+pgvector) · Storage
                                  ▲
 GitHub private vault ──sync──────┘  (notes → chunks → embeddings)
```

## 2. Components
- **Expo client:** chat, canvas renderer, notes, agents, MCP store, approvals. Holds only the user session.
- **Next.js API:** authenticates JWT, runs short chats, enqueues Inngest events, serves data endpoints.
- **Agent runtime:** LangGraph graph per agent; Postgres checkpointer; tools = built-in + MCP.
- **Inngest functions:** run graphs in durable steps, cron monitors, memory extraction, vault sync, canvas refresh.
- **Supabase:** system of record for chats, runs, canvases, MCP config; index for notes.
- **Web provider dashboard:** Supabase-authenticated control surface; provider catalog fetches happen server-side and catalog availability is persisted in Supabase.
- **Vault (GitHub):** source of truth for notes.

## 3. Key flows
### 3.1 Short chat
1. App `POST /api/chat` with messages + JWT.
2. Server verifies user, loads memories + top-k notes, builds system prompt.
3. `streamText` (or short graph piped via adapter) → UI message stream → `useChat`.
4. On finish: persist messages; emit `chat/completed` to Inngest for memory extraction.

### 3.2 Long/background task
1. Chat or button creates `agent_runs` row (`queued`) and sends `agent/run.requested`.
2. Inngest function executes graph node-by-node in `step.run`s; each node writes `run_events`.
3. App polls or subscribes (Supabase Realtime, verify) to `run_events` for a live timeline.
4. Completion posts a result message and optionally a canvas.

### 3.3 Human approval
1. Tool flagged `requires_approval` (or graph hits `interrupt()`).
2. Run state → `awaiting_approval`; `approvals` row created; push notification optional.
3. User taps Approve/Deny → `POST /api/approvals/:id` → Inngest event `approval/decided`.
4. Function resumes graph with `Command({ resume })`; deny path lets the agent re-plan.
5. Approvals expire after a timeout (default 24 h) and are treated as denied.

### 3.4 Memory
- Short-term: thread messages + checkpointer state.
- Long-term: after each conversation, Inngest asks the model to extract facts/preferences/decisions → dedupe against existing → upsert `memories` with embedding.
- Retrieval: top-k memories (vector) injected into the system prompt each turn.

### 3.5 Notes / second brain
1. Obsidian Git pushes vault to GitHub; webhook → `/api/webhooks/github` → Inngest `vault/changed`.
2. Function fetches changed `.md` files, parses frontmatter + `[[wikilinks]]`, chunks by heading, embeds, upserts `notes`, `note_chunks`, `note_links`.
3. Agent tools `search_notes`, `read_note`, `write_note` (writes commit to the repo; `write_note` requires approval by default).

### 3.6 MCP store
1. User taps Add on a server (`mcp_servers` registry).
2. If OAuth/API key needed: flow completes at `/api/mcp/oauth/callback`; credentials encrypted (AES-256-GCM) → `mcp_connections`.
3. User enables the server for an agent (`agent_mcp_tools`, with per-tool approval flags).
4. At run start, server decrypts credentials server-side, connects, lists tools, filters by allow-list, adds to the graph.

### 3.7 Canvas
Agent calls `render_canvas(spec)` → zod-validated → saved in `canvases` → returned in the message as a tool part → Expo renders from the component catalog. Data-bound components reference a saved data source so refresh needs no LLM call.

### 3.8 Model routing
Every LLM call (chat route, graph nodes, memory extraction, canvas refresh) goes through `getModel(id)` / `withFallback(ids)`. Registry entries declare capabilities and `private_ok`. Order of operations: capability check → call → on 429/5xx retry once → next fallback → log to `provider_usage`. Defaults: chat and agents on Google; cheap/fast steps (routing, summaries) may use Groq; OpenRouter is the long-tail and last-resort provider. Mistral, DeepSeek, Hugging Face and Cohere are selectable per chat/agent and join the fallback chain as soon as their keys are configured. Embeddings are pinned to one model.

### 3.9 Pause / resume / sleep
1. `POST /api/runs/:id/pause` sets `agent_runs.status = 'paused'` (cascading to unfinished supervisor children). Every graph node is wrapped in an `assertRunActive` boundary, so execution stops at the next node boundary — control flow, not failure; the Inngest step returns `{status:"paused"}` normally.
2. `POST /api/runs/:id/resume` emits `run/resumed` → `resumeExecution`: `beginResume` flips `paused → running` (re-entrant), then `invoke(null)` continues from the Postgres checkpoint (only the stopped node re-runs; an empty thread falls back to an input invoke). A run paused while parked on an undecided approval restores `awaiting_approval` instead of invoking — `invoke(null)` would resume the interrupt with an undefined value and the tool gate would read the still-pending row as denied.
3. `POST /api/agents/:id/sleep` sets `agents.sleeping`, pauses the agent's active runs, and makes `POST /api/agents/run` return 409. `POST /api/agents/:id/wake` clears the flag and re-emits `run/resumed` for the agent's paused runs plus paused supervisors waiting on its children.
4. `POST /api/runs/:id/cancel` uses the same boundaries and cascades the same way; a cancelled or finished run cannot be resurrected (resume is idempotent and bails).

### 3.10 Skills (Phase 8)
1. A skill is a markdown file with frontmatter in the GitHub vault at `skills/<slug>/SKILL.md` (vault = source of truth, Supabase = index).
2. Vault sync (`vault/changed`) parses the frontmatter (`name`, `description`, optional `tools[]`) and upserts the `skills` row — no chunking or embedding.
3. The agent's system prompt carries only **name + description** for each assigned skill; the body is fetched on demand by the `load_skill` tool, which only accepts skills assigned to the current agent.
4. A loaded skill's `tools` list can only **narrow** the offered tool set (intersection of current ∩ available ∩ declared) — it never grants a tool.
5. The app's Skills screen writes through the API, which recomposes and commits the file to the vault (user-initiated → no approval).

### 3.11 Productivity (Phase 9)
1. Tasks, task lists and calendar events live in Supabase with **soft delete** (`deleted_at`) and an explicit `created_by` (`user` / `agent` / `suggested`) plus `source_run_id`.
2. Recurrence is stored as an RRULE and **expanded on read** (never materialised). The expansion is anchored to the item's start instant so a weekly rule keeps its time of day in the user's timezone.
3. Agent tools (`create_task`, `list_tasks`, `update_task`, `complete_task`, `delete_task`, `create_event`, `list_events`, `update_event`, `delete_event`, `find_free_slots`) share the normal tool gate: create/list/complete never need approval, edits need approval only for `created_by='user'` rows, deletes always do.
4. `extractMemories` no longer stores tasks as memories — a detected task becomes a `created_by='suggested'` row the app shows as a suggestion to accept or dismiss.
5. Reminders: the `reminder/tick` cron (every minute) computes due task/event reminders, claims them in `reminder_log` (unique `(item_type, item_id, remind_at)`) and only then sends the Expo push — so a reminder fires at most once, and a failed delivery releases the claim for the next tick.

### 3.12 Routines (Phase 10)
1. A routine is a scheduled prompt bound to an agent and a thread. The agent proposes it (`create_routine`) with a **structured** schedule — never a cron string; the server converts it to an RRULE in the user's timezone and computes the next occurrences.
2. The proposal lands as a `data-routine-proposal` UI part (like `data-approval` / `data-canvas`). Nothing recurring starts until the user confirms (`POST /api/routines/:id/activate`).
3. A single `routine/tick` cron (every minute) picks up `status='active' AND next_run_at <= now()`, creates the `agent_runs` row (unique `(routine_id, scheduled_for)` → idempotent), inserts a trigger message in the bound thread, advances `next_run_at` and emits `agent/run.requested`.
4. The run posts its result as a normal assistant message in the same thread, and the app is notified by an Expo push that deep-links to that chat. The user can reply in the thread and the agent can `update_routine`.
5. Guardrails: overlapping runs are skipped (with a note in the thread), missed runs fire once (never backfilled), one-shot routines complete after firing, and three consecutive failures auto-pause the routine with an explanation in the chat.
6. Approvals follow the routine's `approval_mode`: `queue` parks the run in the normal approval gate (24 h expiry), `deny` reuses `approvalMode: "deny"` (the policy also survives a resume).

## 4. Security model
- Single allowed user; every API route verifies the Supabase JWT and `ALLOWED_USER_ID`. RLS on all tables as defense in depth.
- Secrets only in Vercel env; MCP credentials encrypted at rest; decrypted only server-side at run time.
- **Prompt injection:** treat all web content, files, and MCP tool descriptions/results as untrusted. Sensitive tools (send, delete, pay, write notes, push to repo) require approval by default. Never let tool output change the tool allow-list.
- Canvas actions are a fixed enum; no eval, no model-supplied code. WebView HTML is sandboxed (no network, no native bridge).
- Context derived from your notes/memories is sent only to models marked `private_ok`. Treat free tiers of any provider as possibly logged/trained on unless its terms say otherwise (verify).
- Rate-limit endpoints; cap per-run steps and tokens to protect free quotas.

## 5. Failure handling
Retries with backoff (Inngest); model fallback on 429; run marked `failed` with error in `run_events`; idempotency keys on side-effecting tools; max-step guard in every graph.
