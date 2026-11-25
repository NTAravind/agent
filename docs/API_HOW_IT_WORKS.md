# How the API works

A walkthrough of the Next.js API (`apps/api`) as implemented today. Shared request/response contracts live in `packages/shared`. The product spec (`docs/spec/API_SPEC.md`) is the route catalog; this file explains the **runtime**.

Base URL is `EXPO_PUBLIC_API_BASE_URL`. Almost every route requires `Authorization: Bearer <Supabase JWT>`. `requireUser()` verifies the JWT with the anon client; data is then scoped by `user_id` through the service-role client. Errors look like `{ "error": { "code": string, "message": string } }`.

```
Expo ── JWT ──► Next.js API
                  ├─ POST /api/chat          short, streaming, AI SDK tools
                  ├─ POST /api/agents/run    durable LangGraph via Inngest
                  ├─ CRUD (tasks, notes, memories, agents, MCP, …)
                  └─ /api/inngest            background jobs + cron
                         │
                         ▼
              Supabase Postgres + pgvector
              GitHub vault (notes source of truth)
              LLM providers (via the model registry)
              MCP / Composio (encrypted credentials)
```

Two conversation modes never mix:

| Mode | Entry | Runtime | Typical tools |
|---|---|---|---|
| **Ordinary chat** | `POST /api/chat` | Vercel AI SDK `streamText`, max ~6 tool rounds | notes/memory **read + save**, web, skills, routines, agent MCP |
| **Task / group / routine run** | `POST /api/agents/run` (or cron) | LangGraph checkpointed in Postgres, executed by Inngest | full tool set including writes, tasks, calendar, canvas, MCP |

Group threads are **not** chat. `POST /api/chat` returns **409** `group_thread`. Group messages go through `/api/agents/run` with a `groupId`.

---

## 1. Auth and identity

1. The mobile app holds only the Supabase session (SecureStore).
2. API routes call `requireUser(request)` (`apps/api/lib/auth.ts`).
3. A DB trigger on `auth.users` keeps the app to a **single account**.
4. Secrets stay on the server (`GOOGLE_GENERATIVE_AI_API_KEY`, `ENCRYPTION_KEY`, `TOOL_APPROVAL_SECRET`, GitHub vault token, Composio, …). Never in `EXPO_PUBLIC_*`.

Unauthenticated exceptions: GitHub webhook, MCP OAuth/Composio callbacks, Inngest.

---

## 2. Chat (`POST /api/chat`)

Implementation: `apps/api/app/api/chat/route.ts`, streaming in `lib/chat/stream.ts`, prompt in `lib/chat/system-prompt.ts`.

### Request

Body (Zod `ChatRequestSchema`): `{ threadId?, messages, agentId?, model?, attachments?, tz? }`.

### What happens on each turn

1. **Auth.**
2. **Group guard.** If the thread has `group_id`, abort 409 `group_thread`.
3. **Agent scope.** The thread’s persisted `agent_id` wins. A different `agentId` is 409 `agent_mismatch`. An unknown agent is 404. A thread with no agent yet can be bound on first use (`bindThreadToAgent`).
4. **Model.** Requested id, else the dashboard default, else `DEFAULT_MODEL_ID`. The id must be **mobile-enabled** (`primeMobileModel`); otherwise 400 `model_unavailable`.
5. **MCP runtime.** `loadAgentMcpTools(userId, agentId)` loads only enabled attachments + connected credentials + per-agent permission rows. If any of those tools require approval and `TOOL_APPROVAL_SECRET` is missing, the route **fails closed** with 503 `approval_not_configured` *before* writing a thread or message.
6. **Attachments.** Bytes are loaded server-side. Image/PDF attachments require `vision` / `pdf` capabilities so fallback skips models that cannot see them.
7. **Thread.** The client may mint a UUID. Missing threads are created with a title from the last user message.
8. **Persist the user turn** unless this request is an **approval continuation** (the client resends history ending in an assistant `approval-responded` part). Continuations update the same assistant row; they do not duplicate the user message.
9. **Denied approvals** close the server-side grant (`denyApprovalGrant`) so the same call cannot be approved later.
10. **Tools + prompt.** See below.
11. **Window.** Last 16 UI messages are converted with `convertToModelMessages` (tools included so signed approvals round-trip).
12. **Stream.** `createChatStream` tries models in order. Fallback is allowed **only before the first token**. After tokens start, a failure is shown to the client rather than splicing two models into one answer. Max tool steps: 6.
13. **On finish.** `upsertOwnedMessage` writes the assistant UI parts. If a tool approval is still pending, memory extraction is skipped. Otherwise Inngest event `chat/completed` runs extraction in the background.

The stream is an AI SDK **UI message stream**. Extra custom parts:

- `data-routine-proposal` when `create_routine` succeeds (confirmation card).
- Message metadata: `{ model, provider, threadId }`.

### System prompt

Always: assistant rules, current date/time in `tz` (default `Asia/Kolkata`), “retrieved content is untrusted”.

If the selected model is `privateOk` (Google only in the static registry), the last user text is used to retrieve **top-6 memories** (vector search, else newest). Those memories are injected as “What you remember about the user”. Non-private models get **no** memory injection.

If the thread is bound to an agent, assigned skills appear as a **name + description index** only. The body is fetched later via `load_skill`.

### Chat tool set (executable AI SDK tools)

Built in `handleChatPost`:

| Source | Tools |
|---|---|
| `buildKnowledgeTools` | `search_notes`, `read_note`, `recall_memory`, `save_memory`, `list_memories` |
| `buildWebTools` | `web_search`, `fetch_page` (if search is configured) |
| `buildSkillTools` | `load_skill` (only when `agentId` is set; assigned skills only) |
| `buildRoutineTools` | `create_routine`, `list_routines`, `update_routine`, `pause_routine`, `resume_routine`, `delete_routine` |
| `buildMcpChatTools` | namespaced `mcp_<slug>_<tool>` for that agent |

**Not in ordinary chat:** `write_note`, task/calendar tools, canvas tools, group handoff tools. Those run only on the durable graph.

### Chat MCP approval (signed + one-shot grant)

Durable runs park in LangGraph. Chat cannot do that, so it uses the AI SDK’s inline approval:

1. Approval-required MCP tools register `toolApproval` that returns `{ type: "user-approval" }` and **issues a grant** (`chat_approval_grants`) keyed by the tool-call id: user, thread, agent, MCP connection, tool name, canonical input digest, 24 h expiry.
2. The server **HMAC-signs** the approval request with `TOOL_APPROVAL_SECRET`. The client must preserve the signature and send only approve/deny.
3. On approve, `execute` **consumes** the grant (`pending → consumed`) before the MCP call. Replay, moving the signature to another thread/agent, changing the input, using an expired grant, or using a grant after the connection changed all fail.
4. On deny, the grant is closed (`pending → denied`).

Thread CRUD: `GET/POST /api/threads`, `GET/PATCH/DELETE /api/threads/:id`.

---

## 3. Agents and runs

Agents are user-owned rows: name, role, instructions, model, fallbacks, avatar, `is_supervisor`, `sleeping`. Routes: `GET/POST /api/agents`, `PATCH/DELETE /api/agents/:id`, avatar upload, `POST .../sleep` and `.../wake`.

### Starting a task: `POST /api/agents/run`

Implementation: `apps/api/app/api/agents/run/route.ts` → `createRun` → Inngest `agent/run.requested` → `executeRun`.

Body (ordinary): `{ goal, threadId?, model?, agentId?, inline?, tz? }`.  
Body (group): `{ groupId, goal, threadId?, inline?, tz? }` — **not** mixed with `agentId`/`model` (400).

Flow for an ordinary Task Mode run:

1. Resolve thread + agent (`resolveTaskThreadScope`). Existing thread agent is authoritative (409 `agent_mismatch`). Unscoped threads bind to the requested or default agent.
2. **409** if that agent is **asleep**.
3. Optional header `idempotency-key` (UUID). Unique per user on `agent_runs`. A retry returns the existing run with `idempotent: true` and **does not** start a second graph.
4. Snapshot earlier thread turns (last 12, ~1500 chars each) into `agent_runs.thread_context` **before** inserting the current user message, so the task never answers itself.
5. Create `agent_runs` (`queued`), insert the user message with `messages.run_id = runId`.
6. Unless `inline: true`, emit Inngest. If dispatch fails, the run is marked **failed** (not left queued forever).
7. Response `{ runId, status, threadId, agentId }` (group runs also return `groupId`). Status 202 when queued.

The client polls `GET /api/runs/:id` (status, result, full `run_events` timeline, pending approvals, children). There is no separate SSE route for run events.

### Dispatch (`lib/agent/dispatch.ts` + `execute.ts`)

| Kind | When | Graph |
|---|---|---|
| `group` | run has `group_id` and is the parent | `route → agent_turn → … → finalize` |
| `group-member` | child of a group parent | **always** single-agent graph (even if the member is a supervisor) |
| `supervisor` | agent `is_supervisor` | `delegate → fan_out → verify → merge` |
| default | everything else | single-agent `plan → act ⇄ tools → observe → finalize` |

### Single-agent graph (`lib/agent/graph.ts`)

Checkpointed with LangGraph Postgres, thread id = run id.

```
START → plan → act_llm ⇄ tool_gate → tool_exec → act_llm
                      ↘ observe → (continue | self_correct | finalize) → END
```

- **plan** — cheap model (`FAST_MODELS`, Gemini Flash Lite first) writes step list.
- **act_llm** — `ACT_MODELS` (default + fallback). Tool **declarations have no `execute`**. The model only proposes calls.
- **tool_gate** — built-in sensitive / conditional / MCP approval. First gated call creates an `approvals` row, sets run `awaiting_approval`, and `interrupt()`s. Resume reads the **DB row**, not the interrupt payload. `approvalMode: "deny"` (supervisor children, some routines) auto-denies instead of parking.
- **tool_exec** — `executeToolCall` / MCP `runtime.execute`.
- **observe** — decide continue / revise / finish.
- **finalize** — strongest chain (`FINAL_MODELS`). Result is written to the run row **strictly**; a failed write fails the step.

Every node is wrapped in `assertRunActive`. Pause/cancel/sleep stop at the **next node boundary**. That is control flow, not an Inngest failure (`{ status: "paused" }`), so `onFailure` does not fire.

Tool-set heuristic: first 2 act rounds get the full set; later rounds keep a **core** set (`web_search`, `fetch_page`, `search_notes`, `read_note`, `load_skill`) plus **group tools** if this is a member turn. `load_skill` may only **narrow** tools (intersection). Group tools are never narrowed away. Last round has no tools (forced prose).

After success, Inngest step `persist-run-transcript` writes the assistant message with **message id = run id** (idempotent). Group/child/routine runs use their own persistence.

### Supervisor graph

`delegate` produces 2–4 briefs on distinct specialists → `fan_out` starts child runs (`parent_run_id`) in parallel with `approvalMode: "deny"` → `verify` uses a **different provider** than the workers → `merge` synthesizes. Fewer than 2 specialists falls back to the single-agent graph.

### Pause, resume, sleep, cancel

- `POST /api/runs/:id/pause` / `cancel` — cascade to unfinished supervisor children; 409 if already finished.
- `POST /api/runs/:id/resume` — 202, event `run/resumed`. `invoke(null)` continues from checkpoint. If paused while an approval is still pending, status is restored to `awaiting_approval` instead (otherwise `invoke(null)` would treat the interrupt as denied).
- Sleep pauses the agent’s active runs (and supervisors waiting on them) and rejects new tasks (409). Wake re-emits `run/resumed`.

### Approvals (durable)

`GET /api/approvals?status=pending`, `POST /api/approvals/:id` with `{ decision: "approve"|"deny", edits? }` → `approval/decided` → graph resume. TTL 24 h; expiry = deny.

---

## 4. Tool calling

There are **two** tool layers on purpose.

### 4.1 Chat: AI SDK `tool({ execute })`

The model calls the tool; the SDK runs `execute` in-process (except approval-gated MCP, which waits for a signed decision + grant consume). Suitable for short, reversible work.

### 4.2 Runs: declarations + gate + execute

`lib/agent/tools.ts`:

- `declarations` — schemas only, given to `act_llm`.
- `executeToolCall` — real implementations, only after `tool_gate`.

This is what makes `interrupt()` possible: the LLM cannot run `write_note` itself.

### Built-in tools (durable graph)

| Tool | Approval | Notes |
|---|---|---|
| `web_search`, `fetch_page` | no | Page text is untrusted |
| `search_notes`, `read_note` | no | Hybrid search / vault path |
| `recall_memory`, `list_memories`, `save_memory` | no | |
| `write_note` | **always** | Commits markdown to GitHub vault |
| `render_canvas`, `update_canvas` | no | Zod-validated canvas spec |
| `load_skill` | no | Assigned skill body; may narrow tools |
| `create_task`, `list_tasks`, `complete_task` | no | `created_by='agent'`, `source_run_id` |
| `update_task` | if target `created_by='user'` | Unknown/missing target → approve |
| `delete_task` | **always** | Soft delete |
| `create_event`, `list_events`, `find_free_slots` | no | RRULE expanded on read |
| `update_event` | if user-created | same rule as tasks |
| `delete_event` | **always** | Soft delete |
| `create_routine` … `resume_routine` | no | Draft until user activates |
| `delete_routine` | **always** | |
| `handoff_to`, `ask_agent`, `post_to_group` | no | Group member turns only; caller from run context |
| MCP tools | per-tool flag | Default **yes**; namespaced |

`SENSITIVE_TOOLS`: `write_note`, `delete_task`, `delete_event`, `delete_routine`.  
`CONDITIONAL_APPROVAL_TOOLS`: `update_task`, `update_event`.

Dashboard **HTTP** APIs exist (`/api/dashboards`). Agent tools named `create_dashboard` / widget CRUD are specified but **not wired into `lib/agent/tools.ts` yet**.

Tool results (notes, web, MCP) are treated as **data**, never as instructions that can change the allow-list.

---

## 5. Tasks (and calendar)

HTTP: `lib/productivity.ts` maps camelCase API ↔ snake_case rows.

### Lists

- `GET/POST /api/task-lists`
- `PATCH/DELETE /api/task-lists/:id` (soft delete)

### Tasks

- `GET /api/tasks?listId&status&from&to` — open / done / cancelled, not deleted, cap 200
- `POST /api/tasks` — `{ listId, title, notes?, status?, priority?, dueAt?, dueAllDay?, remindAt?, rrule?, parentId?, createdBy? }`
- `GET/PATCH/DELETE /api/tasks/:id` — delete is **soft** (`deleted_at`)

`createdBy`: `user` | `agent` | `suggested`. Agent tools always write `agent` + `source_run_id`. Memory extraction writes **suggested** tasks (accept/dismiss in the app), not memory rows of kind `task`.

Recurrence is stored as RRULE and **expanded on read**, never as occurrence rows.

Calendar is the same pattern: `/api/events`, expansion for `from`/`to`, soft delete.

Reminders: Inngest cron `reminder/tick` (every minute) claims a unique `(item_type, item_id, remind_at)` in `reminder_log`, then Expo push. Failed send releases the claim.

---

## 6. Notes (second brain)

**Source of truth:** private GitHub repo (Obsidian vault). **Index:** Supabase `notes`, `note_chunks`, `note_links`.

### Ingest

1. GitHub push → `POST /api/webhooks/github` (HMAC) → Inngest `vault/changed`.
2. `syncVault` fetches changed `.md`, parses frontmatter + `[[wikilinks]]`, chunks by heading, embeds, upserts.
3. Manual: `POST /api/notes/sync`.
4. `skills/**/SKILL.md` is indexed as skills (no chunking).

### Read / write HTTP

- `GET /api/notes?q=&k=` — list, or hybrid search when `q` is set
- `GET /api/notes/:path` — content + links + backlinks
- `PUT /api/notes/:path` — raw markdown (`text/markdown`), `putVaultFile`, index upsert. **User-initiated → no approval**
- `DELETE /api/notes/:path` — vault + index. User-initiated → no approval

The agent’s `write_note` tool **does** require approval. Human save in the app does not.

### Retrieval

`lib/knowledge/search.ts` → RPC `search_notes`: cosine similarity fused with full-text (RRF). Query embedding is 768-d Gemini (`gemini-embedding-001`). If embedding fails, lexical search still runs.

---

## 7. Memories

Tables: `memories` with embeddings.

### How they get there

After a **completed** chat (no pending approval), Inngest `chat-completed-memory` runs `extractMemories`:

1. Load up to 40 messages. Skip routine trigger messages (they are not the user speaking).
2. Cheap model extracts `{ kind: fact|preference|decision|task, content, dueAt? }`.
3. Facts / preferences / decisions are **deduped and upserted** with embeddings.
4. Detected **tasks** become `tasks` rows with `created_by='suggested'`, not memories.

Agents can also `save_memory` during chat or a run.

### How they get used

- Chat system prompt: vector search on the user message (private-ok models only), else newest 6.
- Tools: `recall_memory` (hybrid/vector), `list_memories`.
- HTTP: `GET /api/memories`, `DELETE /api/memories/:id` (forget).

`privateOk` is the privacy gate: note/memory-derived context is only sent to models marked safe (static registry: **Google only**). Group members whose model is not `private_ok` lose note/memory tools and injected context; a private-capable member may not hand off to a non-private member.

---

## 8. MCP integrations

Catalog + connections + per-agent enablement. Remote MCP is **Streamable HTTP only** (no stdio).

### Catalog

- `GET /api/mcp/servers` — listings with `connected` flag (`?all=1` for admin, includes disabled)
- Admin CRUD on `/api/mcp/servers` and `/:id`
- `GET /api/mcp/composio/catalog?q=&category=` — Composio toolkits merged with this user’s connection state (`configured: false` if no `COMPOSIO_API_KEY`)

Providers (`lib/mcp/providers/index.ts`):

| `provider` | Adapter |
|---|---|
| `direct` | Vendor-hosted Streamable HTTP; auth none / api_key / pat / oauth2 |
| `composio` | Composio-managed sessions (`COMPOSIO_API_KEY`) |
| zapier / apify | Rejected until free tiers are verified |

Connecting with `{ toolkit }` materializes a `composio-<toolkit>` listing, then connects it.

### Connect

`POST /api/mcp/connections` `{ serverId | toolkit, apiKey? }`:

- Immediate `{ connectionId, serverId, status, toolCount }` when key-based.
- `{ authorizationUrl, connectionId, status: "pending" }` for OAuth / Composio hosted consent.

Callbacks:

- `GET /api/mcp/oauth/callback` — stores **AES-256-GCM** credentials, discovers tools, redirects `pacbot://mcp/:serverId?status=connected|error`
- `GET /api/mcp/composio/callback` — verify hosted sign-in; app may poll `POST /api/mcp/connections/:id/verify`

Also: list/delete connection, refresh, live tool list. Credentials never leave the server.

### Attach to an agent

`PUT /api/agents/:id/mcp` `{ connectionId, tools: [{ name, requiresApproval }] }` (also agent-server routes under `/api/mcp/agents/...`).

At **chat or run start**, `loadAgentMcpTools` / `loadMcpToolsForRun`:

1. Enabled `agent_mcp_servers` for that agent
2. Connections still `connected` for this user
3. Cached tools still enabled; apply `agent_mcp_tools` permission rows
4. Cap **20** MCP tools per run
5. Namespaced name: `mcp_<slug>_<tool>` so a remote tool cannot shadow `web_search` / `write_note`
6. Descriptions sanitized and size-capped; schemas via `jsonSchema()`

Risk (`lib/mcp/risk.ts`): MCP tools **default to approval**. Classification may lower that for clearly read-only tools (annotations + verb heuristics); it never marks a destructive tool as safe. Remote text is scanned, not obeyed.

Execute path:

- Chat: `buildMcpChatTools` adds `execute` + grant consume → `executeComposioTool` / `executeDirectTool`
- Graph: declarations stay non-executing; `tool_exec` calls `runtime.execute` after the gate

---

## 9. Provider models

Every LLM call goes through `apps/api/lib/models` — never a provider package from a route.

### Registry

Static entries in `lib/models/registry.ts`. App ids look like `google:gemini-3.6-flash`. `providerModelId` is what the vendor API expects.

| Constant | Value (current) |
|---|---|
| `DEFAULT_MODEL_ID` | `google:gemini-3.6-flash` |
| `DEFAULT_FALLBACK_ORDER` | `groq:gpt-oss-120b` → `google:gemini-3.8-flash` → `openrouter:gemini-3.8-flash` |
| `FAST_MODEL_ID` | `google:gemini-3.5-flash-lite` |

Graph chains:

- Plan / cheap steps: `FAST_MODELS` = lite + default + fallback
- Act: default + fallback
- Finalize: Gemini 3.8 Flash + default + fallback

`AGENT_MODELS_PREPEND` can prepend extra ids locally when a free tier is toasted.

### Providers and env

| Provider | Env | SDK |
|---|---|---|
| Google | `GOOGLE_GENERATIVE_AI_API_KEY` | `@ai-sdk/google` |
| Groq | `GROQ_API_KEY` | `@ai-sdk/groq` |
| OpenRouter | `OPENROUTER_API_KEY` | `@openrouter/ai-sdk-provider` |
| Mistral | `MISTRAL_API_KEY` | `@ai-sdk/mistral` |
| DeepSeek | `DEEPSEEK_API_KEY` | `@ai-sdk/deepseek` |
| Hugging Face | `HUGGINGFACE_API_KEY` | `@ai-sdk/huggingface` |
| Cohere | `COHERE_API_KEY` | `@ai-sdk/cohere` |

`getModel(id)` throws `unknown_model` or `provider_not_configured`. No silent swap to another model.

### Capabilities and privacy

Each entry: `tools`, `vision`, `structuredOutput`, `reasoning`, `pdf`, `contextWindow`, `privateOk`, `tier`.

`withFallback` / `createChatStream`: skip models that cannot meet `required` capabilities; on 429 / 5xx / timeout retry once then next id; log `provider_usage`.

**`privateOk`:** true only for Google in the static registry (other free tiers may log/train). Group private turns keep a Google-only fallback chain.

Notable registry quirks:

- `deepseek:deepseek-reasoner` — no tools / structured output
- Hugging Face ids are router models (`router.huggingface.co`)
- OpenRouter Gemini is **not** `privateOk` even though it is the same vendor model behind a proxy

### Live catalog vs static list

Admin dashboard:

- `GET /api/admin/models` — persisted catalog, key status, usage
- `POST /api/admin/models/refresh` — fetch Google / Groq / OpenRouter lists, upsert metadata
- `PATCH /api/admin/models` `{ models: [{ id, enabled }] }` — **mobile availability**

Mobile: `GET /api/models` returns only **enabled** catalog models, `available` (key present), default, fallback order, today’s usage. Chat refuses models that are not primed as mobile-enabled.

Settings: `PUT /api/settings/models` `{ defaultModel, fallbackOrder[] }` (see spec).

Dynamic catalog rows can be `registerRuntimeModel`’d per request so a freshly fetched id resolves.

### Embeddings (separate from chat)

Pinned: `gemini-embedding-001`, **768 dimensions**. Changing this requires re-embedding every note chunk and memory. Used by notes search, memory search, and extract/upsert.

---

## 10. Background jobs (Inngest)

Endpoint: `POST /api/inngest`.

| Trigger | What it does |
|---|---|
| `agent/run.requested` | `executeRun`; on success `persist-run-transcript`; routine outcome or push |
| `approval/decided` | Resume graph from tool gate |
| `run/resumed` | Continue paused run from checkpoint |
| `chat/completed` | Memory (+ suggested tasks) extraction |
| `vault/changed` | Full/partial vault reindex |
| cron `reminder/tick` | Due task/event Expo pushes |
| cron `routine/tick` | Fire due routines → new run + trigger message |
| canvas / dashboard refresh, monitor tick, keepalive | As specified |

Routines: chat `create_routine` saves a **draft** and emits `data-routine-proposal`. Nothing recurring starts until `POST /api/routines/:id/activate`. Tick is idempotent on `(routine_id, scheduled_for)`.

---

## 11. Related surfaces (short)

These are on the same API but not the core of this doc:

- **Skills** — vault `skills/<slug>/SKILL.md`, `/api/skills`, `PUT /api/agents/:id/skills`
- **Groups** — `/api/groups`, handoff/consult/post tools, privacy + hop/token guards
- **Canvas** — `/api/canvases`, `render_canvas` / `update_canvas`
- **Dashboards** — `/api/dashboards` CRUD, versions, refresh (agent dashboard tools not in the graph yet)
- **Files** — `/api/upload`, document process via Inngest
- **Push** — `/api/push-tokens`

---

## 12. Code map

| Concern | Where |
|---|---|
| Chat route | `apps/api/app/api/chat/route.ts` |
| Chat stream / fallback | `apps/api/lib/chat/stream.ts` |
| Chat MCP + grants | `apps/api/lib/mcp/chat-tools.ts`, `lib/chat/approval-grant.ts` |
| System prompt / memories | `apps/api/lib/chat/system-prompt.ts` |
| Task start | `apps/api/app/api/agents/run/route.ts` |
| Graph dispatch | `apps/api/lib/agent/execute.ts`, `dispatch.ts` |
| Single-agent graph | `apps/api/lib/agent/graph.ts` |
| Tool declarations + execute | `apps/api/lib/agent/tools.ts` |
| Approvals | `apps/api/lib/approvals.ts` |
| MCP load / namespacing | `apps/api/lib/mcp/tools-loader.ts` |
| MCP providers | `apps/api/lib/mcp/providers/` |
| Notes + memory search | `apps/api/lib/knowledge/search.ts` |
| Memory extract | `apps/api/lib/memory/extract.ts` |
| Tasks/events mapping | `apps/api/lib/productivity.ts` |
| Vault I/O | `apps/api/lib/vault/` |
| Model registry / resolve / fallback | `apps/api/lib/models/` |
| Shared Zod contracts | `packages/shared/src/` |
| Route catalog (source of truth for paths) | `docs/spec/API_SPEC.md` |
