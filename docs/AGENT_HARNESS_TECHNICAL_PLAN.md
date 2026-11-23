# Agent Harness Technical Plan

*Generated from the codebase as of 2026-11-23*

---

## 1. Context Assembly and Token Budgeting

### 1.1 System Prompt Composition

The system prompt is built dynamically per turn in `apps/api/lib/chat/system-prompt.ts`:

```typescript
async function buildSystemPrompt(
  userId: string,
  userMessage: string | undefined,
  agentId?: string | null,
  timeZone: string = DEFAULT_TIMEZONE,
): Promise<string>
```

**Components:**
1. **Base prompt** — Core rules (citations, trust boundaries, conciseness, scheduling)
2. **Current time context** — User's local date/time/timezone for relative expressions
3. **Web search availability** — Injected when Tavily is configured
4. **Relevant memories** — Top-6 hybrid search results (semantic + keyword) from the user's memories
   - Falls back to 6 most recent memories if no query match
5. **Agent skill index** — Progressive disclosure: only `slug: description (name)` lines for assigned skills
   - Full skill bodies fetched on-demand via `load_skill` tool

**Privacy gate:** Memories/notes are only injected when the target model has `privateOk: true` (Google models only). Non-private models receive a minimal prompt without private context.

### 1.2 Agent Graph State Context

The graph state (`apps/api/lib/agent/state.ts`) carries context between nodes:

| Field | Purpose | Token Impact |
|-------|---------|--------------|
| `planSteps[]` | 2-4 research steps | ~200 tokens |
| `findings[]` | Step summaries (capped 2000 chars each) | ~2000 tokens max |
| `toolLog[]` | Last 4 tool calls verbatim; older become count | ~600 tokens per entry, capped |
| `loadedSkills[]` | Skill bodies (max 4, each capped 12KB) | Up to 48KB |
| `roundsThisStep` | Limits tool rounds per step (max 4) | Indirect |

**Tool log compaction** (`graph.ts:109-114`): Keeps last `TOOL_LOG_WINDOW = 4` entries verbatim; earlier entries become `[N earlier tool call(s) omitted]`.

### 1.3 Token Budgeting per Run

**Single-agent run limits** (`state.ts:133-135`):
- `MAX_AGENT_STEPS = 10` — Hard cap on completed act steps
- `MAX_TOOL_ROUNDS_PER_STEP = 4` — LLM+tool rounds within one step
- Recursion limit: 150 (set at compile time in `graph.ts:1023`)

**Group run limits** (`groups/types.ts:24`, `group.ts:199`):
- `maxHops` (1-20) — Total member turns
- `tokenBudget` (1,000-500,000) — Cumulative tokens across all member turns
- `maxDepth = 2` — Nested consult depth
- Ping-pong detection: A→B→A→B stops routing

**Per-model context windows** (from `registry.ts`):
- Google Gemini: 1,048,576 tokens
- Groq models: 131,072 tokens
- OpenRouter: 1,048,576 (Gemini) / 131,042 (Qwen)
- Mistral: 131,072 tokens
- DeepSeek: 65,536-131,072 tokens
- Cohere: 131,072-256,000 tokens
- Hugging Face: 131,072-262,144 tokens

---

## 2. Model Selection and Fallback

### 2.1 Model Registry

Located at `apps/api/lib/models/registry.ts`. Each entry contains:

```typescript
interface ModelRegistryEntry {
  id: string;                    // "google:gemini-3.8-flash"
  provider: Provider;
  providerModelId: string;       // Provider-native ID
  label: string;                 // Human-readable
  capabilities: {
    tools: boolean;
    vision: boolean;
    structuredOutput: boolean;
    reasoning: boolean;
    pdf: boolean;
  };
  contextWindow: number;
  privateOk: boolean;            // Safe for private context
  tier: "free" | "paid";
}
```

**Current registry** (17 models across 7 providers):
- Google: 4 models (3 free, 1 paid)
- Groq: 3 models (free)
- OpenRouter: 2 models (free)
- Mistral: 3 models (paid)
- DeepSeek: 2 models (paid)
- Cohere: 2 models (free, non-commercial)
- Hugging Face: 2 models (paid)

Dynamic models can be added at runtime via `registerRuntimeModel()` from the provider catalog dashboard.

### 2.2 Default Chains

```typescript
// Fast/cheap models for routing, summaries, observe, self-correct
FAST_MODELS = ["google:gemini-3.5-flash-lite", "google:gemini-3.6-flash", "groq:gpt-oss-120b", "openrouter:gemini-3.8-flash"]

// Default act model + fallbacks
ACT_MODELS = ["google:gemini-3.6-flash", "groq:gpt-oss-120b", "google:gemini-3.8-flash", "openrouter:gemini-3.8-flash"]

// Strongest model for finalize
FINAL_MODELS = ["google:gemini-3.8-flash", "google:gemini-3.6-flash", "groq:gpt-oss-120b", "openrouter:gemini-3.8-flash"]
```

Per-node model selection in `graph.ts:278-286`:
- **Plan/Observe/Self-correct**: `FAST_MODELS` (or `privateModelChain` for private group turns)
- **Act**: `ACT_MODELS` (or `privateModelChain`)
- **Finalize**: `FINAL_MODELS` (or `privateModelChain`)

### 2.3 Fallback Mechanism

Core logic in `apps/api/lib/models/fallback.ts:withFallback()`:

**Order of operations per candidate:**
1. **Capability gate** — Skip if model lacks required capability (tools, vision, structuredOutput)
2. **Resolve provider** — Skip if API key missing
3. **Execute with retries** — Default 1 retry per model with exponential backoff (1.5s base)
4. **On retryable failure (429, 5xx, timeout)** — Retry once, then next model
5. **On non-retryable failure** — Immediate next model

**Retryable classifications** (`classifyError()`):
- 429 (rate limited) → `rate_limited`, retryable
- 5xx → `error`, retryable
- 408/409 → `error`, retryable
- Timeout/AbortError → `error`, retryable
- Everything else → non-retryable

**Result tracking:** Returns `FallbackResult<T>` with `attempts[]` containing modelId, provider, outcome, latency, tryNumber.

### 2.4 Usage Recording

Every attempt (success, failure, skip) writes to `provider_usage` table (`models/usage.ts`):
- `user_id`, `provider`, `model`, `run_id`
- `status`: `ok` | `rate_limited` | `error` | `skipped`
- `input_tokens`, `output_tokens`, `latency_ms`
- `detail` — failure/skip reason (added in migration 0004)

---

## 3. Skill and Memory Loading

### 3.1 Skills (Phase 8)

**Storage:**
- Source of truth: GitHub vault at `skills/<slug>/SKILL.md` with frontmatter (`name`, `description`, `tools[]`)
- Supabase `skills` table: searchable index (no chunking/embedding)
- `agent_skills` join table: agent ↔ skill assignments

**Progressive disclosure:**
1. System prompt carries only **name + description** for each assigned skill (`skillIndexSection()`)
2. Agent calls `load_skill(slug)` tool to fetch full body on demand
3. Body is trusted user-authored content (unlike findings which may echo untrusted tool output)

**Skill loading** (`skills/load.ts`):
```typescript
async function loadSkillBody(userId, agentId, slug): Promise<SkillRow | null>
```
- Verifies agent ownership
- Checks skill is assigned AND enabled for this agent
- Returns full body (capped 12KB for finalize prompt budget)

**Tool narrowing** (`narrowToolSet()`):
- Skills declare `tools[]` in frontmatter
- Loaded skill's tools **intersect** with current tool set (current ∩ available ∩ declared)
- Skills can **only narrow**, never grant new tools
- Narrowing is checkpointed (survives retries/resumes)
- Group tools (`handoff_to`, `ask_agent`, `post_to_group`) are **never narrowed away**

### 3.2 Memories (Phase 2)

**Storage:**
- `memories` table with `kind` (fact/preference/decision/task), `content`, `embedding` (768-dim)
- Vector index: HNSW on `embedding` (`migrations/0003_notes.sql`)

**Retrieval:**
- `search_memories(query, k=8)` — Vector similarity search
- `list_memories(limit=20)` — Most recent
- Injected into system prompt: top-6 relevant, or fallback to 6 most recent

**Extraction** (`memory/extract.ts`):
- Inngest `chat/completed` event triggers extraction
- Model extracts facts/preferences/decisions/tasks
- Tasks become `created_by='suggested'` rows (not memories) — shown as suggestions
- Deduplication against existing memories via embedding similarity

---

## 4. Tool Discovery and Execution

### 4.1 Built-in Tools

Declared in `apps/api/lib/agent/tools.ts:declarations` (28 tools):

| Category | Tools |
|----------|-------|
| Web | `web_search`, `fetch_page` |
| Notes | `search_notes`, `read_note`, `write_note` |
| Memory | `recall_memory`, `list_memories`, `save_memory` |
| Canvas | `render_canvas`, `update_canvas` |
| Skills | `load_skill` |
| Productivity (Phase 9) | `create_task`, `list_tasks`, `update_task`, `complete_task`, `delete_task`, `create_event`, `list_events`, `update_event`, `delete_event`, `find_free_slots` |
| Routines (Phase 10) | `create_routine`, `list_routines`, `update_routine`, `pause_routine`, `resume_routine`, `delete_routine` |
| Groups (Phase 11) | `handoff_to`, `ask_agent`, `post_to_group` |

**Tool declaration pattern:** Non-executing AI SDK `tool()` objects (schemas only). Execution happens in graph nodes, enabling approval gating.

### 4.2 MCP Tool Discovery (Phase 6)

**Registry:** `mcp_servers` table (seeded + admin CRUD)

**Connection flows:**
- **None/Direct** — HTTP endpoint, no auth
- **API Key** — Header-based, encrypted at rest
- **OAuth 2.0/OIDC** — PKCE + DCR, tokens encrypted
- **PAT** — GitHub Personal Access Token

**Discovery** (`mcp/discovery.ts`):
```typescript
async function listRemoteTools(input: DiscoverInput): Promise<DiscoveredTool[]>
```
1. SSRF validation (`validateEndpoint`)
2. HTTP MCP client with `redirect: "error"`
3. Paginated `listTools()` (max 5 pages, 100 tools)
4. Normalization: sanitize names, cap descriptions, validate JSON Schema (max 8KB)
5. Risk classification (`mcp/risk.ts`): `readOnlyHint`, `destructiveHint`, `idempotentHint` → `low|medium|high`
6. Cache in `mcp_tools` table with `schema_hash` for change detection

**Runtime loading** (`mcp/tools-loader.ts`):
```typescript
async function loadMcpToolsForRun(runId, userId): Promise<McpToolRuntime>
```
1. Resolve run's agent
2. Load enabled `agent_mcp_servers` attachments
3. Verify connections are `connected`
4. Load enabled cached tools for those servers
5. Apply per-agent permission overrides (`agent_mcp_tool_permissions`)
6. Namespace names: `mcp_<slug>_<tool>`
7. Cap at 20 tools/run (prefer non-approval-required)
8. Return `McpToolRuntime` with declarations + execute handlers

**Execution:** Provider-specific:
- Composio → `executeComposioTool()`
- Direct remote → `executeDirectTool()` (HTTP with auth headers)

### 4.3 Tool Set per Round

`toolsForStep()` in `graph.ts:129-162`:
- **Round 0-1**: Full tool set
- **Round 2+**: Core tools only (`web_search`, `fetch_page`, `search_notes`, `read_note`, `load_skill`) + group tools
- **Final round (round ≥ maxRounds)**: No tools — model must write prose
- **Skill narrowing**: Once `toolAllow` is set by `load_skill`, only intersection offered
- **Group tools**: Always attached for every round of a member turn

---

## 5. Approval Handling

### 5.1 Approval Policy

**Always require approval** (`approvals.ts:15-20`):
- `write_note` (commits to vault)
- `delete_task`, `delete_event`, `delete_routine` (soft deletes)

**Conditional approval** (`approvals.ts:23`):
- `update_task`, `update_event` — Only when target `created_by = 'user'`
- Agent/suggested items: no approval
- Unverifiable target (no ID, row gone): requires approval (fail-safe)

**MCP tools:** Per-tool `approval_required` flag (default from risk classification, overridable per agent)

### 5.2 Approval Flow

**Creation** (tool gate node, `graph.ts:454-560`):
1. Check `requiresApproval()` (built-in + MCP)
2. If `approvalMode === "deny"` (supervisor children): auto-deny, log, continue
3. Else: find/create `approvals` row (idempotent by `run_id + tool_name`)
4. Set `run.status = "awaiting_approval"`
5. Call `interrupt({ approvalId, tool })` — parks run at LangGraph checkpoint

**Decision** (API route `/api/approvals/:id` → Inngest `approval/decided`):
1. User taps Approve/Deny
2. `decideApproval()` updates row: `approved` | `denied` | `expired`
3. Emits `approval/decided` event
4. Inngest `approvalResumeFunction` invokes `resumeAgentRun()`
5. Graph resumes with `Command({ resume: true })` from tool gate

**Expiry:** 24h TTL (`APPROVAL_TTL_MS`). Expired = denied. Cron `expireStaleApprovals()` marks them.

### 5.3 Approval Modes

| Mode | Behavior | Used By |
|------|----------|---------|
| `gate` (default) | Parks run on approval | Direct runs, group member turns, routines with `queue` |
| `deny` | Auto-denies sensitive calls | Supervisor children, routines with `deny` |

---

## 6. Execution Loops and Stopping Conditions

### 6.1 Single-Agent Graph

**Nodes** (`graph.ts:802-820`):
```
START → plan → act_llm → tool_gate → tool_exec → observe
                          ↑           │            ↓
                          └───────────┴────────────┘
                                        ↓
                              self_correct (on failure)
                                        ↓
                                    finalize → END
```

**Routing logic:**
- `routeAfterActLlm`: tools → `tool_gate`; step done + more steps → `act_llm`; else → `observe`
- `routeAfterGate`: approved calls → `tool_exec`; none → `act_llm`
- `routeAfterToolExec`: handoff → `finalize`; else → `act_llm`
- `observe`: `finish`/max steps → `finalize`; `revise` → `self_correct`; `continue` → `act_llm`

**Stopping conditions:**
1. `observe` returns `finish` OR `iterations >= MAX_AGENT_STEPS (10)`
2. Graph `recursionLimit: 150` (safety net)
3. Explicit `pause`/`cancel` via API (cascades to children)
4. Error → `failRun` → `failed` status

### 6.2 Supervisor Graph (Phase 7)

`supervisor.ts`: `delegate → fan_out → verify → merge`
- `delegate`: Structured briefs for 2-4 specialists (capped at 4)
- `fan_out`: Parallel child runs (single-agent graph, `approvalMode: "deny"`)
- `verify`: Cross-provider model checks outputs
- `merge`: Synthesizes final answer with corrections

### 6.3 Group Graph (Phase 11)

`group.ts`: `route → agent_turn → route → … → finalize`
- Each `agent_turn` = sequential child run of single-agent graph
- Member keeps own model, tools, skills, approval policy
- Routing tools: `handoff_to` (ends turn), `ask_agent` (consult), `post_to_group` (progress)
- Guardrails: `max_hops`, ping-pong detection, `tokenBudget`, `maxDepth=2`
- Privacy: Non-`private_ok` targets get no private context/tools; private-capable caller may not hand to non-private target

---

## 7. Checkpointing and Recovery

### 7.1 Postgres Checkpointer

`apps/api/lib/agent/checkpointer.ts`:
- `PostgresSaver` from `@langchain/langgraph-checkpoint-postgres`
- Connection: `DATABASE_URL` (Supabase pooler URI)
- Pool: max 2 connections
- Schema auto-created via `saver.setup()`
- Singleton per serverless instance (survives hot reloads)

**Checkpoint key:** `thread_id = "agent-run-${runId}"` (also `"group-run-${runId}"`, `"supervisor-run-${runId}"`)

### 7.2 Pause/Resume

**Pause** (`POST /api/runs/:id/pause`):
- Flips `agent_runs.status = 'paused'`
- Cascades to unfinished supervisor children
- Every node wrapped in `assertRunActive()` boundary
- Graph stops at next node boundary (control flow, not failure)
- Inngest step returns `{status: "paused"}`

**Resume** (`POST /api/runs/:id/resume` → `run/resumed` event):
- `beginResume()`: `paused → running` (re-entrant)
- `invoke(null)` continues from Postgres checkpoint
- Only the stopped node re-runs
- **Critical:** Run paused on undecided approval restores `awaiting_approval` instead of invoking (would resume interrupt with undefined)

### 7.3 Inngest Retries

- `agentRunFunction`: `retries: 3`
- On failure, Inngest retries the step
- Graph checkpointed after every node → retries resume from last completed node
- `onFailure` hook marks run `failed` in DB

### 7.4 Sleep/Wake

**Sleep** (`POST /api/agents/:id/sleep`):
- Sets `agents.sleeping = true`
- Pauses agent's active runs (cascades to supervisor children)
- New runs for sleeping agent return 409

**Wake** (`POST /api/agents/:id/wake`):
- Clears `sleeping`
- Emits `run/resumed` for paused runs + paused supervisors waiting on them

### 7.5 Cancel

`cancelRun()`:
- Sets `status = 'cancelled'` on run + unfinished children
- Cascades same as pause
- Cancelled/finished runs cannot be resurrected (resume is idempotent and bails)

---

## 8. Token and Cost Tracking

### 8.1 Per-Run Tracking

**Usage sink** (`graph.ts:89-99`):
```typescript
const usage = makeUsageSink(); // { add(input, output), total() }
```
- Created fresh per `runAgent()` / `resumeAgentRun()` invocation
- Passed through all nodes via `GraphDeps`
- `generateTextWithFallback` / `generateObjectWithFallback` extract usage from AI SDK result

**Token persistence** (`graph.ts:866-873`):
```typescript
async function persistedTokensUsed(runId): Promise<number>
```
- Reads `agent_runs.tokens_used`
- Run that parked on approval keeps tokens spent before parking
- Resume starts fresh sink → `finalizeRun` adds `usage.total() + persistedTokensUsed()`

### 8.2 Group Token Accounting

- Group run `tokens_used` = cumulative across all member turns
- Consult tokens charged to member turn → group budget (`graph.ts:590-594`)
- Parent run persists rolling summary with token tally
- Guardrail: `tokenBudget` stops routing when exceeded

### 8.3 Provider Usage Meter

`provider_usage` table (migrations 0001, 0004):
- One row per model attempt (including skips)
- Fields: `user_id`, `provider`, `model`, `run_id`, `status`, `input_tokens`, `output_tokens`, `latency_ms`, `detail`
- Daily aggregation via `usageToday(userId)` → per provider/model: calls, tokens, errors
- Exposed at `/api/models` and admin dashboard

### 8.4 Cost Controls

**Hard limits:**
- `MAX_AGENT_STEPS = 10`
- `MAX_TOOL_ROUNDS_PER_STEP = 4`
- Group `tokenBudget` (1,000-500,000)
- Recursion limit 150 (single) / 80 (group)

**Free-tier protections:**
- Inngest quota: 50k exec/mo → batch work, keep short chats off Inngest
- Supabase: 500 MB DB → retention indexes on `provider_usage.created_at`
- Vercel: 300s function max → long runs in Inngest only
- 429 handling: backoff + cross-provider fallback

**Model-level:**
- `privateOk` flag prevents private context leakage to non-private models
- Capability gates prevent calling models that can't serve the request
- Embedding model fixed (Gemini `gemini-embedding-001`, 768-dim) — never switches with chat model

---

## 9. Key Files Reference

| Concern | Files |
|---------|-------|
| Model registry/resolver/fallback | `apps/api/lib/models/{registry,resolver,fallback,generate,usage,capability}.ts` |
| Agent graph (state, nodes, routing) | `apps/api/lib/agent/{state,tools,graph,execute,pause,sleep,runs}.ts` |
| Checkpointer | `apps/api/lib/agent/checkpointer.ts` |
| Approvals | `apps/api/lib/approvals.ts` |
| Skills | `apps/api/lib/skills/{load,sync,index}.ts` |
| Memory | `apps/api/lib/memory/extract.ts`, `apps/api/lib/knowledge/search.ts` |
| MCP discovery/loading | `apps/api/lib/mcp/{discovery,tools-loader,registry,connections,providers}.ts` |
| Inngest functions | `apps/api/lib/inngest/functions.ts` |
| Group runtime | `apps/api/lib/agent/group.ts`, `apps/api/lib/groups/{store,tools,privacy,types}.ts` |
| Supervisor | `apps/api/lib/agent/supervisor.ts` |
| Chat streaming | `apps/api/lib/chat/{stream,system-prompt,agent-scope}.ts` |
| Database schema | `db/migrations/000{1-18}_*.sql` |
| Shared types | `packages/shared/src/{models,agents,skills,groups,tools,mcp,routines,canvas}.ts` |

---

## 10. Architecture Diagram

```
┌─────────────────────────────────────────────────────────────────┐
│                        USER REQUEST                              │
└──────────────────────────┬──────────────────────────────────────┘
                           ▼
┌─────────────────────────────────────────────────────────────────┐
│  POST /api/chat (short)          POST /api/agents/run (long)    │
│  ──────────────────────          ──────────────────────────     │
│  buildSystemPrompt()             createRun() → agent_runs row   │
│  createChatStream()              emit agent/run.requested       │
│  streamText() + fallback         (Inngest)                      │
└──────────────────────────┬──────────────────────────────────────┘
                           ▼
┌─────────────────────────────────────────────────────────────────┐
│                    INNGEST agentRunFunction                      │
│  step.run("execute-agent-graph") → executeRun()                 │
│         │                                                        │
│         ▼                                                        │
│  ┌─────────────────────────────────────────────────────────┐    │
│  │                  runAgent() / runGroup()                 │    │
│  │  1. loadMcpToolsForRun()  2. loadSkillIndexForRun()      │    │
│  │  3. buildGraph() with Postgres checkpointer              │    │
│  │  4. invokeGraph() → compiled.invoke(input, {recursionLimit})│
│  └─────────────────────────────────────────────────────────┘    │
└──────────────────────────┬──────────────────────────────────────┘
                           ▼
┌─────────────────────────────────────────────────────────────────┐
│                    LANGGRAPH EXECUTION                           │
│  plan → act_llm → tool_gate → tool_exec → observe → finalize   │
│       ↑                    │             │                       │
│       └────────────────────┴─────────────┘                       │
│                           │                                      │
│         ┌─────────────────┼─────────────────┐                   │
│         ▼                 ▼                 ▼                   │
│   approve/deny        pause/cancel      error/fail             │
│   (interrupt)         (assertRunActive) (failRun)              │
│         │                 │                 │                   │
│         ▼                 ▼                 ▼                   │
│   Inngest            Inngest           updateRun               │
│   approval/decided   run/resumed       (failed)                │
│         │                 │                                      │
│         └─────────────────┼─────────────────┐                   │
│                           ▼                 ▼                   │
│              resumeAgentRun()        finalizeRun()              │
│              invoke(null)            tokens + result            │
└─────────────────────────────────────────────────────────────────┘
```

---

*End of Technical Plan*