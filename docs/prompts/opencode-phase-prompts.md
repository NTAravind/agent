# OpenCode Prompts — One Per Phase

**Setup (once):** put the spec in the repo root as `SPEC.md` and the rules from the previous file (Part A) in `AGENTS.md`.
**Usage:** start a fresh OpenCode session per phase, paste that phase's prompt, and don't move on until the milestone is verified.

Every prompt is self-contained and repeats the key rules so it still works if `AGENTS.md` is missed.

---

## Phase 1 — Foundation

```text
Read AGENTS.md and SPEC.md fully. You are the lead engineer. This session is PHASE 1 — Foundation (SPEC section 20). Do not start Phase 2.

FIRST: summarize your understanding in under 15 lines, list files/folders you'll create, and list ambiguities with the default you'll pick. Then proceed.

BUILD
1. Monorepo: pnpm workspaces + Turborepo, structure from SPEC section 19 (apps/web, apps/mobile placeholder, apps/worker, packages/*, supabase/, infrastructure/). Shared strict tsconfig, ESLint, Prettier. Each package has package.json + src/index.ts public API.
2. shadcn/ui (monorepo-aware):
   - Create packages/ui as the shared shadcn package.
   - Run `pnpm dlx shadcn@latest init` so apps/web and packages/ui both have valid components.json with correct aliases.
   - Shared Tailwind theme tokens in one place; light + dark via next-themes.
   - Install via CLI: button, input, label, textarea, card, form, dialog, sheet, dropdown-menu, select, tabs, table, badge, avatar, skeleton, alert, sonner, separator, tooltip, sidebar, breadcrumb, command, scroll-area.
   - AppShell in apps/web using shadcn Sidebar with nav for the 16 sections in SPEC section 17 (stub pages OK), plus a theme toggle and a ui-demo page.
3. Supabase: SSR clients (server + browser). Migrations for profiles, workspaces, workspace_members (multi-workspace-ready, one personal workspace per user for now). RLS on every table. Signup trigger that creates profile + personal workspace.
4. Auth UI (shadcn Card + Form + zod): sign up, log in, log out, password reset. Middleware-protected routes.
5. Workspace: settings page (rename, details), workspace resolved server-side for all authenticated routes.
6. Inngest: configure in apps/worker with a health-check function and serve endpoint. Zod-validated env in packages/shared/env, plus .env.example per app.

RULES
- All web UI is shadcn/ui only, installed via CLI. No hand-written replicas, no other UI libs, no hardcoded colors, icons from lucide-react only.
- Every screen has loading (Skeleton), empty, and error (Alert) states and works in dark mode.
- No features from later phases beyond empty placeholder pages.

VERIFY (required before saying done)
- pnpm typecheck, lint, build pass. Tests for signup trigger / RLS where feasible.
- Write docs/phase-1.md: what was built, how to run, env vars, known gaps.

MILESTONE: A user can sign up, log in, and create/see their workspace in a polished shadcn/ui interface with dark mode.

FINISH WITH: (a) what's done, (b) how to run it, (c) decisions made on ambiguities, (d) anything needing my input (keys, Supabase project, etc.).
```

---

## Phase 2 — Agent Core

```text
Read AGENTS.md and SPEC.md (sections 5, 15, 13, 17, 18). Phase 1 is verified. This session is PHASE 2 — Agent Core. Do not start Phase 3.

FIRST: plan in under 15 lines, then proceed.

BUILD (backend first)
1. Database: agents, agent_configs, agent_tools, plus conversations/messages tables (add migrations + RLS scoped by workspace). Zod schemas for every entity in packages/shared.
2. packages/ai: provider abstraction (unified interface so providers can be added without touching the agent engine). Use the Vercel AI SDK for model calls and streaming. Support at least two providers, a default model, per-agent model selection, and fallback models. Provider API keys come from server env only.
3. packages/agent-core + packages/orchestration: LangGraph runtime for a single agent: load agent config, build system prompt, run reasoning loop, basic tool-calling interface (tools resolved through an interface, NOT hardcoded into agents). Add execution limits from agent config (max steps, tool calls, tokens).
4. Agent operations (server actions or route handlers with Zod validation): create, edit, delete, duplicate, enable/disable, assign tools. Fields per SPEC section 5: name, description, avatar, system instructions, model, temperature/generation settings, memory settings, execution limits, permission settings, autonomy level (Manual/Assisted/Supervised/Autonomous), status.
5. Conversation history persisted in DB (DB is source of truth). Streaming chat endpoint using AI SDK streaming. Track token usage per message in usage_records.

UI (shadcn/ui only, via CLI)
- Agents list: DataTable (shadcn Table + TanStack Table) with status Badge, row DropdownMenu (edit, duplicate, disable, delete with AlertDialog).
- Agent builder: multi-section Form using Tabs (General, Model & generation, Instructions, Limits, Autonomy & permissions). Slider for temperature, Switch for toggles, Select for model/autonomy level, Avatar upload.
- Agent chat: streaming message list in ScrollArea, input with Textarea + send Button, Skeleton while loading, error Alert, model/agent switcher.
- Add any new components with `pnpm dlx shadcn@latest add ...`. Every screen needs loading/empty/error states and dark mode.

RULES: no credentials in prompts or logs; keep LangGraph for reasoning only (no long-running work in request handlers beyond streaming chat); typed schemas everywhere.

VERIFY: typecheck, lint, build, tests for agent CRUD permissions (RLS), provider abstraction (mock provider), and the LangGraph loop limits. Write docs/phase-2.md.

MILESTONE: A user can create an agent and chat with it with streaming responses.

FINISH WITH: done / how to run / decisions / what I need to provide (API keys).
```

---

## Phase 3 — Credential Vault

```text
Read AGENTS.md and SPEC.md (sections 7, 14, 16 audit parts, 18, 22 security). Phases 1-2 are verified. This session is PHASE 3 — Credential Vault. Do not start Phase 4.

FIRST: plan in under 15 lines, then proceed. This phase is security-critical: write tests as you go.

BUILD
1. Database: connected_accounts, account_credentials, agent_account_permissions, credential_audit_logs. RLS on all. account_credentials must never be readable from the client (no client-side select policy; server/service role only).
2. packages/credential-vault:
   - AES-256-GCM authenticated encryption, random IV per record, key from server env (not DB), key version stored per record, support for key rotation (re-encrypt with new version).
   - Functions: connect account, store API token, encrypt, decrypt (server-only, never exported to client bundles), validate credential, refresh token, health check, disconnect, rotate.
   - Credential retrieval service that returns decrypted credentials ONLY to the capability execution layer, never to agents or the LLM.
   - Every access writes a credential_audit_logs row (who/what, account, purpose, result, timestamp).
3. OAuth infrastructure: generic OAuth start + callback routes with state + PKCE, provider config registry, token refresh. Implement Google (Gmail/Calendar) config as the first provider; add API-token flow for WhatsApp Business Cloud API (access token, phone number ID, WABA ID).
4. Permissions: agent_account_permissions with read / write / send / delete flags, account-specific restrictions, and approval requirement setting (always ask / ask for sensitive / auto). Central permission-check function with tests.
5. Log scrubbing: add a redaction utility so tokens can never appear in logs, task messages, or error output. Test it.

UI (shadcn/ui only)
- Connected accounts page: Cards or DataTable with provider icon, account name, health Badge, last-checked time, actions menu (revalidate, rotate, disconnect with AlertDialog).
- Connect account Dialog: provider Select, OAuth button or token Form (password-type inputs, zod validation), clear success/error Alert.
- Permission matrix: Table of agents x accounts with Checkbox/Switch per permission and a Select for approval policy.
- Audit log viewer: filterable Table with Badge for result and Sheet for detail.
- Loading/empty/error states and dark mode on all screens.

RULES: plaintext credentials never stored, logged, returned to the client, or placed in agent context. Encryption key never in DB.

VERIFY: unit tests for encrypt/decrypt/rotation/tamper detection, permission checks, redaction, RLS (a user cannot read another user's accounts or any credential payload). typecheck/lint/build. Write docs/phase-3.md including the key management and rotation procedure.

MILESTONE: A user can connect an external account securely and grant an agent scoped access.

FINISH WITH: done / how to run / decisions / what I need to provide (OAuth client IDs, encryption key generation command).
```

---

## Phase 4 — MCP Manager & Capability Registry

```text
Read AGENTS.md and SPEC.md (sections 8, 9, 7 credential flow, 18, 22). Phases 1-3 are verified. This session is PHASE 4 — MCP Manager & Capability Registry. Do not start Phase 5.

FIRST: plan in under 15 lines, then proceed.

BUILD
1. Database: mcp_servers, mcp_installations, capabilities, agent_capabilities, tool_execution_logs (+ RLS).
2. packages/mcp: MCP server registry, add/install/remove server, connection lifecycle (connect, health monitor, reconnect, disconnect), authentication, dynamic tool discovery, tool schema validation (Zod / JSON Schema), tool execution with timeouts and output size limits. Untrusted MCP servers run isolated (separate process/container boundary where feasible; restrict network access).
3. packages/capabilities: Capability Registry supporting four sources: MCP servers, native API integrations, internal platform tools, custom user-defined integrations. Each capability has: name, description, input schema, required permissions, connected-account requirements, execution endpoint, availability status.
4. Agent-facing meta-tools (this is the dynamic discovery mechanism; do NOT load every tool into every agent):
   - search_capabilities
   - inspect_capability
   - execute_capability
   Wire these into the LangGraph agent runtime from Phase 2.
5. Execution pipeline for execute_capability: validate input -> resolve connected account -> check agent permissions and approval policy -> fetch credential from vault server-side -> inject into the call -> execute -> sanitize result (strip secrets) -> write tool_execution_logs. The agent never sees credentials, and secrets never appear in tool descriptions or model context.
6. Build ONE working integration end to end as proof: a WhatsApp Business Cloud API MCP/native capability set (send_whatsapp_message, send_whatsapp_template, get_whatsapp_conversation, get_whatsapp_message_status, reply_to_incoming_message). Sending must be gated by the permission/approval system (approval UI arrives in Phase 5, so for now block and return APPROVAL_REQUIRED where policy demands it). Include a safe mock mode for tests.

UI (shadcn/ui only)
- MCP marketplace/registry page: Card grid with search Input, install Button, status Badge, detail Sheet showing discovered tools.
- Installed servers: Table with health Badge, restart/remove actions, per-server permissions Dialog.
- Capability browser: Command palette-style search plus detail Sheet showing schema, required permissions, and required account.
- Agent builder addition: a "Capabilities" Tab to assign capabilities/servers to an agent.
- Execution log viewer: Table with expandable row (sanitized input/output) and error Alerts.
- Loading/empty/error states and dark mode.

VERIFY: tests that (1) an agent can discover and run a tool, (2) a call without permission is rejected, (3) secrets never appear in logs or results, (4) timeouts and output limits trigger, (5) invalid input is rejected. typecheck/lint/build. Write docs/phase-4.md.

MILESTONE: An agent can dynamically discover and execute tools using a connected account without ever seeing its credentials.

FINISH WITH: done / how to run / decisions / what I need to provide.
```

---

## Phase 5 — Single-Agent Autonomy

```text
Read AGENTS.md and SPEC.md (sections 12, 13, 14, 16, 22 reliability). Phases 1-4 are verified. This session is PHASE 5 — Single-Agent Autonomy. Do not start Phase 6.

FIRST: plan in under 15 lines, then proceed.

BUILD
1. Database: tasks (all fields from SPEC section 12), agent_runs, agent_approvals, execution_events (+ RLS). Task states: CREATED, PLANNING, QUEUED, RUNNING, WAITING_FOR_APPROVAL, COMPLETED, FAILED, CANCELLED. Enforce valid state transitions in one place (state machine + tests). Every execution gets a trace ID linking tasks, runs, messages, and tool calls.
2. packages/task-engine: task creation from a user request, planning, retries with backoff, cancellation, error recovery, result evaluation.
3. LangGraph graph for single-agent autonomy: plan -> discover capabilities -> permission check -> execute step -> evaluate result -> retry / continue / finish. LangGraph owns reasoning only.
4. Inngest functions (apps/worker): background task execution, retries, timeouts, task continuation, and approval waits (use step.waitForEvent or equivalent so a task pauses durably while waiting for human approval). Never run long executions in Next.js request handlers. External actions must be idempotent (idempotency keys per action) and safe to retry.
5. Autonomy levels enforced in the engine: Manual (only when instructed), Assisted (plan then ask), Supervised (execute permitted, ask for restricted), Autonomous (within granted permissions and limits). Autonomy must NEVER bypass permissions or approval policies.
6. Approval system: approval request contains agent, action, target, proposed content, connected account; approve/reject resumes or cancels the task; audit trail of decisions. Policies: always ask / ask for sensitive actions / auto-execute permitted. Hook it into the WhatsApp send capability from Phase 4.
7. Limits: max steps, max tool calls, token budget, wall-clock timeout per task.

UI (shadcn/ui only)
- Task creation: Dialog or Sheet with agent Select, description Textarea, priority Select.
- Task manager: DataTable with status Badge, filters (Select / Tabs), cancel and retry actions.
- Task detail page: Tabs (Overview, Steps/Timeline, Tool calls, Logs). Live status via Supabase Realtime. Progress indicator and Collapsible step details.
- Approval inbox: list of pending approvals as Cards with a clear preview of the proposed content/target/account and Approve / Reject Buttons (reject with optional reason in a Dialog). Toasts via sonner.
- Loading/empty/error states and dark mode.

VERIFY: tests for the state machine, retry/idempotency (duplicate send is not repeated), approval pause/resume, limits enforcement, autonomy-level behavior. Run an end-to-end demo: agent completes a multi-step task using a tool and pauses for approval before the WhatsApp send. typecheck/lint/build. Write docs/phase-5.md.

MILESTONE: An agent can independently complete a multi-step task, pausing for approvals where policy requires.

FINISH WITH: done / how to run / decisions / what I need to provide.
```

---

## Phase 6 — Memory

```text
Read AGENTS.md and SPEC.md (section 11, 18, 22). Phases 1-5 are verified. This session is PHASE 6 — Memory. Do not start Phase 7.

FIRST: plan in under 15 lines, then proceed.

BUILD
1. Database: agent_memory, memory_embeddings (pgvector, with an appropriate index such as HNSW), artifacts if not yet created (+ RLS). Enable the pgvector extension in a migration.
2. packages/memory: three memory types
   - Workspace memory: shared knowledge available to authorized agents.
   - Private agent memory: visible to one agent only.
   - Temporary task memory: scoped to a task execution, cleaned up after.
   Do NOT assume every agent can read every record: enforce retrieval filtering by workspace and agent permissions in the data layer (and RLS), with tests.
3. Embedding pipeline: embedding model behind the provider abstraction from Phase 2, chunking, async embedding via Inngest, re-embedding on update.
4. Semantic retrieval API: query -> filtered vector search -> ranked results with metadata and source. Hybrid with structured filters (type, tags, agent, date).
5. Conversation summarization: summarize long conversations and store the summary as memory; context management so agents don't exceed context windows.
6. Memory policies: explicit create, update, delete; agent memory settings from agent config are respected (enable/disable, read-only, scope). Agents get memory via capability/tool calls or automatic retrieval in the LangGraph loop, using the same permission rules.
7. Write-back: after a task completes, store key results/decisions as memory according to the agent's memory settings.

UI (shadcn/ui only)
- Memory manager page with Tabs: Workspace / Agent / Task. DataTable of memories with type Badge, source, updated time, search Input (semantic search), filters.
- Create/edit memory: Dialog with Form (title, content Textarea, scope Select, tags). Delete with AlertDialog.
- Memory detail Sheet showing metadata and which agents can access it. Permission editor with Checkboxes.
- Agent builder: add a "Memory" Tab (enable, scope, retention).
- Loading/empty/error states and dark mode.

VERIFY: tests that agent A cannot read agent B's private memory, that workspace memory is readable only by authorized agents, that retrieval returns relevant results for seeded data, that task memory is cleaned up, and update/delete re-index correctly. typecheck/lint/build. Write docs/phase-6.md.

MILESTONE: Agents can recall relevant information from previous work, respecting memory permissions.

FINISH WITH: done / how to run / decisions / what I need to provide.
```

---

## Phase 7 — Multi-Agent Orchestration

```text
Read AGENTS.md and SPEC.md (sections 6, 12, 13, 16, 18, 21). Phases 1-6 are verified. This session is PHASE 7 — Multi-Agent Orchestration. Do not start Phase 8.

FIRST: plan in under 15 lines, then proceed.

BUILD
1. Database: agent_teams, agent_team_members (with roles, e.g., supervisor/worker), agent_messages, task_dependencies, and parent/child task support (+ RLS).
2. packages/communication: typed message bus (Zod discriminated union) with the types TASK_ASSIGNMENT, TASK_ACCEPTED, TASK_PROGRESS, TASK_COMPLETED, TASK_FAILED, INFORMATION_REQUEST, INFORMATION_RESPONSE, APPROVAL_REQUIRED, RESULT_SUBMITTED, TASK_CANCELLED. Every message has sender agent ID, receiver agent ID, task ID, type, payload, timestamp, execution status. Persist all messages. No free-form unlimited agent-to-agent chat: communication happens through explicit tasks, messages, and completion conditions.
3. Supervisor agent (LangGraph, hierarchical): determines what the user wants, whether multiple agents are needed, which agents/capabilities fit, how to split the task, what can run in parallel vs. depends on others, whether approval is needed, and whether the results satisfy the request.
4. Worker agents: execute assigned subtasks and return STRUCTURED results (Zod-validated) to the supervisor. Seed templates: Research, Sales, Analysis, Email, Browser agents.
5. Delegation: parent/child tasks, dependency graph, parallel and sequential execution (Inngest fan-out/fan-in), task reassignment, worker failure recovery, result evaluation, supervisor aggregation, shared task context (uses task memory from Phase 6).
6. Safety limits: delegation depth, concurrent agents, token consumption, tool calls per run. Detect and stop loops. Permissions and approvals still apply to every worker (supervisor authority never bypasses them).
7. Trace IDs span the whole multi-agent execution.

UI (shadcn/ui only)
- Team builder: create team, add agents with role Select, designate supervisor, Drag-free list editing using Cards/Table.
- Task execution visualizer: tree/graph of parent and child tasks with status Badges, live updates via Realtime, click a node to open a Sheet with its messages, tool calls, and result. Use Collapsible/Accordion for the tree; Resizable panels for tree + detail.
- Agent communication log: Table or timeline of agent_messages filtered by trace ID with Badge per message type.
- Loading/empty/error states and dark mode.

VERIFY: tests for message schema validation, dependency ordering, parallel execution, failure recovery/reassignment, limit enforcement, and loop prevention. End-to-end demo: a supervisor delegates a task to two workers, both run (in parallel where possible), and the supervisor aggregates results. typecheck/lint/build. Write docs/phase-7.md.

MILESTONE: A supervisor can delegate a task to multiple agents and combine their results.

FINISH WITH: done / how to run / decisions / what I need to provide.
```

---

## Phase 8 — Integrations & Skills Marketplace

```text
Read AGENTS.md and SPEC.md (sections 9, 10, 8, 18, 21). Phases 1-7 are verified. This session is PHASE 8 — Integrations & Skills Marketplace. Do not start Phase 9.

FIRST: plan in under 15 lines, then proceed. Prioritize the WhatsApp + Gmail + Calendar + Browser vertical slice, and the first acceptance scenario in SPEC section 21, before building marketplace breadth.

BUILD
1. WhatsApp Business (complete): Meta webhook endpoint with signature validation and deduplication, receive incoming messages, send text, send approved templates, message status updates, conversation context retrieval, reply to incoming messages, opt-out and consent handling, respect customer service windows and template requirements.
2. Gmail: OAuth connection (reuse vault), read, search, send, reply, drafts, attachments, labels.
3. Google Calendar: read, create, update, delete events, check availability.
4. Browser integration: browse/search/scrape capability with safe limits (timeouts, domain rules, output size), exposed as a capability.
5. Unified communication interface: agents request "contact this lead via WhatsApp and email" and the capability layer picks the right connected account and provider.
6. CRM: define the integration interface and implement one simple CRM (or generic webhook/API connector) to prove the pattern.
7. Skills engine: tables skills, skill_versions, agent_skills. Skill = name, description, instructions, required capabilities, input requirements, output requirements, version, author, installation status. Create, edit, install, remove, assign, share, version. Skills are injected into agent context as procedures; they are reusable across agents; missing required capabilities are flagged.
8. Marketplaces: skills marketplace and MCP marketplace (seeded catalog entries), agent templates (one-click create an agent with preconfigured skills/capabilities), scheduled automations via Inngest cron plus event triggers.
9. Seed skills: Lead generation, Customer support, SEO research, Email writing, Competitor analysis, Website auditing.

UI (shadcn/ui only)
- Skills marketplace: Card grid, search Input, category Tabs, install Button, detail Sheet with instructions preview and required capabilities Badges.
- Skill editor: Form with Textarea for instructions, field arrays for inputs/outputs, version history Table.
- Agent templates gallery with one-click create Dialog.
- Automations: Table of schedules/triggers with enable Switch, cron builder using Select + Input, run history.
- WhatsApp/Gmail/Calendar setup guides: Stepper-style Cards inside Dialogs, connection-test Button with result Alert.
- Loading/empty/error states and dark mode.

VERIFY: tests for webhook signature validation and dedup, consent/opt-out handling, template vs. session-window rules, skill versioning and assignment, scheduled trigger firing. Run acceptance scenario SPEC section 21 steps 1-10 with a mock or sandbox WhatsApp account: "Find 20 potential website development clients in Bangalore, evaluate their businesses and prepare personalized WhatsApp messages." and report which acceptance criteria pass or fail. typecheck/lint/build. Write docs/phase-8.md.

MILESTONE: Users can extend agents through installable integrations and skills.

FINISH WITH: done / how to run / decisions / what I need to provide (Meta app credentials, Google OAuth client, etc.).
```

---

## Phase 9 — Frontend & Mobile

```text
Read AGENTS.md and SPEC.md (sections 17, 16, 14, 4). Phases 1-8 are verified. This session is PHASE 9 — Frontend & Mobile. Do not start Phase 10.

FIRST: audit what UI already exists, list the gaps against SPEC section 17's 16 sections, then plan in under 15 lines.

PART 1 — WEB POLISH (shadcn/ui only)
Complete and unify every web section: Dashboard, Agents, Agent builder, Agent chat, Agent teams, Task manager, Task execution visualizer, MCP marketplace, Connected accounts, Credential management, Skills marketplace, Memory manager, Approval inbox, Execution history, Usage analytics, Workspace settings.
- Dashboard: Cards for active agents, running tasks, pending approvals, account health, token/cost usage; recent activity feed; quick actions.
- Usage analytics: shadcn Chart (Recharts-based) for tokens, cost, task counts by status, tool usage, duration; date range via Popover + Calendar; export option.
- Execution history: DataTable with trace ID search, filters, and a trace detail page joining tasks, agent messages, tool calls, approvals, errors, retries, durations, cost.
- Live agent activity panel using Supabase Realtime.
- Global polish: Command palette (Cmd+K) with Command, breadcrumbs, consistent empty/loading/error states, toasts (sonner), keyboard accessibility, responsive layouts down to tablet, dark mode, consistent spacing and typography using theme tokens. Remove any custom one-off UI that duplicates a shadcn component.

PART 2 — EXPO MOBILE APP
- Expo + Expo Router + TypeScript, sharing Zod schemas and API clients from packages/shared and packages/database. shadcn is web-only: use NativeWind with React Native Reusables, mapping to the same design tokens so web and mobile look consistent.
- Screens: auth, agent chat (streaming), task creation, live execution status, task history, approval requests (approve/reject), basic agent management (enable/disable, edit basics), connected account status, notifications.
- Push notifications: Expo Notifications, device token table + RLS, Inngest function that sends pushes for approval requests, task completion, and task failure.
- Secure session storage with expo-secure-store.

RULES: do not duplicate business logic on the client; call the existing backend. Never expose service keys or credentials in either app.

VERIFY: typecheck/lint/build for web; Expo app builds and runs in dev; component or e2e tests for approval flow on web and mobile; accessibility check (labels, focus order, contrast) on key screens. Write docs/phase-9.md with screenshots list and run instructions.

MILESTONE: Complete user-facing web and mobile experience.

FINISH WITH: done / how to run both apps / decisions / known gaps.
```

---

## Phase 10 — Production Hardening

```text
Read AGENTS.md and SPEC.md (sections 22, 7, 8, 14, 16, 21). Phases 1-9 are verified. This session is PHASE 10 — Production Hardening.

FIRST: perform an audit and list findings by severity (critical/high/medium/low) before changing anything, then plan in under 20 lines.

BUILD / VERIFY
1. Security review and testing:
   - Review all RLS policies; write tests proving cross-user isolation on every table.
   - Confirm credentials are never present in logs, LLM context, task messages, client bundles, or error reports (automated grep/test plus manual review).
   - Prompt-injection hardening: treat tool outputs, scraped web content, and incoming messages as untrusted; ensure they cannot trigger actions that bypass permissions or approvals.
   - Input validation on all endpoints, webhook signature checks, CSRF/CORS/headers, dependency audit.
   - MCP isolation review: network restrictions, timeouts, output limits.
2. Credential rotation: implement and test encryption-key rotation (re-encrypt all records with a new key version, with rollback), and provider token rotation.
3. Rate limiting: per user, per agent, per capability, and per external provider (respect WhatsApp/Gmail quotas).
4. Cost controls: per-workspace and per-agent budgets, token and tool-call limits, model routing to cheaper models where appropriate, hard stops with notifications.
5. Execution limits: confirm delegation depth, concurrency, timeout, and loop-detection limits are enforced and tested.
6. Reliability: idempotency audit for every external action, webhook deduplication, task recovery after worker crash, Inngest retry policies, dead-letter handling.
7. Monitoring and error reporting: structured logging with trace IDs, error tracking (e.g., Sentry), metrics, health endpoints, alerts for failed tasks, unhealthy accounts, and cost spikes.
8. Backups: Supabase backup and restore procedure tested; storage backup; documented RPO/RTO.
9. Deployment: Docker images for web and worker, docker-compose and VPS deployment config in infrastructure/, reverse proxy with TLS, secrets via environment or a secret manager, CI pipeline (typecheck, lint, test, build, migration check), zero-downtime migration process.
10. Performance testing: load test chat streaming, task throughput, and concurrent multi-agent runs; query/index review (including pgvector); cache capability metadata; fix hotspots found.
11. UI: add admin/ops views if missing (system health, usage limits) using shadcn/ui only, plus UI for budget and rate-limit settings.

FINAL ACCEPTANCE
Run the full acceptance scenario from SPEC section 21 against staging/sandbox and report each acceptance criterion as pass/fail with evidence:
- Agents work independently.
- Agents communicate through structured messages.
- Tasks have parent-child relationships.
- Tools are dynamically discovered.
- Credentials remain hidden from agents.
- Permission checks happen before external actions.
- Failures can be retried safely.
- User can inspect the complete execution history.

DELIVERABLES: docs/phase-10.md, docs/security-review.md, docs/runbook.md (deploy, rollback, backup/restore, key rotation, incident response), and a launch checklist.

MILESTONE: Production-ready platform.

FINISH WITH: audit findings fixed vs. outstanding, acceptance results, and anything I must provide for deployment (domain, VPS, keys).
```
