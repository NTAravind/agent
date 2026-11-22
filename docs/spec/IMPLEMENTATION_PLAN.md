# Implementation Plan

Build vertical slices. Each phase ends in something you can use. Estimates assume solo, part-time.

## Phase 0: Setup (1–2 days)
- [x] Monorepo (`apps/api` Next.js, `apps/mobile` Expo, `packages/shared` zod schemas)
- [x] Supabase project provisioned; GitHub OAuth was previously used for app sign-in and can now be disabled
- [x] Switch app sign-in to email/password, remove GitHub from sign-in, remove `ALLOWED_USER_ID` API authorization, and enforce one account in code and a Supabase migration.
- [ ] Apply `db/migrations/20261122132549_single_account_auth.sql` after confirming the project has no duplicate Auth users.
- [x] use shadcn ui for ui in next js project 
- [x] Vercel deploy, env vars, Inngest app connected
- [x] GitHub Actions cron keepalive for Supabase
- [ ] Install providers: `@ai-sdk/google`, `@ai-sdk/groq`, `@openrouter/ai-sdk-provider` (plus `@ai-sdk/mistral`, `@ai-sdk/deepseek`, `@ai-sdk/huggingface`, `@ai-sdk/cohere` from Phase 0.5); add the API keys to Vercel env — packages installed and Google + Groq keys verified live; the OpenRouter key must be re-copied (it must start with `sk-or-v1-`) and the keys must also be added to the Vercel environment.
**Done when:** signed-in Expo app calls a protected `/api/health`. → done (verified 2026-11-13).

## Phase 0.5: LLM provider layer (1–2 days)
All model access goes through one module, `apps/api/lib/models/`. No route, graph node or Inngest function may import a provider package directly. (Revised from `packages/shared/models.ts`: provider SDKs are server-only, so the runtime layer lives in the API app; `packages/shared/src/models.ts` keeps the registry *types* and zod schemas, which the mobile app imports.)
- [x] **Model registry** (code, typed). One entry per model: `id` (`"google:gemini-flash"`), `provider`, `providerModelId`, `label`, capability flags `{ tools, vision, structuredOutput, reasoning, pdf }`, `contextWindow`, `private_ok` (safe for note-derived context), `tier` (`free`/`paid`). → `apps/api/lib/models/registry.ts`
- [x] **Resolver** `getModel(id)` → AI SDK `LanguageModel` using the matching provider instance (`google`, `createGroq`, `createOpenRouter`, `createMistral`, `createDeepSeek`, `createHuggingFace`, `createCohere`). Unknown id or missing API key → typed error. → `apps/api/lib/models/resolver.ts`
- [x] **Four more providers** (Mistral, DeepSeek, Hugging Face, Cohere): provider SDKs installed, resolver cases added, live catalog fetchers + mappers wired into `refreshProviderCatalog`, dashboard and mobile label them, `db/migrations/0013_widen_provider_check.sql` widens the `provider_models` check. Key any subset via `MISTRAL_API_KEY`, `DEEPSEEK_API_KEY`, `HUGGINGFACE_API_KEY`, `COHERE_API_KEY` (server-only).
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
`openrouter:gemini-3.8-flash`, `openrouter:qwen3.8-27b`,
`mistral:mistral-large-latest`, `mistral:mistral-small-latest`, `mistral:open-mistral-nemo`,
`deepseek:deepseek-chat`, `deepseek:deepseek-reasoner`,
`cohere:command-a-03-2025`, `cohere:command-r-plus`,
`huggingface:meta-llama/Llama-3.3-70B-Instruct`, `huggingface:Qwen/Qwen3.8-27B`.
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
- [x] Shared `Canvas` zod schema, renderer for core components, fixtures first
- [x] `render_canvas` / `update_canvas`, `canvases` table, Canvas tab
- [x] Data sources + pull-to-refresh + Inngest scheduled refresh
**Done when:** "make a dashboard of X" yields a native, refreshable canvas.
**Status (2026-11-15): DONE — verified on deployed app.** Canvas creation (POST
/api/canvases), listing (GET /api/canvases), detail (GET /api/canvases/:id),
update (PUT), delete (DELETE), and refresh (POST /api/canvases/:id/refresh)
all work. Data-bound markdown/list components are rewritten on refresh
(web_search → search_notes → recall_memory pipeline, no LLM). Inngest
canvas-refresh cron (0 6 * * *) registered. Mobile Canvas tab lists cards,
detail renders native components (stat, chart line/bar/pie, table with sticky
col, list, markdown, image, button, tabs, stack, unknown-block fallback).
Pull-to-refresh + "refresh" button both call the refresh endpoint. The agent's
render_canvas / update_canvas tools are wired; the deployed app creates
canvases via the API and they appear in the Canvas tab.

## Phase 5.1: Provider model dashboard + task model chooser
- [x] Apply `db/migrations/0006_provider_models.sql` to create an empty provider catalog, then `0007_remove_provider_model_seeds.sql` to clean up seed rows if the earlier draft was already applied.
- [x] Web dashboard (Supabase-authenticated) refreshes model catalogs from the configured Google, Groq and OpenRouter providers; API keys remain server-only.
- [x] Persist the provider catalog and per-model mobile availability; only enabled models appear in the mobile app.
- [x] Show provider key status and provider/model usage from `provider_usage` in the dashboard.
- [x] Add a model chooser to the mobile agent-task composer; selected model is used as the task's preferred model, with configured cross-provider fallbacks.
**Done when:** the dashboard refreshes provider catalogs, toggling a model changes the models offered to mobile, the task chooser routes the run through that model, and provider usage is visible by provider/model.

## Phase 6: MCP store (4–6 days)
- [x] Seed registry (hand-pick 5–10 remote servers)
- [x] Connect flows (none / API key / OAuth), encrypted credentials
- [x] Per-agent tool enablement, approval flags, runtime tool loading
**Done when:** add a server in ≤ 3 taps and use its tool in the next run.

> **DONE (2026-11-17), verified end-to-end on the deployed app:**
> - Migration `0008` applied (6 tables + 10 verified seeds); `ENCRYPTION_KEY`
>   active on Vercel (AES-256-GCM ciphertext proof, `key_version=v1`).
> - Context7 connected in 3 taps (marketplace → detail → Connect), attached to
>   the Personal agent; run used `mcp_context7_resolve_library_id` and
>   `mcp_context7_query_docs` with real `/vercel/next.js@16.4.5` docs in the
>   answer (model `openrouter:openrouter/free`).
> - Approval gate paused/resumed twice (once per MCP tool) with
>   `MCP tool "…" from Context7` reasons; Inngest resume worked both times.
> - Multi-attach (context7+exa), per-tool enable/approval toggles, disconnect
>   detaches tools, admin catalog CRUD, stranger-user 403 on every Phase 6
>   route, OAuth start (PKCE + DCR URL) — all verified.
> - 30 unit tests (encryption/tamper, SSRF, risk, namespacing, redaction);
>   typecheck + lint + production build green.
>
> Deviations from the prompt: approvals reuse the shared `lib/approvals.ts`
> (+ existing `approval-resume` function) instead of a new `lib/mcp/approvals.ts`;
> `agents.avatar` is jsonb (not `avatar_emoji`); Context7 tools classify `medium`
> (approval on) because their descriptions say "call this function" — the safe
> default, user-overridable per tool in the UI.

> **Addendum (2026-11-18) — full listing CRUD + setup instructions:**
> - Migration `0009_mcp_listing_instructions.sql` adds `instructions` to
>   `mcp_servers` (applied). Listing create/update validated by shared zod
>   (`MCPServerCreateSchema` / `MCPServerPatchSchema`); list/detail responses
>   now camelCase via `toPublicServer` (fixes mobile auth-type/verified/free
>   chips); `GET /api/mcp/servers?all=1` returns disabled listings for admins;
>   duplicate slug → 409.
> - Dashboard gained a 4th **Integrations** tab (shadcn/ui only): search,
>   create/edit dialog with Instructions textarea, enable/disable switch,
>   delete behind a cascade-confirm dialog. Mobile detail screen shows a
>   "Setup instructions" card when the listing has `instructions`.
> - Verified: lint 0 errors, typecheck green, `next build` green, 69 unit
>   tests (9 new listing-schema tests).

## Phase 7: Multi-agent (5–7 days)
- [x] Agent CRUD (each agent has primary model + fallbacks); supervisor graph; specialist subgraphs
- [x] Agent avatar column and editor picker (Emoji, Icon and Upload) with color swatches
- [x] Optional image avatar upload through a signed Storage URL
- [x] Show agent avatars in chat, thread list, run timeline, Agents list and approvals
- [x] Cross-check pattern: verifier runs on a *different provider* than the worker
- [x] Parallel research fan-out, verifier node, nested timeline
**Done when:** supervisor delegates to 2+ agents and merges cross-checked results.

> **DONE (2026-11-18), verified end-to-end (3 slices, local):**
> - **Slice A `d8bf3a3`** — agent CRUD (`AgentCreateSchema`/`AgentPatchSchema`),
>   migration `0010` (stale `agents.model` placeholder default dropped), list
>   responses carry the full avatar object + `toolCount` (`check-agent-crud.mjs` 8/8).
> - **Slice B `8761618`** — private `avatars` Storage bucket (migration `0011`,
>   signed upload/read URLs, response-only `url` stripped on write), embedded
>   `AgentSummary` in threads/runs/messages/run-detail, chat `agentId`,
>   AgentPicker in chat + message-bubble avatars, run header/approval avatars,
>   editor Emoji/Icon/Upload picker (`check-agent-avatars.mjs` 10/10).
> - **Slice C `beeb4c7`** — supervisor graph `delegate → fan_out → verify → merge`
>   in `lib/agent/supervisor.ts`, dispatched by `executeRun` (`lib/agent/execute.ts`)
>   for `is_supervisor` agents; child runs (`parent_run_id`) run in parallel with
>   `approvalMode: "deny"` (children auto-deny instead of parking — v1 decision);
>   cross-provider verifier (`pickCrossProviderModel`); run detail `children`,
>   top-level run list excludes children; mobile task picker (supervisor-first
>   default), Specialists section, editor Supervisor switch; inline run
>   (`?inline=true`) for E2E without Inngest. `check-supervisor.mjs` 11/11 +
>   `supervisor.test.ts` (9 cases).
> - Deviations from spec, resolved in code first (spec updated 2026-11-18):
>   supervisor is a dedicated graph, not a `delegate(agent, task)` tool (API_SPEC §8
>   row removed); the `GET /api/runs/:id/events` row was removed (events are
>   embedded in `GET /api/runs/:id`); MCP per-tool permissions stay on the
>   agent's tools list; sensitive tools in *child* runs auto-deny rather than
>   pause (v1; the supervisor's own tool gate is unchanged).

## Phase 8: Skills — progressive disclosure (3–5 days)
- [x] Shared zod schemas (`SkillCreateSchema` / `SkillPatchSchema`), `skills` + `agent_skills` tables (`db/migrations/0015_skills.sql`)
- [x] Vault as source of truth: `skills/<slug>/SKILL.md` (frontmatter `name`, `description`, `tools[]`); Supabase row is the searchable index
- [x] Agent prompt carries only name + description; `load_skill` returns the body on demand (assigned skills only) and narrows the tool set (intersection only)
- [x] API: `GET/POST /api/skills`, `PATCH/DELETE /api/skills/:id`, `PUT /api/agents/:id/skills`
- [x] Mobile Skills screen (More → Skills) with editor and per-agent assignment
**Done when:** an agent loads an assigned skill and its instructions change the run.
**Status (2026-11-21): DONE — verified.** Live check `apps/api/scripts/check-skills.ts`; `finalize` receives the trusted loaded-skill bodies (max 4, deduped by slug).

## Phase 9: Productivity — tasks, calendar, notes editing, reminders (5–7 days)
- [x] Migration `db/migrations/0016_tasks_calendar.sql`: `task_lists`, `tasks`, `calendar_events`, `push_tokens`, `reminder_log` (RLS, soft delete, `created_by` + `source_run_id`)
- [x] Shared schemas (`packages/shared/src/tasks.ts`); snake_case↔camelCase mappers (`apps/api/lib/productivity.ts`)
- [x] API: `/api/task-lists`, `/api/tasks`, `/api/events` (RRULE expanded on read), `/api/push-tokens`, `PUT/DELETE /api/notes/:path` (vault commit, no approval)
- [x] Agent tools: `create_task`, `list_tasks`, `update_task`, `complete_task`, `delete_task`, `create_event`, `list_events`, `update_event`, `delete_event`, `find_free_slots`; conditional approval for edits to user-created rows
- [x] `extractMemories` writes detected tasks as `created_by='suggested'` rows (not memories)
- [x] Reminders: `reminder/tick` cron (every minute), claim-then-send via `reminder_log`, Expo push
- [x] Mobile: Today tab, Tasks screen, Calendar screen, note editor, push registration
**Done when:** the user manages tasks/events/notes in the app, an agent run can add both, a reminder push arrives once, a weekly event expands correctly, and an agent delete of a user item parks for approval.
**Status (2026-11-21): DONE — verified.** `check-tasks.ts` 24/24 locally, `check-deployed.ts` 9/9 against production.

## Phase 10: Routines — chat-first scheduling (5–7 days)
- [x] Migration `db/migrations/0017_routines.sql`: `routines` table (structured schedule + RRULE + timezone), `agent_runs.routine_id` / `scheduled_for` (unique) / `tz`, `agents.primary_thread_id`; RLS + `updated_at` trigger
- [x] Server-side schedule conversion (structured → RRULE → next 3 occurrences in the user's timezone); never trust model-computed dates — `apps/api/lib/routines/schedule.ts` (own timezone-aware wall-clock math; `rrule@2.8` ignores `tzid` for `BYHOUR`)
- [x] Agent tools `create_routine`, `list_routines`, `update_routine`, `pause_routine`, `resume_routine`, `delete_routine`; `data-routine-proposal` UI part
- [x] `routine/tick` cron (every minute): idempotent run creation, trigger message in the bound thread, overlap/missed-run/failure guardrails (3 failures → auto-pause)
- [x] API: `/api/routines` CRUD + `activate`, `run-now`, `/runs`
- [x] Mobile: proposal card, trigger-message chip, routine sheet in the chat header (clock icon), Routines list under More, agents-as-chats (primary thread)
- [x] Current date/time/timezone injected into the chat + agent system prompts
**Done when:** "every Monday at 9 do X" yields a proposal card with correct IST dates; after Confirm the result posts into the same chat with a push; a reply can update the routine; a sensitive tool parks the run; 3 consecutive failures auto-pause.
**Status (2026-11-21): DONE — verified.** `check-routines.ts` 27/27 locally, `check-routine-chat.ts` 8/8 (the chat-first proposal part), `check-deployed.ts` 14/14 against the local server (the production deploy still has to pick up the new routes).

## Phase 11: Agent groups & handoff (5–7 days)
- [x] Migration `db/migrations/0018_agent_groups.sql`: `agent_groups`, `group_members`; `threads.group_id`; `messages.from_agent_id` / `to_agent_id` / `handoff` / `run_id`; `agent_runs.group_id` / `group_context` / `group_depth`; explicit ownership-aware RLS, grants, indexes, constraints, updated-at trigger, and the transactional `replace_group_members` RPC
- [x] Group graph `route → agent_turn → route → … → finalize`, sequential child runs per member turn, `approvalMode: "gate"` so approvals park the parent; Supervisor remains a separate graph
- [x] Group tools `handoff_to`, `ask_agent`, `post_to_group`; caller resolved from run context and targets validated against owned group membership server-side; the tools survive the late-round heuristic and skill narrowing
- [x] Guardrails: `max_hops`, A→B→A→B ping-pong detection, per-group token budget (consult tokens included), reachable nested-ask depth; strip private context and note/memory tools when the target model is not `private_ok`, and refuse a handoff/consult from a private-capable member to a non-private member
- [x] Compact member context: bounded handoff brief + rolling group summary, never the full transcript; the summary is persisted on the parent run so a follow-up continues from it
- [x] Approval resume re-reads the live membership and privacy policy from the group and the run row's `agent_id`; approval usage carries forward so the token total is cumulative
- [x] Shared Zod contracts in `packages/shared/src/groups.ts` (plus the shared run list/child/detail schemas); API `/api/groups` CRUD + `/api/groups/:id/members`, group-thread creation, group run entry, and child-run timelines
- [x] Route guards: `/api/chat` refuses a group thread (409 `group_thread`); a group run refuses an explicit `agentId`/`model` (400), a sleeping member (409), and a concurrent parent (409); a group with a live run cannot be deleted (409)
- [x] Mobile: Groups under More, group editor/chat, member avatars, handoff chips, child-run links, and `@agent` mentions; a group thread routes to the group screen from both the Conversations list and the chat screen; the group screen accepts a `threadId` and restores the live parent run on mount
**Done when:** a 3-agent group completes a task through ≥2 handoffs, the chat shows who handed what, a ping-pong stops at the guard, and a handoff to a non-`private_ok` agent carries no private context.
**Status (2026-11-22): IMPLEMENTED — code/unit/local data-plane checks pass; live model acceptance passes.** `check-groups.ts` passes 25/25 against the local API and shared Supabase project (CRUD, transactional membership replacement, durable group thread/run entry, the `run_id`-linked user message, the chat-route 409, the mixed-body 400, the concurrent-parent 409, the sleeping-member 409, the delete guard, a deterministic member child turn with its `{from,to,task}` handoff, RLS visibility, and a cancel-then-delete cleanup that verifies zero remaining rows including the group and its membership). Group unit coverage includes membership/mentions, hop/token/ping-pong/depth guards, privacy stripping/tool filtering, consult privacy, the private-caller boundary, group-tool protection across rounds, schemas, and summary compaction. `check-groups-live.ts` passes 11/11 with real models: a three-member group completes the task through **two visible handoffs**, the markers name the next member, the group chat shows both handoffs, and the lead publishes a final answer. Provider caveat: the acceptance run used Groq's free tier (`gpt-oss-20b` for the handing-off members, `qwen3.8-27b` for the editor) because the Google free quota and the `gpt-oss-120b` daily token budget were exhausted; production must also be redeployed before the deployed route check can pass.

**Deviation:** `handoff_to` persists a handoff marker across the existing single-agent child-graph boundary instead of returning a LangGraph `Command`, because member turns execute as independently checkpointed child runs. The parent graph resumes from its checkpoint after the child completes. The privacy boundary is the *caller's* policy rather than a text filter: a private-capable member may not hand work or a question to a non-private member at all, because a copied private fact is indistinguishable from ordinary prose.

## Phase 12: Extras (as wanted)
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
