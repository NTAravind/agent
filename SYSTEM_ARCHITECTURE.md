# Autonomous AI Agent Platform — System Architecture & Implementation Guide

> **Version:** 2.2  
> **Status:** Development blueprint (Phases 0–9 complete, Phase 10 pending)  
> **Audience:** Developers maintaining or extending the platform

---

## 1. System Overview

This is a **personal, single-user autonomous AI agent platform** with a Next.js API backend and Expo mobile client. The platform enables users to create agents that can:

- Browse the web and fetch pages
- Search and write to a personal Obsidian-style vault (GitHub-backed)
- Execute multi-step research tasks autonomously in the background
- Delegate work to specialist sub-agents (supervisor pattern)
- Use external MCP servers as dynamically discovered capabilities
- Render native dashboards ("canvases") from structured specs
- Remember facts, preferences, and decisions across conversations

### High-Level Architecture

```
┌─────────────┐     HTTPS (JWT)      ┌──────────────────┐
│   Expo App  │ ───────────────────► │  Next.js on      │
│  (Mobile)   │ ◄─────────────────── │  Vercel (API)    │
└─────────────┘   stream / poll      └────────┬─────────┘
                                              │
                    ┌─────────────────────────┼─────────────────────────┐
                    ▼                         ▼                         ▼
             ┌─────────────┐           ┌─────────────┐           ┌─────────────┐
             │   Supabase  │           │   Inngest   │           │  Providers  │
             │  Postgres   │           │  (Durable    │           │  (Google,   │
             │  + pgvector │           │   Execution)│           │   Groq,     │
             │  + Realtime │           │             │           │   OpenRouter,│
             │  + Storage  │           │             │           │   Mistral,  │
             │  + Auth     │           │             │           │   DeepSeek, │
             └──────┬──────┘           └──────┬──────┘           │   Cohere,   │
                    │                         │                  │   HuggingFace)│
                    ▼                         ▼                  └──────┬──────┘
             ┌─────────────┐           ┌─────────────┐                 │
             │    GitHub   │           │  MCP Servers│ ◄───────────────┘
             │  (Vault)    │           │  (Tools)    │
             └─────────────┘           └─────────────┘
```

### Key Design Principles

| Principle | Implementation |
|-----------|----------------|
| **Server owns intelligence, client owns pixels** | All model calls, tool execution, and agent logic run on the server; Expo only renders |
| **Durable by default** | Anything >~1 min runs in Inngest; never inside a chat request |
| **Approve before harm** | Sensitive tools (`write_note`, MCP tools flagged `requires_approval`) park the run until user decides |
| **Specs, not code** | Agents emit validated JSON (Canvas, tool args); never executable code |
| **Rebuildable** | Supabase is an index; GitHub vault is source of truth for notes |
| **Provider-agnostic** | 7 providers behind unified `getModel()` / `withFallback()` layer |
| **Privacy-aware** | `private_ok` flag gates note/memory context to Google models only |

---

## 2. Monorepo Structure

```
autonomous-ai/
│
├── apps/
│   ├── api/                    # Next.js 16 App Router (API routes, Inngest endpoint)
│   │   ├── app/api/            # Route handlers (/chat, /agents, /runs, /mcp, /canvases, ...)
│   │   ├── lib/
│   │   │   ├── agent/          # LangGraph graphs, state, checkpointer, runs, supervisor
│   │   │   ├── models/         # Provider registry, resolver, fallback, capability gate, usage
│   │   │   ├── mcp/            # Registry, connections, tools-loader, providers, security
│   │   │   ├── chat/           # Streaming, persist, system-prompt, attachments
│   │   │   ├── knowledge/      # Notes search, memory extraction, vault sync
│   │   │   ├── canvases/       # Canvas CRUD, validation, renderer components
│   │   │   ├── approvals/      # Approval lifecycle
│   │   │   ├── supabase/       # Server/admin clients
│   │   │   ├── inngest/        # Functions, events, client
│   │   │   ├── tools/          # Web search, fetch_page
│   │   │   └── vault/          # GitHub sync
│   │   └── package.json
│   │
│   └── mobile/                 # Expo SDK 58 + Expo Router
│       ├── src/app/            # File-based routing (tabs: chat, agents, canvas, notes, settings)
│       ├── src/components/     # Reusable UI (MessageBubble, Composer, AgentAvatar, CanvasRenderer, ...)
│       └── package.json
│
├── packages/
│   └── shared/                 # Zod schemas + shared types (imported as @agent/shared)
│       ├── src/
│       │   ├── agent.ts        # Agent, run, message types
│       │   ├── mcp.ts          # MCP server, connection, tool types
│       │   ├── models.ts       # Model registry entry, capabilities
│       │   ├── canvas.ts       # Canvas spec schema (Stat, Chart, Table, ...)
│       │   └── approval.ts     # Approval status types
│       └── package.json
│
├── db/
│   ├── apply.sql               # Full schema (run once)
│   └── migrations/             # Numbered migrations (0001–0013+)
│
├── docs/
│   └── spec/                   # Source-of-truth specifications
│       ├── MASTER_SPEC.md
│       ├── FEATURES.md
│       ├── TECH_STACK.md
│       ├── ARCHITECTURE.md
│       ├── DATABASE_SCHEMA.md
│       ├── API_SPEC.md
│       ├── UI_UX_SPEC.md
│       └── IMPLEMENTATION_PLAN.md
│
├── package.json                # Root workspace (npm workspaces)
├── pnpm-workspace.yaml
└── AGENTS.md                   # Next.js agent feedback block
```

**Install:** `npm install` from repo root.

---

## 3. Data Layer (Supabase Postgres)

### Schema Highlights

All tables use UUID PKs, `timestamptz`, FKs, and **Row Level Security** (`user_id = auth.uid()`). Service role bypasses RLS — server code must always filter by `user_id`.

```sql
-- Core tables (see db/migrations for full DDL)

-- Conversations
threads (id, user_id, agent_id, title, created_at, updated_at)
messages (id, thread_id, user_id, role, agent_id, model, parts jsonb, created_at)

-- Memory (long-term, cross-thread)
memories (id, user_id, kind[fact|preference|decision|task], content, source_thread_id, embedding vector(768), created_at)
-- HNSW index on embedding for vector search

-- Second Brain (GitHub vault index)
notes (id, user_id, path, title, frontmatter, content_hash, git_sha, updated_at, unique(user_id, path))
note_chunks (id, note_id, idx, heading, content, embedding vector(768), tsv tsvector)
note_links (from_note, to_path)

-- Agents & MCP
agents (id, user_id, name, avatar jsonb, role, system_prompt, model, fallback_models text[], config, is_supervisor)
mcp_servers (id, slug, name, description, instructions, provider, category, endpoint, auth_type, config, capabilities, icon_url, is_verified, is_free_tier, enabled)
user_mcp_connections (id, user_id, server_id, credentials_ciphertext, credentials_iv, credentials_tag, key_version, status, metadata)
agent_mcp_servers (id, agent_id, user_mcp_connection_id, enabled)
agent_mcp_tool_permissions (id, agent_id, mcp_tool_id, enabled, approval_required, risk_level)

-- Skills (progressive-disclosure instruction bundles; vault is source of truth)
skills (id, user_id, slug, name, description, body, tools text[], vault_path, git_sha, enabled, updated_at, unique(user_id, slug))
agent_skills (agent_id, skill_id, enabled)  -- PK (agent_id, skill_id); RLS joins through agents

-- Runs & Events
agent_runs (id, user_id, agent_id, thread_id, parent_run_id, goal, status[queued|running|awaiting_approval|succeeded|failed|cancelled], result, error, model, tokens_used, created_at, finished_at)
run_events (id bigserial, run_id, type[node_start|node_end|tool_call|tool_result|message|error], payload jsonb, created_at)
approvals (id, run_id, user_id, tool_name, args, reason, status[pending|approved|denied|expired], created_at, decided_at, expires_at)

-- Canvas
canvases (id, user_id, title, spec jsonb, data_sources jsonb, version, created_by_run, created_at, updated_at)

-- Productivity (Phase 9) — tasks, calendar, reminders
task_lists (id, user_id, name, sort, created_at, updated_at)
tasks (id, user_id, list_id, parent_id, title, notes, status[open|done|cancelled], priority,
       due_at, due_all_day, remind_at, rrule, reminded_at, completed_at,
       created_by[user|agent|suggested], source_run_id, deleted_at, created_at, updated_at)
calendar_events (id, user_id, title, description, starts_at, ends_at, all_day, tz, location,
                 rrule, exdates jsonb, reminders jsonb, created_by[user|agent|suggested],
                 source_run_id, ical_uid, deleted_at, created_at, updated_at)
push_tokens (id, user_id, expo_token unique, platform[ios|android], last_seen, created_at)
reminder_log (id, user_id, item_type[task|event], item_id, remind_at, sent_at,
              unique(item_type, item_id, remind_at))   -- idempotent reminder delivery

-- Provider Catalog & Usage
provider_models (provider, model_id, app_id, label, capabilities, context_window, tier, metadata, mobile_enabled, fetched_at)
provider_usage (id bigserial, user_id, provider, model, run_id, input_tokens, output_tokens, status, latency_ms, created_at)
```

### Retention Policy (500 MB free cap)
- Prune `run_events` and `provider_usage` >30 days
- Keep `agent_runs` summaries
- Truncate large tool outputs before storing
- Files only in Storage (buckets: `attachments`, `avatars`)

---

## 4. Model Layer (`apps/api/lib/models/`)

### 4.1 Registry (`registry.ts`)

Single source of truth for all models. Each entry:

```typescript
interface ModelRegistryEntry {
  id: string;                    // "provider:model-id" (app-level stable ID)
  provider: Provider;            // google | groq | openrouter | mistral | deepseek | huggingface | cohere
  providerModelId: string;       // ID the provider expects
  label: string;                 // Display name
  capabilities: {                // Feature flags
    tools: boolean;
    vision: boolean;
    structuredOutput: boolean;
    reasoning: boolean;
    pdf: boolean;
  };
  contextWindow: number;
  privateOk: boolean;            // Can receive note/memory context? (Google only)
  tier: "free" | "paid";
}
```

**Current defaults (2026-11-20):**
- Default: `google:gemini-3.6-flash` (3.8-flash has capacity issues on free tier)
- Fallback chain: `groq:gpt-oss-120b` → `google:gemini-3.8-flash` → `openrouter:gemini-3.8-flash`
- Fast model (routing/summaries): `google:gemini-3.5-flash-lite`
- Embeddings: `google:gemini-embedding-001` (768 dims, fixed)

### 4.2 Resolver (`resolver.ts`)

```typescript
// Lazy-initializes provider SDKs from env vars
function providerInstances(): ProviderInstance { ... }

// Returns AI SDK LanguageModel or throws typed error
export function getModel(id: string): LanguageModel { ... }
export function resolveModel(id: string): { entry; model } { ... }

// Checks if provider has API key configured
export function isProviderConfigured(provider: Provider): boolean
export function providersWithKeys(): Provider[]
```

**Env vars:** `GOOGLE_GENERATIVE_AI_API_KEY`, `GROQ_API_KEY`, `OPENROUTER_API_KEY`, `MISTRAL_API_KEY`, `DEEPSEEK_API_KEY`, `HUGGINGFACE_API_KEY`, `COHERE_API_KEY`

### 4.3 Capability Gate (`capability.ts`)

```typescript
// Throws if model lacks required capability
export function assertCapabilities(entry: ModelRegistryEntry, required: RequiredCapabilities): void
```

Prevents silent degradation — a request needing `vision` or `tools` will skip models that don't support it.

### 4.4 Fallback Chain (`fallback.ts`)

```typescript
export async function withFallback<T>(
  ids: string[],
  run: (model, entry) => Promise<T>,
  options: FallbackOptions
): Promise<FallbackResult<T>>
```

**Algorithm:**
1. For each model ID in order:
   - Skip if unknown or capability mismatch (logs `skipped`)
   - Skip if provider API key missing (logs `skipped`)
   - Call `run(model, entry)`
   - On retryable failure (429, 5xx, timeout): retry once with backoff
   - On non-retryable or exhausted retries: continue to next model
2. If all fail: throw `ModelLayerError` with full attempt log

**Usage tracking:** Every attempt writes to `provider_usage` (provider, model, tokens, status, latency).

### 4.5 Generate Helpers (`generate.ts`)

```typescript
// Streaming text with fallback
export async function generateTextWithFallback(options): Promise<{ text, modelId, result }>

// Structured output with fallback
export async function generateObjectWithFallback<SCHEMA>(options): Promise<{ object, modelId }>
```

Used by chat route, agent graph nodes, supervisor graph, memory extraction.

---

## 5. Chat Pipeline (`/api/chat`)

### Request Flow

```
POST /api/chat
  │
  ├─► requireUser(JWT) → user.id
  ├─► Validate body (ChatRequestSchema): { threadId?, messages[], model?, agentId?, attachments? }
  ├─► Resolve model: request.model → defaultMobileModel → DEFAULT_MODEL_ID
  │     └─► primeMobileModel() checks provider_models.mobile_enabled
  ├─► Thread: create or fetch (client generates threadId)
  ├─► Load attachments → check vision/pdf requirements
  ├─► Build model messages (last 16 messages + attachments)
  ├─► Persist user message
  ├─► Build tools:
  │     ├─► buildKnowledgeTools(userId, threadId) → search_notes, read_note, recall_memory, list_memories, save_memory
  │     ├─► buildWebTools() → web_search, fetch_page
  │     └─► buildSkillTools({ userId, agentId? }) → load_skill   (agent chats only)
  ├─► Build system prompt (with memories/notes if model.privateOk; skill index if agentId)
  ├─► createChatStream({ messages, modelIds: [requested, ...fallbacks], tools, maxSteps: 6, ... })
  │     └─► Uses AI SDK streamText with withFallback internally
  └─► Stream UI message stream to client
        └─► onFinish: persist assistant message → inngest.send(chatCompleted) for memory extraction
```

### Streaming Response

Uses **AI SDK UI Message Stream** (`createUIMessageStreamResponse`). Custom data parts:
- `data-run-event` — node/tool progress (for agent mode)
- `data-approval` — pending approval card
- `data-canvas` — canvas ID rendered

---

## 6. Agent Runtime (LangGraph)

### 6.1 Single-Agent Graph (`apps/api/lib/agent/graph.ts`)

**State:**
```typescript
interface AgentState {
  userId: string;
  runId: string;
  goal: string;
  planSteps: string[];           // 2-4 concrete steps from plan node
  stepIndex: number;
  roundsThisStep: number;        // tool rounds in current step (max 5)
  findings: AgentFinding[];      // step summaries
  toolLog: string[];             // compacted tool call history
  pendingCalls: ToolCallInfo[];  // calls awaiting gate/exec
  revisionNote: string | null;   // self-correction guidance
  toolAllow: string[] | null;    // skills can narrow the offered tools (null = not narrowed)
  failed: boolean;
  iterations: number;            // total act rounds (max 10)
  done: boolean;
  result: string;
  finalModel: string | null;
}
```

**Nodes (checkpointed):**

| Node | Model | Purpose |
|------|-------|---------|
| `plan` | FAST_MODELS | Break goal into 2-4 research steps |
| `act_llm` | ACT_MODELS | Execute current step with tools; returns calls or step summary |
| `tool_gate` | — | Check approvals: sensitive tools → `interrupt()` parks run; `deny` mode auto-denies (supervisor children) |
| `tool_exec` | — | Execute approved calls (built-in or MCP); append to toolLog |
| `observe` | FAST_MODELS | Decide: `continue` | `revise` | `finish` |
| `self_correct` | FAST_MODELS | Generate new approach for failed step |
| `finalize` | FINAL_MODELS | Write final report from findings |

**Routing:**
```
START → plan → act_llm
  ├─► tool_gate (if pendingCalls) → tool_exec → act_llm
  └─► observe (if step done or failed)
        ├─► finalize (if finish or max steps)
        ├─► self_correct (if revise or failed) → act_llm
        └─► act_llm (continue)
```

**Key Constants:**
- `MAX_AGENT_STEPS = 10` (total act_llm rounds)
- `MAX_TOOL_ROUNDS_PER_STEP = 5`
- `TOOL_LOG_WINDOW = 4` (older calls collapsed to count)
- `TOOL_LOG_CAPS` — per-tool in-memory tool-log caps (default 500 chars; `load_skill` 8000 so skill bodies stay readable)
- `CORE_TOOLS` — tools kept in late rounds (`load_skill` included)

**Per-node model chains:**
- `FAST_MODELS = [prepended, gemini-3.5-flash-lite, default, ...fallbacks]`
- `ACT_MODELS = [prepended, default, ...fallbacks]`
- `FINAL_MODELS = [prepended, gemini-3.8-flash, default, ...fallbacks]`

**Durability:** Compiled with **Postgres checkpointer** (`thread_id: agent-run-${runId}`). Inngest retries resume from last completed node.

**Interrupt Handling:** LangGraph JS `interrupt()` resolves (doesn't throw). Detection via `result.__interrupt__` array or caught `GraphInterrupt`.

### 6.2 Built-in Tools (`apps/api/lib/agent/tools.ts`)

Declarations (schemas only) → executed by `tool_exec` after gate.

| Tool | Approval | Description |
|------|----------|-------------|
| `web_search(query)` | no | Tavily, cites sources |
| `fetch_page(url)` | no | Extracts readable text (untrusted) |
| `search_notes(query, k)` | no | Hybrid vector + FTS on vault |
| `read_note(path)` | no | Full note + backlinks |
| `recall_memory(query)` | no | Vector search on `memories` |
| `list_memories(limit)` | no | Recent memories |
| `save_memory(kind, content)` | no | Upsert with dedupe (cosine ≥0.92) |
| `write_note(path, content)` | **yes** | Commits to GitHub vault |
| `render_canvas(spec)` | no | Validated Canvas spec → saved |
| `update_canvas(id, spec)` | no | Replace canvas spec |
| `load_skill(slug)` | no | Loads an **assigned** skill's body (12k cap) and narrows `toolAllow` to the skill's declared `tools` — intersect only, never a grant |
| `create_task(listId, title, dueAt?, priority?)` | no | Creates a task tagged `created_by='agent'` + `source_run_id` |
| `list_tasks(listId?, status?)` | no | Lists tasks (capped at 50 results) |
| `update_task(id, ...)` | **conditional** | Edits a task — needs approval only when the target is `created_by='user'` |
| `complete_task(id)` | no | Marks a task done (`status='done'`, `completed_at`) |
| `delete_task(id)` | **yes** | Soft-deletes a task (always needs approval) |
| `create_event(title, startsAt, endsAt, rrule?, reminders?)` | no | Creates a calendar event tagged `created_by='agent'` + `source_run_id` |
| `list_events(from, to)` | no | Lists events; recurring rules are **expanded on read** (no materialised occurrences) |
| `update_event(id, ...)` | **conditional** | Edits an event — needs approval only when the target is `created_by='user'` |
| `delete_event(id)` | **yes** | Soft-deletes an event (always needs approval) |
| `find_free_slots(from, to, durationMinutes)` | no | Suggests free slots between existing events |

**MCP Tools:** Loaded dynamically at run start via `loadMcpToolsForRun()` — namespaced as `mcp_<slug>_<tool>`, max 20 per run.

**Skill index:** Each run loads the agent's assigned skills (`loadSkillIndexForRun`) and injects *name + description only* into the `act_llm` and `finalize` system prompts (`GraphDeps.skillIndex`); the body is fetched on demand by `load_skill`. `tool_exec` records narrowing as a `toolAllow` payload on the `tool_exec` `node_end` timeline event.

**Productivity tools (Phase 9):** Task/event tools live in the same registry and run through the same gate. `create_*`/`list_*`/`complete_*`/`find_free_slots` never need approval; `update_*` needs approval **only** when the target row's `created_by='user'`; `delete_*` always needs approval. Tool-created rows carry `created_by='agent'` and the run's `source_run_id`; `extractMemories` writes detected tasks as `created_by='suggested'` rows (shown in the app as suggestions to accept/dismiss) instead of memories. Results are capped at 50 items.

### 6.3 Execution Entry Points

```typescript
// apps/api/lib/agent/graph.ts
export async function runAgent(input: RunAgentInput): Promise<{ status, result? }>
export async function resumeAgentRun(input: { runId, userId }): Promise<{ status, result? }>

// RunAgentInput: { runId, userId, goal, threadId?, preferredModel?, approvalMode?: "gate" | "deny" }
```

- `runAgent`: Creates run row (`queued`), loads MCP runtime, compiles graph with checkpointer, invokes
- `resumeAgentRun`: Reloads same MCP runtime, recompiles, invokes with `Command({ resume: true })`
- Both called from Inngest `agent/run.requested` and `approval/decided` handlers

---

## 7. Supervisor / Multi-Agent (`apps/api/lib/agent/supervisor.ts`)

### Architecture

Supervisor **never researches itself**. It delegates to specialist agents (non-supervisor agents owned by user).

```
SUPERVISOR GRAPH (4 nodes, checkpointed)
┌─────────────────────────────────────────────────────────────┐
│ delegate  ──► fan_out (parallel) ──► verify ──► merge       │
└─────────────────────────────────────────────────────────────┘
       │              │                   │           │
       ▼              ▼                   ▼           ▼
  LLM plans      Creates child      Cross-check   Synthesizes
  briefs for     runs (single-      with model    final report
  each specialist agent graphs)      from DIFFERENT   applying
  (≥2, ≤4)                         provider         corrections
```

### State

```typescript
interface SupervisorState {
  userId: string;
  runId: string;
  goal: string;
  briefs: Brief[];              // { agentId, task } — normalized to ≥2, ≤4
  children: ChildOutcome[];     // { runId, agentId, name, status, answer }
  verification: string;         // Cross-check notes
  result: string;
  finalModel: string | null;
}
```

### Node Details

| Node | Model | Key Logic |
|------|-------|-----------|
| `delegate` | FAST_MODELS | LLM splits goal into briefs per specialist; `normalizeBriefs()` ensures ≥2 distinct agents, pads with generic tasks if needed |
| `fan_out` | — | For each brief: create/load child run (`parent_run_id`), run `runAgent({ approvalMode: "deny" })` in parallel (`Promise.allSettled`). Idempotent on retry (reuses existing child runs by index). |
| `verify` | Cross-provider | `pickCrossProviderModel(workerProviders)` — selects strongest model from provider **not used by any worker**. Falls back to FINAL_MODELS if no cross-provider option. Outputs bullet corrections or "No material issues." |
| `merge` | FINAL_MODELS | Synthesizes final report from specialist answers + verification notes |

### Specialist Pool

```typescript
// Loads user's non-supervisor agents (oldest first, max 6)
async function loadSpecialists(userId): Promise<Specialist[]>
```

Each specialist carries its configured `model` (validated via `primeMobileModel`).

### Fallback

If `<2` specialists: logs message, delegates to single-agent `runAgent()`.

### Execution

```typescript
export async function runSupervisor(input: RunAgentInput): Promise<{ status, result? }>
```

Dispatched by `executeRun()` for agents with `is_supervisor = true`.

---

## 8. MCP Manager & Capability Registry

### 8.1 Catalog (`apps/api/lib/mcp/registry.ts`)

Global `mcp_servers` table (seeded, admin-managed). Each listing:

```typescript
interface ServerRow {
  id, slug, name, description, instructions,
  provider: "direct" | "composio",
  category, endpoint, transport, auth_type: "none" | "api_key" | "oauth",
  config, capabilities, icon_url, is_verified, is_free_tier, enabled
}
```

**Public listing** merges user's `user_mcp_connections` → `connected`, `connectionId`, `connectionStatus`.

### 8.2 Connections (`apps/api/lib/mcp/connections.ts`)

Per-user credentials stored encrypted:

```sql
user_mcp_connections:
  credentials_ciphertext bytea,  -- AES-256-GCM
  credentials_iv bytea,
  credentials_tag bytea,
  key_version text,              -- "v1"
  status: "pending" | "connected" | "expired" | "error"
```

**OAuth flow:**
1. `POST /api/mcp/connections` → returns `{ authorizationUrl, connectionId }` (PKCE + DCR)
2. User completes in browser → `/api/mcp/oauth/callback` (direct) or `/api/mcp/composio/callback` (Composio)
3. Callback: exchanges code, encrypts tokens, discovers tools, redirects to `agentapp://mcp/:serverId?status=connected`

**API Key flow:** Direct insert with encrypted key.

### 8.3 Tool Discovery & Loading (`apps/api/lib/mcp/tools-loader.ts`)

At **run start** (`loadMcpToolsForRun`):

1. Load agent's enabled `agent_mcp_servers` (join `user_mcp_connections` where `status = "connected"`)
2. Load enabled `mcp_servers` and their cached `mcp_tools`
3. Apply per-agent `agent_mcp_tool_permissions` (enable/approval/risk overrides)
4. **Namespace tool names:** `mcp_<slug>_<tool>` (prevents shadowing built-ins)
5. Cap at **20 tools/run** (prefer read/low-approval tools)
6. Build `McpToolRuntime`:
   - `tools: Map<name, LoadedMcpTool>`
   - `declarations: Record<name, AI SDK Tool>` (schemas only, no execute)
   - `approvalRequired: Set<name>`
   - `handles(name)`, `requiresApproval(name)`, `execute(name, args)`

### 8.4 Providers (`apps/api/lib/mcp/providers/`)

| Provider | Execution |
|----------|-----------|
| `direct-remote.ts` | Streamable HTTP POST to server endpoint with decrypted credentials |
| `composio.ts` | Calls Composio API (`executeTool`) with user's connection |

**Security:** Tool descriptions sanitized at discovery; schemas size-capped; `jsonSchema()` validates model input; server re-validates.

---

## 9. Memory System

### Three Memory Types

| Type | Scope | Storage | Retrieval |
|------|-------|---------|-----------|
| **Workspace** | Shared across authorized agents | `memories` table (kind=fact/preference/decision/task) | Vector search (pgvector HNSW) injected into system prompt |
| **Private Agent** | Per-agent | `agents.config` JSONB + memories tagged by agent | Same table, filtered by agent context |
| **Temporary Task** | Single run | LangGraph checkpointer state + `run_events` | In-memory during execution |

### Memory Extraction (Inngest: `chat/completed`)

```typescript
// apps/api/lib/memory/extract.ts
async function extractMemories(userId, threadId):
  1. Fetch last 40 messages from thread
  2. Build transcript (role: text)
  3. Call fast model with structured output prompt
  4. Dedupe against existing (cosine ≥0.92)
  5. Upsert to `memories` with embeddings
```

**Prompt:** Extracts only durable info — facts, preferences, decisions, tasks. Skips small talk, transient context, assistant self-references.

### Retrieval (Chat + Agent)

- `buildSystemPrompt(userId, lastUserMessage?)` fetches top-k memories via `searchMemories(query, k=8)`
- Only sent to models with `privateOk: true` (Google)
- Agent tools: `recall_memory`, `list_memories`, `save_memory`

---

## 10. Second Brain (GitHub Vault)

### Sync Pipeline

```
GitHub Push → Webhook (/api/webhooks/github HMAC) → Inngest (vault/changed)
                                                              │
                                                              ▼
                                          Fetch changed .md files
                                                              │
                                                              ▼
                                          Parse frontmatter + [[wikilinks]]
                                                              │
                                                              ▼
                                          Chunk by heading → embed → upsert
                                                              │
                                          notes, note_chunks (embedding + tsvector), note_links
```

### Agent Tools

| Tool | Purpose |
|------|---------|
| `search_notes(query)` | Hybrid search (vector + FTS reciprocal-rank fusion) |
| `read_note(path)` | Full content + backlinks |
| `write_note(path, content)` | Commits to repo (requires approval) |

**RPC:** `search_notes(query_embedding, query_text, k)` combines cosine distance + `ts_rank`.

### Skills (vault → index)

```
skills/<slug>/SKILL.md  ──syncVault──►  parseSkillFile (frontmatter: name, description, tools[])
        │                                      │
        │ (app edits via API)                  ▼
        └── putVaultFile / deleteVaultFile  skills table (index, whole body — no chunk/embed)
                                              │
                                     agent_skills (assignments)
```

- `SKILL.md` files are **excluded from note ingestion** (not chunked/embedded, not added to `seenPaths`).
- Sync also deletes index rows whose vault file vanished (`removeMissingSkills`).
- App-side create/edit/delete commits the file first (user-initiated → **no approval**), then upserts the index row.
- Path shape is strict: `skills/<slug>/SKILL.md` with a valid slug.

---

## 11. Canvas System

### Spec Schema (`packages/shared/src/canvas.ts`)

```typescript
interface CanvasSpec {
  title?: string;
  root: CanvasComponent;        // Single root component
  dataSources?: DataSource[];   // Refreshable queries
}

type CanvasComponent =
  | { type: "stat";     props: { value, label, trend?, prefix?, suffix? } }
  | { type: "chart";    props: { kind: "line"|"bar"|"pie"; data, xKey, yKey?, ... } }
  | { type: "table";    props: { columns, data, sortable?, filterable? } }
  | { type: "list";     props: { items, renderItem } }
  | { type: "markdown"; props: { content } }
  | { type: "image";    props: { src, alt, aspect? } }
  | { type: "button";   props: { label, action: { type: "open_url"|"run_agent"|"refresh_canvas", ... } } }
  | { type: "tabs";     props: { tabs: { label, content: CanvasComponent }[] } }
  | { type: "stack";    props: { direction: "horizontal"|"vertical"; gap; children: CanvasComponent[] } }
```

**Constraints:** Nesting ≤4, spec ≤100 KB.

### Lifecycle

1. Agent calls `render_canvas({ title, spec })` → validated via `validateCanvasSpec()` → saved to `canvases` → returns `{ canvasId }`
2. Mobile renders natively via `CanvasRenderer` (React Native components)
3. **Refresh:** `POST /api/canvases/:id/refresh` re-runs `dataSources` (web_search → search_notes → recall_memory pipeline, **no LLM**) → updates spec
4. **Scheduled:** Inngest cron `0 6 * * *` refreshes all data-bound canvases

---

## 12. Approval System

### Sensitive Tools

```typescript
// apps/api/lib/approvals.ts
export const SENSITIVE_TOOLS = new Set(["write_note", "delete_task", "delete_event"]);
export const CONDITIONAL_APPROVAL_TOOLS = new Set(["update_task", "update_event"]);
// MCP tools: per-tool `requires_approval` (default true, risk_level=high forces true)
```

**Conditional approvals (Phase 9):** `update_task` / `update_event` look up the target row's
`created_by` (server-side, `user_id` scoped). `created_by='user'` → the call parks for approval;
`created_by='agent'`/`'suggested'` → it runs immediately. A target that cannot be verified
(missing id, row gone, not owned by the user) **requires** approval — the gate never silently
proceeds on an unknown target. The decision logic is pure (`needsApproval`) and unit-tested.

**User-initiated edits never need approval:** `PUT`/`DELETE /api/notes/:path` (the user's own
note edits) commit straight to the vault. Only the agent's `write_note` tool is gated.

### Lifecycle

```
Tool Gate (graph node)
    │
    ├─► Sensitive tool detected
    │
    ├─► findLatestApprovalForRunTool(runId, toolName)
    │     ├─► Not found → createApproval({ status: "pending", expires_at: +24h })
    │     │         → appendRunEvent(tool_call, { approvalId })
    │     │         → updateRun(status: "awaiting_approval")
    │     │         → interrupt({ approvalId, tool })  // PARKS RUN
    │     │
    │     └─► Found → check status
    │           ├─► "approved" → allow
    │           ├─► "denied"/"expired" → deny, add to toolLog "DENIED: do not retry"
    │           └─► "pending" + expired → mark expired, treat as denied
    │
    └─► Non-sensitive → allow

User Decision (POST /api/approvals/:id { decision: "approve"|"deny", edits? })
    │
    ├─► decideApproval() → updates status, decided_at
    ├─► inngest.send(approval/decided { approvalId })
    │
    └─► Inngest handler → resumeAgentRun(runId) → graph continues from gate

Expiry: Cron or inline check marks pending+expired as "expired" (treated as denied)
```

### Supervisor Children

Run with `approvalMode: "deny"` — sensitive calls **auto-denied** immediately, never park. Model must work around.

---

## 13. Inngest Functions (`apps/api/lib/inngest/functions.ts`)

| Event | Function | Purpose |
|-------|----------|---------|
| `agent/run.requested` | `runAgent()` / `runSupervisor()` | Durable graph execution, writes `run_events` |
| `approval/decided` | `resumeAgentRun()` | Resume parked run |
| `chat/completed` | `extractMemories()` | Background memory extraction |
| `vault/changed` | GitHub webhook handler | Parse, chunk, embed changed notes |
| `document/uploaded` | Parse/uploaded files | Process uploads |
| `canvas/refresh.requested` + cron | `refreshCanvas()` | Re-run data sources |
| `monitor/tick` (cron) | Website monitors | Fetch, hash, diff, notify |
| `reminder/tick` (cron, every minute) | `runReminderTick()` | Due task/event reminders → Expo push (idempotent) |
| `keepalive` (cron) | Touch DB | Prevent Supabase pause |

**Key:** Each graph node = Inngest `step.run()` → checkpointed, retried independently.

---

## 14. Mobile App (Expo)

### Navigation (Expo Router v5, headless tabs)

```
Root Stack (_layout.tsx):
  (tabs)            → bottom tab group (session-guarded)
  threads, note, tasks, calendar, memories, skills, skills/[id],
  agents/[id], agents/[id]/edit, run, canvas, canvas/[id], mcp, mcp/[id],
  sign-in, auth/callback

Tabs group (app/(tabs)/_layout.tsx, expo-router/ui <Tabs>):
  1. Chat       → (tabs)/chat.tsx      (free chat or agent chat via ?agentId=)
  2. Agents     → (tabs)/agents.tsx    (list + pinned creatures)
  3. Today      → (tabs)/index.tsx     (agenda: events + due/overdue tasks, quick-add)
  4. Notes      → (tabs)/notes.tsx     (folder tree + list) → /note (root stack)
  5. More       → (tabs)/more.tsx      (Canvas, MCP, Skills, Memories, account)

Deep links: chat?threadId=, chat?agentId=, agents/[id], agents/[id]/edit,
            note?path=, tasks, calendar, run/[id], skills, skills/[id] ('new' = create)
```

> Detail routes stay in the **root stack** (not inside the tab group): the headless tab
> navigator only creates screens for its `TabTrigger` targets, so a nested route that is
> not a trigger would be unreachable.

### Key Screens

| Screen | Purpose |
|--------|---------|
| **Chat** | Streaming conversation, ModelPicker, AgentPicker (free chat), Composer with mode toggles (DeepSearch, Think, Task), attachments, approval cards, canvas inline previews |
| **Agents** | List with organic creature avatars, quick-access pinned row, swipe actions (pause, notify), search modal |
| **Agent Overview** | Avatar, quick actions (pause, sleep, memory), info, tools sheet, danger zone |
| **Agent Editor** | Identity (avatar picker: emoji/icon/upload + colors), Model (primary + fallback chips), Supervisor toggle, Instructions, Skills (assign/unassign, saved immediately) |
| **Today** (new, Phase 9) | Agenda of today's events + due/overdue tasks, one-tap completion, quick-add task, suggested-task accept/dismiss, "AI" badge on agent-created items |
| **Tasks** (new, Phase 9) | Lists (chips + create), subtasks (parent/child), due date + priority, tap-to-complete, delete |
| **Calendar** (new, Phase 9) | Month / week / agenda views, create & edit event (time, all-day, location, weekly repeat, reminder), recurring dots per day |
| **Notes** | Obsidian-style: folder tree, wikilinks, backlinks, hybrid search (FTS + vector) |
| **Note editor** (new, Phase 9) | Markdown editing, rename/move (path), save & delete — commits to the vault without approval |
| **Runs** | Timeline with node events, tool chips, specialist child runs, final result |
| **Canvas** | Native renderer for all component types (stat, chart, table, markdown, image, button, tabs, stack), pull-to-refresh |
| **MCP Store** | Browse catalog, connect (OAuth/API key), per-tool enable/approval toggles |
| **Memories** | List extracted memories with delete |
| **Skills** | List of `skills/<slug>/SKILL.md` bundles (tools chips, assignment count), editor with name/slug/description/tool-allowlist/body, delete; entry point is the More hub |
| **Settings** | Account, default model/fallbacks, memory viewer, vault sync status, theme |

**Push notifications (Phase 9):** on launch the app registers its Expo push token with
`POST /api/push-tokens`; reminder taps deep-link into `/` (Today) or `/calendar`. Remote push
requires a **development build** (Expo Go cannot receive remote notifications on Android
since SDK 53). The EAS project id is read from `Constants.expoConfig.extra.eas.projectId`
(or `EXPO_PUBLIC_EAS_PROJECT_ID`); without it, registration is skipped and the app keeps working.

### Design System

- **Colors:** Grok Obsidian (pitch black `#000000`, graphite `#121215`, thin borders `rgba(255,255,255,0.08)`)
- **Typography:** HeroUI Native variants (heading 32, title 24, body 16, body-xs 12)
- **Icons:** Lucide React Native (centralized in `constants/icons.ts`)
- **Components:** HeroUI Native + React Native Reusables (shadcn-style)
- **Responsive:** Phone (<768) single col, Tablet (≥768) two-col sidebar, Desktop (≥1024) persistent sidebar

---

## 15. Security Model

| Layer | Mechanism |
|-------|-----------|
| **Auth** | Supabase JWT on every request; `requireUser()` verifies `user_id = ALLOWED_USER_ID` |
| **RLS** | `using (user_id = auth.uid())` on all tables; child tables join through parent |
| **Secrets** | Only in Vercel env; MCP credentials AES-256-GCM encrypted at rest; decrypted server-side at runtime only |
| **Prompt Injection** | All web content, files, MCP tool descriptions/results treated as untrusted. Sensitive tools require approval by default. Tool output never changes tool allow-list. |
| **Canvas** | Fixed component enum; no eval, no model-supplied code. WebView sandboxed (no network, no native bridge). |
| **Private Context** | Note/memory context only sent to `private_ok` models (Google). Free tiers of other providers assumed to log/train. |
| **Skills** | `load_skill` only returns skills assigned to the run's agent (agent id from run row, never a model arg). A skill's `tools` list can only **narrow** the offered set (`narrowToolSet` = intersection of current ∩ available ∩ declared) — skills can never add a tool. Skill files are untrusted content like notes. Skill writes skip approvals because they are user-initiated, not model-initiated. |
| **Productivity (Phase 9)** | Tasks/events are soft-deleted (`deleted_at`) and scoped by `user_id` in every query. The agent can only act on rows owned by the run's user. Editing a user-created row needs approval; deleting always does. Recurrence is expanded on read (never materialised), and reminders are claimed in `reminder_log` (unique key) so a push fires at most once. |
| **Rate Limiting** | Endpoint rate limits; per-run step/token caps to protect free quotas. |
| **MCP Security** | Validate all tool inputs; restrict server network access; isolate untrusted servers; enforce timeouts; limit output sizes; maintain execution logs; never expose secrets to descriptions/context. |

---

## 16. Key Flows Summary

### 16.1 Short Chat (≤30s)
```
User → POST /api/chat → streamText (withFallback) → UI stream → persist → chatCompleted → Inngest (memory)
```

### 16.2 Long Task (Agent Run)
```
User → POST /api/agents/run { goal, agentId? } → agent_runs(queued) → inngest.send(agent/run.requested)
      → Inngest: runAgent() [checkpointed steps] → run_events timeline
      → Tool gate: approval? → approvals row → interrupt → awaiting_approval
      → User: POST /api/approvals/:id → inngest.send(approval/decided)
      → Inngest: resumeAgentRun() → continues
      → Finalize: agent_runs(succeeded) + result message + optional canvas
      → App polls GET /api/runs/:id (includes full run_events) for live timeline
```

### 16.3 Supervisor Task
```
User → POST /api/agents/run (supervisor agent) → runSupervisor()
      → delegate: LLM creates briefs for ≥2 specialists
      → fan_out: parallel child runs (approvalMode: "deny")
      → verify: cross-provider model checks for contradictions
      → merge: synthesizes final report
      → Single parent run with embedded children in GET /api/runs/:id
```

### 16.4 MCP Tool Execution
```
Agent calls mcp_context7_query_docs
      → tool_gate: checks approvalRequired (per-agent permission row)
      → If approved: tool_exec → executeDirectTool(userId, connectionId, externalToolId, args)
      → Direct: POST to MCP server endpoint with decrypted credentials
      → Composio: POST to Composio API with user's connection
      → Result → toolLog → next act_llm round
```

### 16.5 Skill Load (progressive disclosure)
```
Run start → loadSkillIndexForRun → prompt gets "- slug: description" lines only
Agent calls load_skill(slug)
      → pickAssignedSkill (assigned + enabled, else found:false)
      → body returned (≤12k) + toolAllow := toolAllow ∩ available ∩ declared.tools
      → next act_llm round is offered only the narrowed set (timeline shows toolAllow)
```

### 16.6 Reminder Delivery (Phase 9)
```
Inngest cron "reminder/tick" (* * * * *) → runReminderTick(now)
      → load due tasks (remind_at ≤ now, open) + events with reminders
      → expand recurring items (rrule, anchored to the item's DTSTART)
      → compute each occurrence's reminder instant (event: start − minutesBefore)
      → filterAlreadyReminded (reminder_log)
      → claimReminders: INSERT reminder_log rows (unique item_type+item_id+remind_at)
            → 23505 conflict ⇒ another tick owns it ⇒ skip (at-most-once)
      → sendPush: Expo Push Service REST, fans out to the user's tokens
      → success ⇒ tasks.reminded_at updated
      → no delivery ⇒ releaseReminders (delete claims) ⇒ the next tick retries
```

---

## 17. Configuration & Environment

### Required Vercel Env Vars

| Variable | Purpose |
|----------|---------|
| `SUPABASE_URL`, `SUPABASE_ANON_KEY`, `SUPABASE_SERVICE_ROLE_KEY` | Database & auth |
| `DATABASE_URL` | Postgres pooler URI (for LangGraph checkpointer) |
| `INNGEST_EVENT_KEY`, `INNGEST_SIGNING_KEY` | Inngest |
| `GOOGLE_GENERATIVE_AI_API_KEY` | Default provider (required) |
| `GROQ_API_KEY` | Fallback provider |
| `OPENROUTER_API_KEY` | Long-tail fallback |
| `MISTRAL_API_KEY`, `DEEPSEEK_API_KEY`, `HUGGINGFACE_API_KEY`, `COHERE_API_KEY` | Optional additional providers |
| `TAVILY_API_KEY` | Web search |
| `GITHUB_VAULT_TOKEN`, `GITHUB_VAULT_REPO` | Vault sync (e.g. `owner/repo`) |
| `GITHUB_WEBHOOK_SECRET` | HMAC verification |
| `ENCRYPTION_KEY` | 32-byte hex for AES-256-GCM (MCP credentials) |
| `ALLOWED_USER_ID` | Your Supabase user UUID (single-user gate) |
| `EXPO_PUBLIC_API_BASE_URL` | Mobile → API base |

### Mobile (Expo) Env

| Variable | Purpose |
|----------|---------|
| `EXPO_PUBLIC_API_BASE_URL` | API base URL |
| `EXPO_PUBLIC_SUPABASE_URL`, `EXPO_PUBLIC_SUPABASE_ANON_KEY` | Supabase client |

---

## 18. Testing & Verification

### Unit Tests (`apps/api/lib/**/__tests__/`)
- Model resolver, fallback ordering, capability gate
- Encryption round-trip, SSRF protection, risk classification
- MCP tool namespacing, redaction, listing schema validation
- Supervisor brief normalization, cross-provider picker
- Agent schema, canvas schema
- Skills: frontmatter parse/compose round-trip (incl. list-after-empty-key fix), path detection, slugify, `narrowToolSet` (never adds), `pickAssignedSkill` guard, `skillIndexSection` (body-free)
- Productivity (Phase 9): RRULE expansion (weekly anchor keeps the time of day, EXDATEs exclude one occurrence, explicit DTSTART wins, unparseable rule falls back), snake_case↔camelCase row/insert/update mappers, approval decision (`needsApproval`: create/list/complete never gated, delete always gated, edit gated only for user-created items, unknown target gated), reminder scheduling (`computeDueReminders`)

### Contract Tests (Manual, Consumes Quota)
- One tool-call prompt per registry model
- One structured-output prompt per registry model
- One image prompt per vision-capable model

### Integration Tests
- Graph with mocked LLM/tools
- Approval resume flow
- Vault sync on fixture repo

### Security Tests
- Prompt injection fixtures (malicious page/tool result must not trigger tools)
- RLS tests with second user

### Manual Verification Scripts (`apps/api/scripts/`)
- `check-providers.ts` — runs same prompt on each provider, forces 429 on primary
- `check-skills.ts` — skills E2E: index body-free, assignment guard, chat prompt index, real run follows loaded skill + narrowing timeline event (consumes quota)
- `check-tasks.ts` — productivity E2E: task/list CRUD + soft delete, agent tools (`create_task`/`list_tasks`/`create_event`/`list_events`), recurring expansion, approval gate matrix, reminder claim-once, notes write/delete, HTTP route checks (Phase 9)
- `check-supervisor.mjs` — 11 supervisor E2E checks *(claimed; not present in repo)*
- `check-agent-crud.mjs`, `check-agent-avatars.mjs`, `check-chat-route.mjs`, etc. *(claimed; not present in repo)*

---

## 19. Development Workflow

### Phase Order (IMPLEMENTATION_PLAN.md)

| Phase | Focus | Done When |
|-------|-------|-----------|
| 0 | Setup (monorepo, Supabase, Vercel, Inngest, shadcn/ui) | Signed-in Expo calls `/api/health` |
| 0.5 | LLM Provider Layer | Same prompt runs on Google/Groq/OpenRouter; forced 429 falls through |
| 1 | Chat | Multi-turn chat with images streams on real phone |
| 2 | Search + Notes + Memory | Agent cites old note + recalls preference in new thread |
| 3 | Agent Graph | 5-min research task runs after closing app, posts result |
| 4 | Approvals | Deny re-plans, approve proceeds, expiry works |
| 5 | Canvas | "Make dashboard of X" yields native refreshable canvas |
| 5.1 | Provider Dashboard + Task Model Chooser | Dashboard refreshes catalogs; toggle changes mobile models |
| 6 | MCP Store | Add server in ≤3 taps, use tool in next run |
| 7 | Multi-Agent | Supervisor delegates to 2+ agents, merges cross-checked results |
| 8 | Extras | Monitors, image gen, voice, code sandbox, X data |
| 9 | Productivity | Tasks, calendar, note editing, reminders; agent adds tasks/events; user-created items protected by approvals |

**Rule:** Work one phase at a time. Don't start next until current phase confirmed.

---

## 20. Extension Points

| Want to add... | Where to start |
|----------------|----------------|
| **New model provider** | 1. Add to `PROVIDER_ENV_KEYS` in `resolver.ts`<br>2. Add SDK import & case in `providerInstances()`<br>3. Add entries to `MODEL_REGISTRY` with capabilities<br>4. Add env var to Vercel |
| **New built-in tool** | 1. Add declaration to `declarations` in `tools.ts`<br>2. Add case in `executeToolCall`<br>3. Add to `SENSITIVE_TOOLS` if needs approval<br>4. Add to `CORE_TOOLS` if should persist in late rounds |
| **New MCP server type** | 1. Add provider in `mcp/providers/` implementing `execute()`<br>2. Add case in `tools-loader.ts` runtime `execute()`<br>3. Seed `mcp_servers` with new `provider` value |
| **New Canvas component** | 1. Add to `CanvasSpec` schema in `packages/shared/src/canvas.ts`<br>2. Add renderer in `apps/mobile/src/components/canvas/`<br>3. Add to `validateCanvasSpec()` allowed types |
| **New memory kind** | 1. Add to `kind` enum in `memories` table & `MemorySchema`<br>2. Update extraction prompt in `extract.ts` |
| **New approval type** | 1. Add tool to `SENSITIVE_TOOLS` or MCP tool `requires_approval`<br>2. Approval UI already generic (shows tool, args, reason) |

---

## 21. Common Debugging

| Symptom | Check |
|---------|-------|
| Chat returns "provider_not_configured" | Verify API key in Vercel env; `providersWithKeys()` |
| Agent run stuck at `awaiting_approval` | Check `approvals` table; Inngest `approval/decided` event delivered? |
| MCP tools not appearing | `user_mcp_connections.status = "connected"`? `agent_mcp_servers.enabled = true`? Server `enabled = true`? Tool `enabled = true`? |
| Fallback not working | `withFallback` logs attempts; check `provider_usage` for `skipped` reasons |
| Canvas not refreshing | `dataSources` in spec valid? `POST /api/canvases/:id/refresh` works? Cron registered? |
| Reminder push not arriving | Device registered in `push_tokens`? `EXPO_PUBLIC_EAS_PROJECT_ID` set? `reminder_log` row exists (claimed)? `reminder/tick` cron running? Remote push needs a **dev build** (not Expo Go on Android) |
| Recurring event shows the wrong time | The rule must be anchored to the item's `starts_at` (DTSTART) — `expandStarts` in `lib/recurrence.ts` |
| Memory not retrieved | Model `privateOk = true`? `searchMemories` returning results? |
| Supabase paused | Keepalive cron running? `SELECT 1` from Vercel? |

---

## 22. File Map (Key Implementation Files)

```
apps/api/lib/
├── agent/
│   ├── graph.ts           # Single-agent LangGraph (plan→act→gate→exec→observe→correct→finalize)
│   ├── supervisor.ts      # Supervisor graph (delegate→fan_out→verify→merge)
│   ├── state.ts           # AgentState, AgentFinding types
│   ├── runs.ts            # CRUD for agent_runs, run_events
│   ├── checkpointer.ts    # Postgres checkpointer (LangGraph)
│   └── execute.ts         # runAgent, runSupervisor, executeRun dispatch
├── models/
│   ├── registry.ts        # MODEL_REGISTRY, DEFAULT_MODEL_ID, FALLBACK_ORDER
│   ├── resolver.ts        # getModel(), resolveModel(), providerInstances()
│   ├── fallback.ts        # withFallback(), classifyError()
│   ├── capability.ts      # assertCapabilities()
│   ├── generate.ts        # generateTextWithFallback, generateObjectWithFallback
│   ├── usage.ts           # recordUsage() → provider_usage
│   ├── embeddings.ts      # Fixed embedding model
│   └── catalog.ts         # primeMobileModel(), defaultMobileModel()
├── mcp/
│   ├── registry.ts        # Catalog CRUD, toPublicServer, connectionStateByServer
│   ├── connections.ts     # OAuth/API key flows, encrypt/decrypt credentials
│   ├── tools-loader.ts    # loadMcpToolsForRun(), namespacing, runtime build
│   ├── providers/
│   │   ├── direct-remote.ts
│   │   └── composio.ts
│   └── security/          # redact-secrets, validate-endpoint
├── chat/
│   ├── stream.ts          # createChatStream (AI SDK streamText + tools)
│   ├── persist.ts         # Thread/message CRUD
│   ├── system-prompt.ts   # buildSystemPrompt (memories + notes)
│   └── attachments.ts     # Load/process uploads
├── knowledge/
│   └── search.ts          # searchNotes, searchMemories, upsertMemories, vault sync
├── skills/
│   ├── load.ts            # listSkillsForAgent, pickAssignedSkill, loadSkillBody, narrowToolSet, buildSkillTools, skillIndexSection, API helpers (rowToSkill, setAgentSkills)
│   ├── sync.ts            # parseSkillFile, composeSkillFile, upsertSkillIndex, removeMissingSkills, slugifyName
│   └── index.ts           # re-exports
├── approvals.ts           # SENSITIVE_TOOLS, CONDITIONAL_APPROVAL_TOOLS, needsApproval, create/get/decide/expire approvals
├── canvases.ts            # CRUD, validateCanvasSpec, refresh
├── productivity.ts        # task/event row↔API mappers (rowToTask, taskInsert, eventUpdate, …)
├── recurrence.ts          # buildRRuleSet, expandStarts (RRULE expansion, DTSTART-anchored)
├── reminders.ts           # computeDueReminders, runReminderTick, claim/release reminders
├── push.ts                # sendPush — Expo Push Service REST client
├── inngest/
│   ├── client.ts          # inngest client
│   ├── events.ts          # Event definitions (chatCompleted, agentRunRequested, ...)
│   └── functions.ts       # All Inngest function handlers
├── tools/
│   ├── web.ts             # webSearch (Tavily), fetchPage
│   └── knowledge.ts       # buildKnowledgeTools, buildWebTools
├── vault/
│   ├── sync.ts            # syncVault: notes + skills/<slug>/SKILL.md branches
│   ├── parse.ts           # frontmatter/wikilink parsing (parseFrontmatter)
│   └── github.ts          # putVaultFile / deleteVaultFile (commit to repo)
└── supabase/
    ├── server.ts          # supabaseAdmin (service role)
    └── client.ts          # createServerClient (user JWT)

apps/api/app/api/
├── skills/route.ts            # GET (list + assignedAgentIds), POST (vault commit + index)
├── skills/[id]/route.ts       # PATCH (recompose+commit), DELETE (file then row)
├── agents/[id]/skills/route.ts  # PUT { skillIds } (replace assignment set)
├── task-lists/route.ts        # GET (list), POST (create)
├── task-lists/[id]/route.ts   # PATCH (rename/sort), DELETE (soft delete)
├── tasks/route.ts             # GET (filters), POST (create)
├── tasks/[id]/route.ts        # GET, PATCH, DELETE (soft delete)
├── events/route.ts            # GET (from/to → expanded occurrences), POST (create)
├── events/[id]/route.ts       # GET, PATCH, DELETE (soft delete)
├── push-tokens/route.ts       # POST (register/upsert), DELETE (?expoToken=)
└── notes/[path]/route.ts      # PUT (vault commit, user-initiated), DELETE (vault + index)

packages/shared/src/skill.ts   # SkillFrontmatterSchema, SkillCreate/Patch, AgentSkillsPut
packages/shared/src/tasks.ts   # TaskList/Task/CalendarEvent/PushToken schemas + EventsRangeQuery
apps/api/scripts/check-skills.ts  # live skills E2E check
apps/api/scripts/check-tasks.ts   # live productivity E2E check (Phase 9)
```

---

*Generated from live codebase audit (2026-11-20; updated 2026-11-21 for Phase 8 — Skills, and Phase 9 — Tasks, Calendar, Notes editing, reminders). Phases 0–9 implemented and verified. This document reflects the actual implementation, not just the spec.*