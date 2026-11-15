# Implementation Plan

Build vertical slices. Each phase ends in something you can use. Estimates assume solo, part-time.

## Phase 0: Setup (1–2 days)
- [x] Monorepo (`apps/api` Next.js, `apps/mobile` Expo, `packages/shared` zod schemas)
- [x] Supabase project, GitHub OAuth, allow-list your account
- [x] use shadcn ui for ui in next js project 
- [x] Vercel deploy, env vars, Inngest app connected
- [x] GitHub Actions cron keepalive for Supabase
- [ ] Install providers: `@ai-sdk/google`, `@ai-sdk/groq`, `@openrouter/ai-sdk-provider`; add the 3 API keys to Vercel env — packages installed and Google + Groq keys verified live; the OpenRouter key must be re-copied (it must start with `sk-or-v1-`) and the 3 keys must also be added to the Vercel environment.
**Done when:** signed-in Expo app calls a protected `/api/health`. → done (verified 2026-11-13).

## Phase 0.5: LLM provider layer (1–2 days)
All model access goes through one module, `apps/api/lib/models/`. No route, graph node or Inngest function may import a provider package directly. (Revised from `packages/shared/models.ts`: provider SDKs are server-only, so the runtime layer lives in the API app; `packages/shared/src/models.ts` keeps the registry *types* and zod schemas, which the mobile app imports.)
- [x] **Model registry** (code, typed). One entry per model: `id` (`"google:gemini-flash"`), `provider`, `providerModelId`, `label`, capability flags `{ tools, vision, structuredOutput, reasoning, pdf }`, `contextWindow`, `private_ok` (safe for note-derived context), `tier` (`free`/`paid`). → `apps/api/lib/models/registry.ts`
- [x] **Resolver** `getModel(id)` → AI SDK `LanguageModel` using the matching provider instance (`google`, `createGroq`, `createOpenRouter`). Unknown id or missing API key → typed error. → `apps/api/lib/models/resolver.ts`
- [x] **Fallback chain** `withFallback([primary, ...fallbacks])`: on 429, 5xx, timeout or provider error, retry once with backoff, then move to the next model. Skip fallbacks lacking a capability the request needs (e.g. images → needs `vision`, tool-using agent → needs `tools`). → `apps/api/lib/models/fallback.ts`
- [x] **Capability gate:** reject or reroute before calling if the request needs something the chosen model lacks. → `apps/api/lib/models/capability.ts`
- [x] **Usage tracking:** write each call to `provider_usage` (provider, model, tokens, status); expose to the usage meter. → `apps/api/lib/models/usage.ts` + `db/migrations/0001_provider_usage.sql`
- [x] **Embeddings stay on one fixed provider/model** (Google by default, *verify*) regardless of chat model, so vectors remain comparable. Changing embedding model means re-embedding everything. → `apps/api/lib/models/embeddings.ts` (`gemini-embedding-001`, 768 dims)
- [x] `/api/models` returns registry + which providers have keys + today's usage.
**Done when:** the same prompt runs on Google, Groq and OpenRouter by changing only the model id, and a forced 429 on the primary falls through to the next model.

Live check: `npm run check:providers --workspace api` (runs the same prompt on each provider, then forces a 429 on the primary and asserts the chain falls through). Unit tests: `npm test`.

Sketch:
```ts
import { google } from "@ai-sdk/google";
import { createGroq } from "@ai-sdk/groq";
import { createOpenRouter } from "@openrouter/ai-sdk-provider";

const groq = createGroq({ apiKey: process.env.GROQ_API_KEY });
const openrouter = createOpenRouter({ apiKey: process.env.OPENROUTER_API_KEY });

export function getModel(id: string) {
  const [provider, ...rest] = id.split(":"); const m = rest.join(":");
  switch (provider) {
    case "google": return google(m);
    case "groq": return groq(m);
    case "openrouter": return openrouter.chat(m);
    default: throw new Error(`Unknown provider: ${provider}`);
  }
}
```
Model ids in the registry are placeholders: pick current ids from each provider's docs at build time, since model lineups and free tiers change often.

Registry ids as implemented (verified against provider docs on 2026-11-13, `apps/api/lib/models/registry.ts`):
`google:gemini-3.8-flash`, `google:gemini-3.6-flash`, `google:gemini-3.5-flash-lite`, `google:gemini-4-argon` (paid),
`groq:gpt-oss-120b`, `groq:gpt-oss-20b`, `groq:qwen3.8-27b`,
`openrouter:gemini-3.8-flash`, `openrouter:qwen3.8-27b`.
Notes: Groq's `llama-3.1-8b-instant` / `llama-3.3-70b-versatile` were shut down for free and developer tiers on 2026-08-16; `gemini-2.5-flash` / `gemini-2.5-pro` are deprecated on Google and route to newer models from 2026-12-01.

## Phase 1: Chat (3–5 days)
- [ ] `/api/chat` with `streamText` + `getModel()` (default `google:*`; request may pass `model`), `useChat` in Expo (`expo/fetch`)
- [ ] Model picker in composer; show provider and capability badges
- [ ] Persist threads/messages; thread list
- [ ] Image + PDF/text attachments (Storage + file parts)
- [ ] Fallback chain wired into chat, error UI showing which provider failed
**Done when:** multi-turn chat with images streams reliably on a real phone.

## Phase 2: Search + notes + memory (5–7 days)
- [x] Web search + `fetch_page` tools with citations (Tavily free tier — verified 2026-11: 1,000 credits/mo, no card; Brave requires a card)
- [x] GitHub vault sync → chunks → embeddings → hybrid search RPC (`db/migrations/0003_notes.sql` — **needs to be applied in the Supabase SQL editor**)
- [x] `search_notes`, `read_note`; notes screen with backlinks (plus `save_memory` / `recall_memory` / `list_memories` tools)
- [x] Inngest `chat/completed` memory extraction; memory viewer (`/memories` screen, GitHub webhook `/api/webhooks/github`, manual `POST /api/notes/sync`)
- Status: code complete and verified locally (tool calling, streaming, persistence). Blocked on user actions: apply migration 0003, set `TAVILY_API_KEY`, `GITHUB_VAULT_TOKEN`/`GITHUB_VAULT_REPO`, redeploy.
**Done when:** agent cites an old note and recalls a stated preference in a new thread.

## Phase 3: Agent graph (5–7 days)
- [x] LangGraph single agent (plan → act → observe), Postgres checkpointer, max-step guard (`apps/api/lib/agent/` — state, graph, checkpointer, runs; `db/migrations/0005_agent_runs.sql` — **needs to be applied**; max 10 act steps, 5 tool rounds per act)
- [x] Graph nodes obtain models only via `getModel()`/`withFallback`; per-node model choice (fast lite model for plan/observe/self-correct, default for act, strongest for finalize — all `privateOk`, Groq/OpenRouter remain cross-provider fallbacks)
- [x] Run via Inngest durable steps; `agent_runs`/`run_events`; timeline UI (Inngest `agent-run` function with checkpointer resume + onFailure; `POST /api/agents/run`, `GET /api/runs`, `GET /api/runs/:id`; mobile Agents screen + run timeline with polling)
- [x] Retry/self-correction node (`self_correct` on failed steps, `revise` from observe)
- Pending: user to provide `DATABASE_URL` (Supabase pooler URI) for the checkpointer; end-to-end run verification.
**Done when:** a 5-minute research task runs after closing the app and posts its result.

## Phase 4: Approvals (2–3 days)
- [x] `interrupt()` + `approvals` + approval card + `approval/decided` resume
- [x] `write_note` and other sensitive tools gated
**Done when:** deny re-plans, approve proceeds, expiry works.
**Status (2026-11-15): DONE — verified locally and on the deployed app,
including the phone approval-card test.** Approve → Inngest `approval-resume`
resumed the graph and the write landed in the vault; deny → agent re-planned
without writing; expiry → TTL-passed approvals treated as denied. Fixes found
during verification: LangGraph JS `invoke()` resolves on interrupt (detected
via `__interrupt__` on the result, not a throw); recursion limit raised to 150
for the checkpointed act loop; act/finalize prompts treat `written/stored`
tool results as authoritative (the vault index syncs asynchronously).

## Phase 5: Canvas (4–6 days)
- [ ] Shared `Canvas` zod schema, renderer for core components, fixtures first
- [ ] `render_canvas` / `update_canvas`, `canvases` table, Canvas tab
- [ ] Data sources + pull-to-refresh + Inngest scheduled refresh
**Done when:** "make a dashboard of X" yields a native, refreshable canvas.

## Phase 6: MCP store (4–6 days)
- [ ] Seed registry (hand-pick 5–10 remote servers)
- [ ] Connect flows (none / API key / OAuth), encrypted credentials
- [ ] Per-agent tool enablement, approval flags, runtime tool loading
**Done when:** add a server in ≤ 3 taps and use its tool in the next run.

## Phase 7: Multi-agent (5–7 days)
- [ ] Agent CRUD (each agent has primary model + fallbacks); supervisor graph; specialist subgraphs
- [ ] Agent avatar column and editor picker (Emoji, Icon and Upload) with color swatches
- [ ] Optional image avatar upload through a signed Storage URL
- [ ] Show agent avatars in chat, thread list, run timeline, Agents list and approvals
- [ ] Cross-check pattern: verifier runs on a *different provider* than the worker
- [ ] Parallel research fan-out, verifier node, nested timeline
**Done when:** supervisor delegates to 2+ agents and merges cross-checked results.

## Phase 8: Extras (as wanted)
Website monitors → image generation (verify free) → voice (device APIs) → code sandbox → X data (paid).

## Testing
- Unit: zod schemas, chunker, wikilink parser, encryption round-trip, model resolver, fallback ordering, capability gate.
- Provider contract tests: one tool-call prompt, one structured-output prompt, one image prompt per registry model (run manually, they consume quota).
- Integration: graph with mocked LLM/tools, approval resume, vault sync on a fixture repo.
- Security: prompt-injection fixtures (malicious page/tool result must not trigger tools); RLS tests with a second user.
- Manual: real-device streaming, airplane-mode behavior.

## Risks
| Risk | Mitigation |
|---|---|
| Free quotas change/exhaust | Usage meter, step/token caps, cross-provider fallback, re-verify limits quarterly |
| Models differ in tool-calling, vision and structured-output reliability | Capability flags + contract tests; don't assume a model supports a feature |
| Free/community models may log or train on prompts (check each provider's terms) | `private_ok` flag; note-derived context only goes to `private_ok` models |
| OpenRouter provider is community-maintained | Pin version; isolated behind `getModel()` so it can be swapped |
| Provider package/API changes | Single integration module, version pins |
| Supabase pause | Keepalive cron, runbook to unpause |
| Gemini privacy on free tier | Don't send private notes by default; add a per-agent "private" model setting |
| Streaming issues on device | XHR transport fallback |
| Prompt injection via MCP/web | Approval defaults, untrusted-content handling, allow-lists |
| Scope creep | Ship phases in order; each has a done-when |

## Definition of done (v1)
Phases 0–6 (including 0.5) complete, with Google, Groq and OpenRouter selectable and falling back automatically, running on Vercel + Supabase + Inngest free tiers, installed on your phone, with usage meter and backups of the vault in GitHub.
