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
- **Expo client:** chat, canvas renderer, notes, agents, groups, MCP store, approvals. Holds only the user session.
- **Next.js API:** authenticates JWT, runs short chats, enqueues Inngest events, serves data endpoints.
- **Agent runtime:** LangGraph graph per agent; Postgres checkpointer; tools = built-in + MCP.
- **Group runtime:** a separate checkpointed `route → agent_turn → route → … → finalize` graph that runs member turns as sequential child runs of the existing single-agent graph. It does not replace or modify the Supervisor graph.
- **Inngest functions:** run graphs in durable steps, cron monitors, memory extraction, vault sync, canvas refresh.
- **Supabase:** system of record for chats, runs, groups, canvases, MCP config; index for notes.
- **Web provider dashboard:** Supabase-authenticated control surface; provider catalog fetches happen server-side and catalog availability is persisted in Supabase.
- **Vault (GitHub):** source of truth for notes.

## 3. Key flows
### 3.1 Short chat
1. App `POST /api/chat` with messages + JWT.
2. Server verifies user, resolves the authoritative thread agent, loads memories + top-k notes, and builds the system prompt.
3. The server loads the agent's enabled MCP runtime and binds executable ordinary-chat declarations separately from the durable graph's non-executing declarations.
4. `streamText` → UI message stream → `useChat`. Approval-required MCP calls stop at a signed inline approval request; the client preserves the signature and sends only its decision, and the server verifies it before execution.
5. On finish: persist the UUID-backed assistant message; emit `chat/completed` to Inngest for memory extraction. An approval continuation updates the same assistant message rather than duplicating the turn.

### 3.2 Long/background task
1. Chat or button creates `agent_runs` row (`queued`) and sends `agent/run.requested`. A client-supplied `idempotency-key` (UUID) makes the start retry-safe: the key is unique per user, and a repeated request is answered with the run that already owns it instead of starting a second task.
2. Inngest function executes graph node-by-node in `step.run`s; each node writes `run_events`.
3. App polls or subscribes (Supabase Realtime, verify) to `run_events` for a live timeline.
4. The answer is written to the run row first (a strict write), then a separate idempotent step publishes it into the conversation (message id = run id). A failed publish is retried instead of silently dropped, and it never re-runs the agent.
5. A task started on an existing thread continues that conversation: the server snapshots the earlier turns (bounded) into `agent_runs.thread_context` and the graph renders them into the plan and act prompts.

### 3.3 Human approval
1. Durable runs use the graph gate: a tool flagged `requires_approval` (or a graph `interrupt()`) moves the run to `awaiting_approval` and creates an `approvals` row.
2. User taps Approve/Deny → `POST /api/approvals/:id` → Inngest event `approval/decided`; the function resumes the graph with `Command({ resume })`. The deny path lets the agent re-plan, and approvals expire after a timeout (default 24 h).
3. Ordinary chat uses the AI SDK's inline approval flow instead. The server signs the approval request with the server-only `TOOL_APPROVAL_SECRET`; the client returns only its decision, while the server verifies the signature and approved input before executing the MCP call.
4. The signature alone does not say *where* an approval may be used, so every issued approval also gets a server-side grant (`chat_approval_grants`): user, thread, agent, MCP connection, tool, input digest, expiry. The tool's `execute` callback consumes the grant atomically before the MCP call, so an approval is one execution — never replayed, never moved to another conversation, and never valid after expiry or after the connection changed. A denial closes the grant.

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
4. At ordinary-chat or durable-run start, the server decrypts credentials server-side, resolves the agent-scoped connected attachment and enabled cached tools, applies per-agent permissions, and exposes the resulting tool runtime.
5. Durable runs keep a non-executing shared declaration and apply their run-backed gate. Ordinary chat binds a separate executable declaration and applies signed inline approval; neither path exposes an MCP declaration that bypasses its configured policy.

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

### 3.13 Agent groups and handoff (Phase 11)
1. A group is a user-owned collection of agents with one required lead, a `handoff` or `roundtable` mode, and bounded hop/token/depth limits. A group thread is durable; a user message or `@agent` mention starts a group parent run, otherwise the lead starts. A group holds at most 12 members, counting the lead.
2. The group parent graph routes between members. Each `agent_turn` creates one sequential child run of the existing single-agent graph, so the member keeps its own model, tools, skills, and approval policy. `handoff_to` persists a handoff marker and ends that child turn; `ask_agent` returns a consult answer; `post_to_group` writes visible progress. The group tools stay attached in every round of the member turn.
3. Caller identity comes from the child run context, never from model arguments. The server resolves the requested target against the group's membership before executing a handoff or consult. Membership is replaced in one transaction, so a reader never sees a half-replaced group.
4. The parent parks as `awaiting_approval` while a member child is parked. After approval, the child resumes from its checkpoint and the parent continues from its own checkpoint. On resume the server re-reads the live group and re-derives the acting member and its privacy policy from the run row — never from the persisted, editable `group_context`.
5. Each member receives a compact handoff brief plus a bounded rolling group summary, never the full transcript. Guardrails stop routing on excessive hops, A→B→A→B ping-pong, token-budget exhaustion, or excessive nested-ask depth; the lead then finalizes from the evidence that exists. The rolling summary is persisted on the parent run, so a follow-up in the same conversation continues from it.
6. If the target model's registry entry is not `private_ok`, the server removes note/memory-derived context and strips tools that can retrieve notes or memories. Private-safe group turns and consults use a Google-only fallback chain to prevent cross-provider leakage.
7. The privacy boundary is the caller's policy, not the prose it wrote: a private-capable member may not hand work or a question to a non-private member, because a copied private fact is indistinguishable from ordinary text. Such a handoff or consult is refused rather than sanitised after the fact.
8. One live parent run per group: a second one is refused (409), and a group with a live run cannot be deleted (409). The ordinary chat route refuses a group thread (409 `group_thread`) — group messages are group runs, never a chat stream.
9. Token usage is cumulative: a run that parks on an approval keeps what it already spent, and the resume adds to it. Consult tokens are charged to the member turn and therefore to the group's cumulative budget.

### 3.14 Persistent dashboards (Phase 13)
Dashboards are user-owned workspaces separate from transient canvases. A dashboard row stores metadata/layout/version; child widget rows store validated Canvas-compatible config, data-source binding, position and size; immutable version rows store full snapshots. Dashboard APIs verify the caller and explicitly scope service-role queries. RLS independently scopes dashboard rows by `user_id` and child rows through the owning dashboard.

Phase 13.2 adds global agent tools. The runtime derives user/run/agent identity from the run row, verifies dashboard ownership on each operation, and uses the standard approval gate for widget removal. `refresh_dashboard` creates a durable refresh request and emits `dashboard/refresh.requested`; an Inngest worker fetches only configured sources, makes no LLM call, and records per-widget outcomes. A shared, Zod-validated mapping layer converts normalized source rows into existing Canvas widget config (stat/count or sum, chart/grouped sum, table rows, list items, markdown summary). It has no eval or model-provided expressions. A successful subset is committed as one new dashboard version while the worker preserves the latest layout and applies results only where the widget ID and binding still match. Failed widgets retain their prior values. No successful changes means no version bump. Refresh work is rate-limited to 10 requests per dashboard per hour.

Agents use canvases for one-off reports and visual answers. They use dashboards for explicitly requested persistent views and ongoing monitoring, and should update an existing dashboard when appropriate instead of creating duplicates. Data must come from configured sources or supplied evidence; agents label sample values and return the dashboard ID and destination after creation. Chat-inline canvas presentation is a separate Phase 13.3 slice.

### 3.15 Agent run notifications
Top-level, non-routine runs send an Expo push when they succeed or fail, including runs completed through approval or resume. The notification opens the run timeline. Routine runs keep their existing routine-specific push; nested supervisor/member runs do not notify separately. Push delivery is best-effort and never changes the run outcome.

## 4. Security model
- One app account; Supabase Auth accepts email/password and a database trigger rejects additional users. Every API route verifies the Supabase JWT; RLS and explicit `user_id` filters scope data.
- Secrets only in Vercel env; MCP credentials encrypted at rest; decrypted only server-side at run time.
- **Prompt injection:** treat all web content, files, and MCP tool descriptions/results as untrusted. Sensitive tools (send, delete, pay, write notes, push to repo) require approval by default. Never let tool output change the tool allow-list. Ordinary-chat MCP approval requests are HMAC-signed server-side; the decision may authorize only the exact signed tool call and input, and a server-side grant makes that authorization single-use and bound to the user, thread, agent and MCP connection it was issued for.
- Canvas actions are a fixed enum; no eval, no model-supplied code. WebView HTML is sandboxed (no network, no native bridge).
- Dashboard widget configs and source mappings are Zod-validated and bounded; no generated JavaScript or expressions run. Agent dashboard tools derive owner/agent/run IDs from trusted server context; widget removal uses approval. Refresh queries only configured sources and preserves old values for failed widgets.
- Context derived from your notes/memories is sent only to models marked `private_ok`. Treat free tiers of any provider as possibly logged/trained on unless its terms say otherwise (verify). The same rule applies to group handoffs and consults: a non-private target receives neither private context nor note/memory retrieval tools, and a private-capable member may not hand that work to a non-private member at all.
- Group targets are validated against the group's membership on the server; the calling agent is read from run context, never trusted from model arguments. Membership and privacy are re-validated live when a parked run resumes. Service-role queries explicitly scope groups, memberships, threads, messages, and runs to the owning user.
- Rate-limit endpoints; cap per-run steps and tokens to protect free quotas. Group runs also cap hops, ping-pong cycles, nested asks, and total group tokens.

## 5. Failure handling
Retries with backoff (Inngest); model fallback on 429; run marked `failed` with error in `run_events`; idempotency keys on side-effecting tools; max-step guard in every graph.
