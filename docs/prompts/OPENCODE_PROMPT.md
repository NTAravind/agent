# Implementation Prompt: Skills, Productivity, Routines, Agent Groups

You are extending an existing, working codebase: a personal, single-user autonomous AI agent platform (Next.js API on Vercel, Expo mobile app, Supabase Postgres, Inngest, LangGraph JS).

**Before writing any code, read `SYSTEM_ARCHITECTURE.md` in the repo root in full.** It is the source of truth for existing structure, conventions, and constraints. Follow its patterns exactly. Where this prompt and the architecture doc disagree about *existing* behavior, the doc wins; tell me about the discrepancy.

---

## 0. Working rules (read carefully)

1. **One phase at a time.** The phases below are ordered. Complete a phase, run its verification, then **stop and report**. Do not start the next phase until I confirm.
2. **Plan first.** At the start of each phase, output a short plan (files to create/change, migration numbers, risks) and wait for no confirmation unless something is ambiguous. Then implement.
3. **Follow existing extension points** (Architecture doc §20):
   - New built-in tool: declaration in `apps/api/lib/agent/tools.ts` → case in `executeToolCall` → `SENSITIVE_TOOLS` if it needs approval → `CORE_TOOLS` if it must persist in late rounds.
   - New Inngest work: event in `lib/inngest/events.ts`, handler in `lib/inngest/functions.ts`. Each graph node is an `step.run()`.
   - Shared types/Zod schemas go in `packages/shared/src/` and are imported as `@agent/shared`.
4. **Database:** add numbered migrations in `db/migrations/` (continue after the highest existing number) and mirror them into `db/apply.sql`. Every table: UUID PK, `timestamptz`, FKs, `user_id`, **RLS `using (user_id = auth.uid())`** (child tables join through parent). Server code uses the service role, so **every query must also filter by `user_id` explicitly.**
5. **Security invariants (do not weaken):**
   - Tool output and web/MCP content are untrusted and never change a tool allow-list.
   - Skills may *narrow* an agent's tools, never grant new ones.
   - IDs like `threadId`, `agentId`, `userId` for tools come from server request context, **never from model-supplied arguments**.
   - `private_ok` rule: note/memory-derived context is only sent to models with `privateOk: true`. This must hold for new flows (skills, handoffs, routine runs).
   - Sensitive actions go through the existing approval system.
6. **Free-tier constraints:** Supabase 500 MB cap, provider free quotas. Truncate large tool outputs, add retention pruning for any new high-volume table, enforce per-run step/token caps on every new run type.
7. **Tests:** add unit tests under `apps/api/lib/**/__tests__/` for pure logic (schedule math, recurrence, handoff guards, skill loading). Match the existing test setup. Run typecheck and tests before declaring a phase done.
8. **Don't refactor unrelated code.** Keep diffs focused. If you must touch shared code (e.g. `graph.ts`, `chat/stream.ts`), keep changes minimal and explain them.
9. **Timezone:** the user's timezone is stored in settings (default `Asia/Kolkata`). All user-facing times are interpreted in it. Store timestamps as UTC.
10. After each phase, update `SYSTEM_ARCHITECTURE.md` (new sections, schema highlights, file map, Inngest table, phase table) so it stays accurate.

---

## Phase 8 — Skills

**Goal:** an agent can have reusable instruction bundles ("skills") that it loads on demand.

### Design
- A skill is a markdown file with frontmatter, stored in the **GitHub vault** at `skills/<slug>/SKILL.md` (vault is source of truth; Supabase is an index, consistent with the "Rebuildable" principle).
- Frontmatter: `name`, `description` (one line, used for discovery), optional `tools: [...]` (allowlist that can only **narrow** the agent's tools).
- **Progressive disclosure:** the system prompt for an agent includes only each assigned skill's `name` + `description`. A new tool `load_skill(slug)` returns the full body when the agent decides it needs it. This keeps prompts small.

### Schema
```sql
skills (id, user_id, slug, name, description, body, tools text[], vault_path, git_sha, enabled, updated_at, unique(user_id, slug))
agent_skills (agent_id, skill_id, enabled boolean default true, primary key (agent_id, skill_id))
```

### Tasks
1. Migration + RLS for both tables; shared Zod types in `packages/shared/src/skill.ts`.
2. Extend the vault sync (`vault/changed` Inngest flow) with a branch for `skills/**/SKILL.md`: parse frontmatter, upsert into `skills` (no chunking/embedding needed).
3. `apps/api/lib/skills/` — `sync.ts`, `load.ts` (`listSkillsForAgent`, `loadSkillBody`), `index.ts`.
4. Built-in tool `load_skill(slug)`: not sensitive; add to `CORE_TOOLS`. It must only load skills assigned to the *current* agent.
5. Inject the skill index into both `buildSystemPrompt` (chat with `agentId`) and the agent graph's system prompts.
6. Tool narrowing: if a loaded skill declares `tools`, intersect with the agent's current tool set for subsequent rounds. Never add tools.
7. API routes: `GET/POST /api/skills`, `PATCH/DELETE /api/skills/:id`, `PUT /api/agents/:id/skills` (set assignments). Creating/editing a skill from the app commits to the vault via `putVaultFile` (user-initiated, so no approval).
8. Mobile: Skills section in the Agent Editor (assign/unassign), a Skills list/editor screen reachable from Settings or "More".

### Done when
An agent with an assigned skill sees only its name/description in the prompt, calls `load_skill`, follows the instructions in a run, and a skill that declares `tools` narrows the tool set. Unassigned skills cannot be loaded.

---

## Phase 9 — Tasks, Calendar, and Notes editing (user productivity)

**Goal:** the user has a todo list, a calendar, and editable notes, and agents can use them via tools.

### Notes
Reuse the existing vault notes system; do **not** build a second notes store.
- Add user-initiated create/update/delete: `PUT /api/notes/:path` and `DELETE /api/notes/:path` commit via `putVaultFile` (no approval; user-initiated). Agent `write_note` keeps its approval requirement.
- Mobile: editable note screen (markdown editor), new note, move/rename, delete. Keep wikilinks/backlinks/search working.

### Schema
```sql
task_lists (id, user_id, name, sort int, created_at)
tasks (id, user_id, list_id, parent_id, title, notes,
       status text check (status in ('open','done','cancelled')) default 'open',
       priority int default 0,
       due_at timestamptz, due_all_day boolean default false,
       remind_at timestamptz, rrule text, completed_at timestamptz,
       created_by text check (created_by in ('user','agent','suggested')) default 'user',
       source_run_id uuid, deleted_at timestamptz, created_at, updated_at)

calendar_events (id, user_id, title, description, starts_at timestamptz, ends_at timestamptz,
                 all_day boolean default false, tz text, location, rrule text,
                 exdates timestamptz[] default '{}', reminders jsonb default '[]',
                 created_by text default 'user', source_run_id uuid, ical_uid text,
                 deleted_at timestamptz, created_at, updated_at)

push_tokens (id, user_id, expo_token unique, platform, last_seen)
```
Indexes: `tasks(user_id, status, due_at)`, `tasks(user_id, remind_at) where remind_at is not null`, `calendar_events(user_id, starts_at)`.

### Rules
- Recurrence: store RRULE; **expand on read** with the `rrule` library. Do not materialize occurrences.
- Soft delete (`deleted_at`) everywhere.
- Add `settings.timezone` (or the existing settings mechanism) defaulting to `Asia/Kolkata`.

### Agent tools (built-in, in `tools.ts`)
`create_task`, `list_tasks`, `update_task`, `complete_task`, `create_event`, `list_events(range)`, `update_event`, `find_free_slots(range, duration_minutes)`.
- Create/complete/list: **no approval** (reversible).
- **Delete** and **edits to items with `created_by='user'`** go through the approval gate (add handling in `SENSITIVE_TOOLS`/gate logic as appropriate, keeping the approval UI generic).
- Items created by tools get `created_by='agent'` and `source_run_id`.
- Tool results must be compact (truncate lists, cap at ~50 items).

### Memory overlap
`memories.kind='task'` overlaps with todos. Change `extractMemories` so it no longer stores tasks as memories; instead create tasks with `created_by='suggested'`, which appear in the UI as suggestions the user accepts or dismisses.

### Reminders
- Inngest cron `reminder/tick` every minute: find tasks with `remind_at <= now()` (not yet notified) and calendar events whose computed reminder time is due; send Expo push notifications; record that a reminder was sent (add a `reminded_at` / notification log to prevent duplicates).
- `POST /api/push-tokens` to register tokens; mobile registers on launch.

### API
`/api/tasks`, `/api/task-lists`, `/api/events` (CRUD, `GET /api/events?from=&to=` returns expanded occurrences), all `requireUser()`-guarded with Zod validation.

### Canvas integration
Add `list_tasks` and `list_events` as canvas `dataSources` (no LLM), so a "Today" dashboard refreshes with the existing refresh mechanism.

### Mobile
- New **Today** tab: agenda (events + tasks due today/overdue), quick-add, complete by tap.
- Tasks screen (lists, subtasks, due/priority), Calendar screen (month/week/agenda; create/edit event).
- Navigation: reduce tab sprawl → tabs: **Chat, Agents, Today, Notes, More** (More contains Canvas, Routines, Groups, Skills, Settings). Keep deep links working.
- Distinguish agent-created items with a small badge.

### Done when
User creates/edits tasks, events, and notes in the app; an agent run can add a task and an event via tools and they appear in the app; a reminder push arrives once at the right time (IST); a recurring weekly event expands correctly; agent delete of a user item parks for approval.

---

## Phase 10 — Routines (chat-first)

**Goal:** the user tells an agent, in plain language, "run this every Monday at 9" and it becomes a scheduled routine. **Agents are treated as chats**: a routine posts its results into the agent chat it was created in, and the user can reply to it.

### UX requirements
- In an agent's chat: user says *"Every Monday at 9 summarize my open tasks and AI news."* The agent calls `create_routine`; the app shows a **routine proposal card** (name, human-readable schedule, next 3 run times, Confirm / Edit). Nothing recurring starts until Confirm.
- When a routine fires: a **trigger message** (role `user`, `parts` marked `{ source: "routine", routine_id }`, rendered as a chip, not a normal user bubble) is inserted into the bound thread, the agent runs, and the **result is persisted as a normal assistant message** in that thread. Send an Expo push that deep-links to `chat?threadId=`.
- The user can reply in that thread ("make it shorter next time") and the agent can call `update_routine`.
- Each agent has a **primary persistent thread**, created lazily. The Agents tab becomes a list of chats (last message preview, unread badge). Extra threads are still allowed.
- Chat header has a clock icon → routine sheet: schedule, next run, pause/resume, edit, run now, past runs.

### Schema
```sql
routines (
  id, user_id, agent_id,
  thread_id uuid not null,            -- where results post
  name text, prompt text,
  schedule jsonb not null,            -- structured form shown in UI
  rrule text, tz text not null,       -- what the scheduler uses
  source_text text,                   -- user's original words
  status text check (status in ('draft','active','paused','completed')) default 'draft',
  approval_mode text check (approval_mode in ('queue','deny')) default 'queue',
  next_run_at timestamptz, last_run_at timestamptz,
  consecutive_failures int default 0,
  created_at, updated_at
)
-- agent_runs: add routine_id uuid null, scheduled_for timestamptz null,
--   unique (routine_id, scheduled_for) where routine_id is not null
-- agent_threads: add agents.primary_thread_id (or equivalent) for the persistent thread
```

### Agent tools (`lib/routines/tools.ts`, wired like `buildKnowledgeTools`)
`create_routine`, `list_routines`, `update_routine`, `pause_routine`, `resume_routine`, `delete_routine`.
- **The model emits a structured schedule, never a cron string:**
  ```ts
  schedule: {
    frequency: "once" | "daily" | "weekly" | "monthly",
    days_of_week?: ("MO"|"TU"|"WE"|"TH"|"FR"|"SA"|"SU")[],
    day_of_month?: number,
    time: "HH:mm",          // user-local
    run_at?: string          // ISO, for "once"
  }
  ```
- The **server** converts to RRULE, applies the user's timezone, computes `next_run_at` and the next 3 occurrences (use `rrule` and/or `cron-parser`). Never trust model-computed dates.
- `threadId`, `agentId`, `userId` come from request/run context only.
- `create_routine` saves a `draft` and emits a `data-routine-proposal` UI part (same mechanism as `data-approval` / `data-canvas`). Confirm → `POST /api/routines/:id/activate`. Do **not** reuse the `approvals` table for this (it is tied to `run_id`).
- Inject **current date, time, and user timezone** into the chat/agent system prompt so relative expressions resolve correctly.

### Scheduler (Inngest)
- Single cron `routine/tick` every minute. Select `status='active' AND next_run_at <= now()`. For each: insert the `agent_runs` row (unique `(routine_id, scheduled_for)` makes it idempotent), advance `next_run_at`, insert the trigger message, send `agent/run.requested`. **Do not register one cron per routine.**
- Overlap: if the previous run for that routine is still running, skip and post a short note in the thread.
- Missed runs: run once, never backfill every missed occurrence.
- One-shot routines → `status='completed'` after firing.
- Failures: post a failure message in the thread; increment `consecutive_failures`; auto-pause after 3 and say so in the chat.
- Approvals: `queue` mode uses the existing gate (approval card appears in the thread, run parks, 24h expiry); `deny` mode reuses `approvalMode: "deny"`.
- Routine runs go through the normal `runAgent` (checkpointed), with the thread's recent messages as context (same window as chat), per-run token/step caps, and normal `chat/completed` memory extraction **excluding** the trigger message.
- Respect `private_ok` for note/memory context as usual.

### API
`GET/POST /api/routines`, `GET/PATCH/DELETE /api/routines/:id`, `POST /api/routines/:id/activate`, `POST /api/routines/:id/run-now`, `GET /api/routines/:id/runs`.

### Retention
Prune routine-run `run_events` under the existing 30-day policy; keep run summaries.

### Mobile
Routine proposal card in `MessageBubble` rendering, routine chip for trigger messages, routine sheet in chat header, "Routines" list under More, agents-as-chats list, Realtime subscription on `messages` for the open thread, push deep-link handling.

### Done when
Telling an agent "every Monday at 9 do X" produces a proposal card with correct next dates in IST; after Confirm and the next tick (use run-now and a test routine firing within a couple of minutes for verification), the result appears in the same chat with a push; replying "make it shorter" updates the routine; a sensitive tool call parks the run and shows an approval card in the thread; 3 consecutive failures auto-pause.

---

## Phase 11 — Agent groups and handoff

**Goal:** users form groups of agents that talk to each other and hand off tasks. A group is also a chat; handoffs appear as messages.

Keep the existing Supervisor (fixed `delegate → fan_out → verify → merge`) working untouched. Groups are a *separate, dynamic* mechanism. Add `mode` so the supervisor could later become a group mode.

### Schema
```sql
agent_groups (id, user_id, name, description, lead_agent_id, mode text check (mode in ('handoff','roundtable')) default 'handoff',
              max_hops int default 8, token_budget int, created_at, updated_at)
group_members (group_id, agent_id, role text check (role in ('lead','member')) default 'member', primary key (group_id, agent_id))
-- threads: add group_id uuid null
-- messages: add from_agent_id uuid null, to_agent_id uuid null, handoff jsonb null
-- agent_runs.parent_run_id already models turns as child runs
```

### Runtime (`apps/api/lib/agent/group.ts`)
LangGraph graph (Postgres-checkpointed, run inside Inngest like other graphs): `route → agent_turn → route → … → finalize`.
- `agent_turn` runs the **existing single-agent graph** as a child run for the chosen member (member's own model, tools, skills). Turns are sequential, so use `approvalMode: "gate"` and let approvals park the **parent** run (unlike supervisor children, which use `deny`).
- Group tools available to members:
  - `handoff_to(agent, task, context)` — ends the turn, passes control. Use LangGraph `Command({ goto, update })`.
  - `ask_agent(agent, question)` — quick consult; returns the answer, control stays with the caller.
  - `post_to_group(message)` — visible progress update.
- Enforce server-side: handoff/ask targets must be group members; the calling agent is taken from run context.
- Guardrails: `max_hops`, ping-pong detection (A→B→A→B), per-group-run token budget, depth limit for nested asks. On breach, stop and have the lead finalize with what exists.
- Context per turn: a compact handoff brief + rolling group summary — **not** the full transcript.
- **Privacy:** when handing off to an agent whose model is not `privateOk`, strip note/memory-derived content from the brief/context. Add a unit test for this.
- Entry points: user message in a group thread, or `@agent` mention routes to that member first; otherwise the lead goes first.
- Persist each agent turn as a message with `from_agent_id`; persist handoffs with `handoff` jsonb `{ from, to, task }`.

### API
`GET/POST /api/groups`, `PATCH/DELETE /api/groups/:id`, `PUT /api/groups/:id/members`, group chat via the existing run pipeline (`POST /api/agents/run` with `groupId`, or a group chat route), run timeline includes child runs.

### Mobile
Groups screen under More, group editor (pick members, lead, mode, hop cap), group chat view with agent avatars and handoff chips ("Researcher → Writer"), tap-through to each child run timeline, `@agent` mentions in the composer.

### Done when
A 3-agent group (e.g. researcher, writer, reviewer) completes a task through at least two handoffs; the chat shows who handed what to whom; a forced ping-pong stops at the guard; an approval inside a turn parks and resumes the group run; a handoff to a non-`privateOk` agent contains no private context.

---

## Reporting format (end of every phase)

1. Summary of what changed (files, migrations).
2. How to verify (exact commands/requests/screens).
3. Test results (typecheck, unit tests).
4. Deviations from this prompt, and why.
5. Updates made to `SYSTEM_ARCHITECTURE.md`.
6. Anything I need to do manually (env vars, Inngest sync, Supabase migration, Expo push credentials).

Then stop and wait for my go-ahead before the next phase.
