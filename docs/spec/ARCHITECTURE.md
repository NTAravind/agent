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

## 4. Security model
- Single allowed user; every API route verifies the Supabase JWT and `ALLOWED_USER_ID`. RLS on all tables as defense in depth.
- Secrets only in Vercel env; MCP credentials encrypted at rest; decrypted only server-side at run time.
- **Prompt injection:** treat all web content, files, and MCP tool descriptions/results as untrusted. Sensitive tools (send, delete, pay, write notes, push to repo) require approval by default. Never let tool output change the tool allow-list.
- Canvas actions are a fixed enum; no eval, no model-supplied code. WebView HTML is sandboxed (no network, no native bridge).
- Context derived from your notes/memories is sent only to models marked `private_ok`. Treat free tiers of any provider as possibly logged/trained on unless its terms say otherwise (verify).
- Rate-limit endpoints; cap per-run steps and tokens to protect free quotas.

## 5. Failure handling
Retries with backoff (Inngest); model fallback on 429; run marked `failed` with error in `run_events`; idempotency keys on side-effecting tools; max-step guard in every graph.
