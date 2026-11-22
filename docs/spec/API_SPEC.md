# API Spec

Base URL: `EXPO_PUBLIC_API_BASE_URL`. All routes require `Authorization: Bearer <Supabase JWT>` (except webhooks/OAuth callback/Inngest) and verify the session with Supabase Auth. Supabase database trigger enforces a single app account; routes scope user data by the authenticated `user_id`. Errors: `{ "error": { "code": string, "message": string } }`.

## 1. Chat
| Method | Route | Description |
|---|---|---|
| POST | `/api/chat` | Body `{ threadId?, messages, agentId?, model?, mode: "chat"\|"agent" }` (`model` = registry id like `groq:...`; falls back to agent/default). Streams AI SDK UI message stream. `mode:"agent"` creates a run and streams its progress parts. |
| GET | `/api/threads` | List threads (cursor paging), including the selected agent's `avatar` object and group summary when set |
| POST | `/api/threads` | Create an empty thread. Body `{ title?, model?, groupId? }`; `groupId` creates a durable group chat and is rejected if the group is not owned by the caller |
| GET | `/api/threads/:id` | Thread + messages; group messages include agent identities, handoff metadata, and run links |
| PATCH/DELETE | `/api/threads/:id` | Rename / delete |
| GET | `/api/models` | Only mobile-enabled catalog models, capabilities, `available` (key configured), today's usage per provider |
| PUT | `/api/settings/models` | `{ defaultModel, fallbackOrder[] }` |
| GET | `/api/admin/models` | Provider catalog, mobile availability, provider key status and recent provider/model usage |
| POST | `/api/admin/models/refresh` | Fetch catalogs from configured providers and persist model metadata |
| PATCH | `/api/admin/models` | `{ models:[{ id, enabled }] }` to control mobile availability |

**Agent-scoped chats:** an existing thread's persisted `agent_id` is authoritative. The request may omit `agentId` or repeat the same id; a different id is rejected with **409** `agent_mismatch`, and an unknown/foreign agent id is rejected with **404** `agent_not_found`. A thread with no agent yet may be bound to the requested owned agent on its first agent-scoped request.

## 2. Files
| POST | `/api/upload` | Returns signed upload URL + `documents` row. |
|---|---|---|
| POST | `/api/documents/:id/process` | Triggers parse/chunk/embed via Inngest. |
| GET | `/api/documents` | List |

## 3. Notes
| Method | Route | Description |
|---|---|---|
| POST | `/api/webhooks/github` | Verified (HMAC) push webhook → `vault/changed` |
| POST | `/api/notes/sync` | Manual full/partial resync |
| GET | `/api/notes` / `/api/notes/:id` | List / read (with backlinks) |
| POST | `/api/notes` | Create/update note (commits to repo) |
| PUT | `/api/notes/:path` | Create/update a note **by vault path** (Phase 9). Body = raw markdown (`Content-Type: text/markdown`); commits via `putVaultFile` and upserts the notes index. User-initiated → **no approval** |
| DELETE | `/api/notes/:path` | Delete a note by vault path (Phase 9): removes the file from the vault and the index row. User-initiated → **no approval** |
| GET | `/api/search?q=&k=` | Hybrid search over notes + memories |

The agent's `write_note` tool keeps its approval requirement — only the HTTP routes above (a human pressing save) skip approval.

## 3b. Skills (Phase 8)
| Method | Route | Description |
|---|---|---|
| GET | `/api/skills` | List the user's skills with `assignedAgentIds` |
| POST | `/api/skills` | Create a skill: composes `skills/<slug>/SKILL.md`, commits to the vault, indexes it. User-initiated → no approval |
| PATCH | `/api/skills/:id` | Update (name/slug/description/tools/body); recomposes + recommits to the vault |
| DELETE | `/api/skills/:id` | Delete the vault file, then the index row |
| PUT | `/api/agents/:id/skills` | `{ skillIds }` — replace the agent's whole assignment set |

## 3c. Productivity (Phase 9)
All routes are `requireUser()`-guarded and Zod-validated. The API speaks **camelCase**; the database is snake_case (`apps/api/lib/productivity.ts` maps them).

| Method | Route | Description |
|---|---|---|
| GET | `/api/task-lists` | List task lists (`{ taskLists }`) |
| POST | `/api/task-lists` | Create a list (`{ name, sort? }`) → `{ taskList }` |
| PATCH/DELETE | `/api/task-lists/:id` | Rename / sort / soft-delete a list |
| GET | `/api/tasks` | List tasks. Filters: `listId`, `status` (`open\|done\|cancelled`), `from`, `to` → `{ tasks }` |
| POST | `/api/tasks` | Create a task (`{ listId, title, notes?, status?, priority?, dueAt?, dueAllDay?, remindAt?, rrule?, parentId?, createdBy? }`) → `{ task }` |
| GET/PATCH/DELETE | `/api/tasks/:id` | Read / patch / **soft**-delete (`deleted_at`) a task |
| GET | `/api/events` | List events. `?from=&to=` returns **expanded occurrences** for recurring items (RRULE is expanded on read; occurrences are never materialised) → `{ events }` |
| POST | `/api/events` | Create an event (`{ title, startsAt, endsAt, allDay?, tz?, location?, rrule?, exdates?, reminders?, createdBy? }`) → `{ event }` |
| GET/PATCH/DELETE | `/api/events/:id` | Read / patch / soft-delete an event |
| POST | `/api/push-tokens` | Register an Expo push token (`{ expoToken, platform }`) — upsert by token |
| DELETE | `/api/push-tokens?expoToken=` | Remove a registered token |

`createdBy` accepts `user` \| `agent` \| `suggested`. Agent tools always set `created_by='agent'` + `source_run_id`; `extractMemories` writes `created_by='suggested'` rows (shown in the app as suggestions to accept or dismiss).

## 3d. Routines (Phase 10)
All routes are `requireUser()`-guarded and Zod-validated. The API speaks **camelCase**; the database is snake_case (`apps/api/lib/routines/store.ts` maps them).

| Method | Route | Description |
|---|---|---|
| GET | `/api/routines` | List the user's routines with a preview (`{ routines }` — each has `scheduleLabel` + the next three `nextRuns`) |
| POST | `/api/routines` | Create a routine (`{ name, prompt, schedule, agentId?, threadId?, tz?, sourceText?, approvalMode? }`) → `{ routine }`. Created as a **draft** — nothing recurring starts until it is activated |
| GET | `/api/routines/:id` | One routine with its preview |
| PATCH | `/api/routines/:id` | Update `name` / `prompt` / `schedule` / `tz` / `approvalMode` / `status`. A changed schedule re-derives the RRULE and the next run |
| DELETE | `/api/routines/:id` | Delete the routine |
| POST | `/api/routines/:id/activate` | **The gate** — confirm the proposal: `status='active'` + `next_run_at` computed server-side → `{ routine }` |
| POST | `/api/routines/:id/run-now` | Run it immediately → **202** `{ runId }`. The routine's own schedule is left untouched |
| GET | `/api/routines/:id/runs` | The runs this routine produced (newest first) → `{ runs }` |

**Schedule shape:** `{ frequency: "once" \| "daily" \| "weekly" \| "monthly", days_of_week?: Weekday[], day_of_month?: 1-28, time: "HH:mm", run_at?: ISO }`. `time` is always the **user's local wall clock**; the server converts it to an RRULE and computes the concrete instants in `tz` (default `Asia/Kolkata`). The client never sends a computed date.

**Chat-first flow:** `POST /api/chat` accepts an optional `tz` (the device timezone). When the model calls `create_routine`, the response stream carries an extra `data-routine-proposal` UI part (`{ routineId, name, prompt, scheduleLabel, nextRuns, tz, status }`) next to the tool part — the app renders it as the confirmation card. The `create_routine` tool saves a draft; the routine only runs after `POST /api/routines/:id/activate`.

**Approval mode:** `approvalMode` is `queue` (default) or `deny`. A routine-fired run inherits it — `queue` parks a sensitive tool call in the normal approval gate (24 h expiry), `deny` auto-denies it (`approvalMode: "deny"`), so a routine can never block on a human decision. The policy survives a resume.

## 3e. Agent groups and handoff (Phase 11)
All routes are `requireUser()`-guarded and use the shared Zod contracts in `packages/shared/src/groups.ts`. The API is camelCase.

| Method | Route | Description |
|---|---|---|
| GET | `/api/groups` | List the caller's groups with members → `{ groups }` |
| POST | `/api/groups` | Create a group: `{ name, description?, leadAgentId, mode?, maxHops?, tokenBudget?, memberIds? }` → **201** `{ group }`. The lead is added exactly once |
| GET | `/api/groups/:id` | One owned group; includes the latest durable group `threadId` and the live `activeParentRunId` / `activeParentRunStatus` (so the app can restore the "running" pill after it was killed) → `{ group }` |
| PATCH | `/api/groups/:id` | Update metadata and optionally lead/membership. Body follows `GroupPatchSchema` → `{ group }` |
| DELETE | `/api/groups/:id` | Delete the group. Existing thread history is preserved with the group link cleared. **409** while the group still has a run in flight |
| PUT | `/api/groups/:id/members` | Replace membership: `{ leadAgentId, memberIds }` → `{ group }`. The lead is always included. The swap runs in one transaction (`replace_group_members`), so a reader never sees a half-replaced group |
| POST | `/api/agents/run` | Start a group run with `{ groupId, goal, threadId?, inline?, tz? }` → **202** `{ runId, status: "queued", groupId }`. A thread already linked to a group routes to that group; an explicit mismatched `groupId` is rejected |

`mode` is `handoff` or `roundtable`; `maxHops` is 1–20 and `tokenBudget` is 1,000–500,000.
A group holds at most **12 members, counting the lead** (`MAX_GROUP_MEMBERS`); the server rejects
a larger set. Unknown or foreign agents are rejected, and service-role queries always scope the
group and membership by the authenticated `userId`.

**Group runtime:** the parent follows `route → agent_turn → route → … → finalize`. Each turn is a
sequential child run of the existing single-agent graph. `handoff_to` ends the current turn,
`ask_agent` returns a consult answer, and `post_to_group` persists visible progress. The calling
agent is resolved from run context, while handoff/consult targets are validated against the
group's membership server-side.

**Entry routing:** a user message in a group thread starts with an `@agent` mention when one is
present; otherwise it starts with the group's lead. Hop, ping-pong, token-budget, and nested-ask
guards stop further routing and let the lead finalize. Member context is a compact handoff brief
plus a bounded rolling group summary, not the full transcript. Non-`private_ok` targets receive no
note/memory-derived context and no note/memory retrieval tools.

**Group run rejections** (`POST /api/agents/run`):
- **400** `bad_request` — the body mixes a group run with an explicit `agentId` or `model`; each
  member brings its own.
- **409** `conflict` — a member (or the lead) is asleep; a second parent run is already in flight
  for the group.
- The user's message is linked to its run (`messages.run_id`) and the run row is created first, so
  the timeline can always connect the two.

**Privacy boundary:** the boundary is the *caller's* policy, not the prose it wrote. A member whose
model may read notes/memories can copy that material into any `task` or `question` it authors, so a
private-capable caller may only hand work to a private-capable target — a handoff or consult to a
non-private target is refused instead of being sanitised after the fact. A caller that never sees
private material may hand off anywhere.

**Approval resume:** the parked child run's persisted `group_context` is never trusted. On resume the
server re-reads the live group, resolves the acting member from the run row's `agent_id`, and
recomputes the privacy policy from that member's current model. A member removed while the run was
parked can no longer act, and the target set is the current membership.

**Token accounting:** a run that parks on an approval keeps the tokens it already spent; the resume
adds to them instead of replacing them, so the run row (and the group's cumulative budget) never
under-reports. Consult tokens are charged to the member turn and therefore to the group budget.
The group's finalization chain is the lead's model, the default model, the global fallback order,
and the models the group's own members use — so a rate-limited lead provider does not strand the
run. A group whose summary may contain private material keeps the Google-only chain.

**Durable follow-ups:** the parent's rolling summary is persisted on `agent_runs.group_context`, so
the next group run in the same conversation continues from it instead of starting cold.

**The ordinary chat route refuses group conversations:** `POST /api/chat` returns **409**
`group_thread` for a thread that belongs to a group. Group messages are group runs, never a chat
stream.

## 4. Agents, runs, approvals
| Method | Route | Description |
|---|---|---|
| GET/POST | `/api/agents` | List / create (`AgentCreateSchema`: name, role, instructions, model, fallbackModels, avatar, isSupervisor). Full agent responses: `avatar` object (image avatars carry a response-only signed `url`; `value` stays the raw Storage path), `toolCount`, `isSupervisor`, `isSleeping` |
| PATCH/DELETE | `/api/agents/:id` | Update (`AgentPatchSchema`; `null` clears nullable fields) / delete |
| POST | `/api/agents/:id/avatar` | Returns a signed Storage upload URL for an image avatar |
| POST | `/api/agents/:id/sleep` | Sleep: sets `agents.sleeping` and pauses the agent's active runs (plus a supervisor's unfinished inline children); new tasks are rejected until wake |
| POST | `/api/agents/:id/wake` | Wake: clears `agents.sleeping` and emits `run/resumed` for the agent's paused runs plus the paused supervisors waiting on them |
| POST | `/api/agents/run` | Ordinary run: `{ goal, threadId?, model?, agentId?, inline?, tz? }` → `{ runId }`; group run: `{ groupId, goal, threadId?, inline?, tz? }` → `{ runId, status, groupId }` (queues Inngest unless `inline: true`; `agentId` scopes an ordinary run to an agent, `model` is preferred for task nodes; **409 when the target agent is asleep**) |
| GET | `/api/runs` | List recent top-level runs — supervisor children and group member turns are excluded and live under their parent |
| GET | `/api/runs/:id` | Status + result + the full `run_events` timeline (returned whole on each poll — there is no separate events/SSE route); includes the run agent's `avatar` object, `pendingApprovals`, and `children` for Supervisor or group parent runs (each child embedded with its agent summary) |
| POST | `/api/runs/:id/pause` | Pause an unfinished run (cascades to unfinished supervisor children); idempotent, **409** when already finished |
| POST | `/api/runs/:id/resume` | Resume a paused run → **202** `{ ok }` (queued as `run/resumed`); **409** when not paused or the agent is asleep; a run paused while parked on an undecided approval restores `awaiting_approval` instead of invoking |
| POST | `/api/runs/:id/cancel` | Cancel an unfinished run (cascades to unfinished supervisor children); idempotent, **409** when already finished |
| GET | `/api/approvals?status=pending` | Pending approvals |
| POST | `/api/approvals/:id` | `{ decision: "approve"\|"deny", edits? }` → emits `approval/decided` |

**Pause & sleep:** `paused` is a first-class run status. Pause flips only the status row — every node in both graphs sits behind a status boundary (`assertRunActive`, `apps/api/lib/agent/pause.ts`), so the graph stops at the next node boundary with the LangGraph checkpoint left before that node. The stop is control flow, not failure: `runAgent`/`runSupervisor` return `{status:"paused"}` (or `cancelled`) without failing the run, so the Inngest function succeeds and `onFailure` never fires. Resume emits `run/resumed`, which continues via `invoke(null)` — the boundary node re-runs and everything before it replays from the Postgres checkpointer (an empty thread falls back to a fresh input invoke). Resuming a run parked on an *undecided* approval restores `awaiting_approval` instead of invoking: `invoke(null)` would resume the interrupt with an undefined value and the tool gate would read the still-pending row as denied. Pause, cancel and sleep all cascade to unfinished supervisor children; a paused child parks its supervisor's `fan_out`, which resumes it from its own checkpoint on the parent's resume.

**Supervisor runs:** runs whose agent has `is_supervisor = true` execute the dedicated supervisor graph `delegate → fan_out → verify → merge` (`apps/api/lib/agent/supervisor.ts`) instead of the single-agent graph. `delegate` emits ≥2 structured briefs on distinct specialist agents (capped at 4); `fan_out` creates full single-agent child runs (`agent_runs.parent_run_id`, idempotent on Inngest retry) and runs them in parallel with `approvalMode: "deny"` — children auto-deny sensitive tools instead of parking on approvals (v1 decision, not yet approval-gated); `verify` cross-checks their outputs with a model from a *different* provider than the workers (`pickCrossProviderModel`, keyed providers only); `merge` synthesizes the final answer with the run's model chain, applying the verifier's corrections. Fewer than 2 specialists falls back to the single-agent graph plus a `message` event. Dispatch is `executeRun` (`apps/api/lib/agent/execute.ts`), used by both POST `/api/agents/run` and the Inngest handler.

## 5. MCP store
| Method | Route | Description |
|---|---|---|
| GET | `/api/mcp/servers` | Registry with `connected` flag; camelCase rows incl. `instructions`. `?all=1` (admin) also returns disabled listings |
| GET | `/api/mcp/servers/:id` | Single listing (admin) |
| POST | `/api/mcp/servers` | Admin create listing (`MCPServerCreateSchema`); 409 on duplicate slug |
| PUT | `/api/mcp/servers/:id` | Admin update (`MCPServerPatchSchema`); supports `slug`, `instructions`, `disabled`; 409 on duplicate slug |
| DELETE | `/api/mcp/servers/:id` | Admin delete (cascades to tools/connections) |
| POST | `/api/mcp/connections` | `{ serverId | toolkit, apiKey? }` or returns `{ authorizationUrl, connectionId }` when sign-in is required; Composio toolkit connects also return `serverId`. `toolkit` materializes its `composio-<toolkit>` listing on first connect, then connects it |
| GET | `/api/mcp/composio/catalog` | Composio-as-source tab: browsable toolkit catalog (`?q=&category=`) with this user's connection state merged in; `{ configured:false }` (200) when `COMPOSIO_API_KEY` is unset |
| GET | `/api/mcp/oauth/callback` | Completes direct MCP OAuth, stores encrypted creds, discovers tools, then redirects to `agentapp://mcp/:serverId?status=connected` (or `status=error`) |
| GET | `/api/mcp/composio/callback` | Verifies Composio hosted sign-in and redirects to `agentapp://mcp/:serverId?status=connected`, `pending`, or `error`; the app polls `/verify` while pending |
| POST | `/api/mcp/connections/:id/verify` | Returns authoritative connection status; `{ issueLink:false }` is used for side-effect-free verification polling |
| DELETE | `/api/mcp/connections/:id` | Disconnect |
| GET | `/api/mcp/connections/:id/tools` | Live tool list |
| PUT | `/api/agents/:id/mcp` | `{ connectionId, tools:[{name, requiresApproval}] }` |

Listing CRUD is validated by the shared zod schemas in `packages/shared/src/mcp.ts` (`MCPServerCreateSchema`, `MCPServerPatchSchema`, `normalizeListingSlug`). `instructions` is plain setup guidance shown on the mobile integration detail screen and must never contain secrets.

## 6. Canvas & monitors
| Method | Route | Description |
|---|---|---|
| GET | `/api/canvases` / `/api/canvases/:id` | List / get |
| PUT | `/api/canvases/:id` | Replace spec (validated) |
| POST | `/api/canvases/:id/refresh` | Re-run data sources, no LLM; returns updated spec |
| DELETE | `/api/canvases/:id` | Delete |
| GET/POST/DELETE | `/api/monitors[/:id]` | Manage website monitors |

## 7. Inngest
`/api/inngest` serves functions.
| Event | Function |
|---|---|
| `agent/run.requested` | Execute graph in durable steps; write `run_events` |
| `approval/decided` | Resume waiting run |
| `run/resumed` | Continue a paused run from its graph checkpoint (`invoke(null)`); idempotent when no longer paused |
| `chat/completed` | Extract & upsert memories (facts/preferences/decisions; tasks become suggested rows) |
| `vault/changed` | Parse, chunk, embed changed notes + index `skills/**/SKILL.md` |
| `document/uploaded` | Parse, chunk, embed document |
| `canvas/refresh.requested` + cron | Refresh data-bound canvases |
| cron `reminder/tick` (every minute) | Send due task/event reminders via Expo push; idempotent via `reminder_log` |
| cron `routine/tick` (every minute) | Fire due routines: create the run (idempotent via the unique `(routine_id, scheduled_for)`), insert the trigger message, advance `next_run_at`, emit `agent/run.requested`; the run's outcome is posted back into the thread |
| cron `monitor/tick` | Fetch pages, hash, diff, notify |
| cron `keepalive` (optional) | Touch DB to avoid pause |

## 8. Agent tools (built-in)
| Tool | Approval | Notes |
|---|---|---|
| `web_search(query)` | no | Cites sources |
| `fetch_page(url)` | no | Extracts readable text; content treated as untrusted |
| `search_notes(query,k)` | no | Hybrid |
| `read_note(path)` | no | |
| `write_note(path,content)` | **yes** | Commits to vault |
| `recall_memory(query)` / `save_memory(...)` | no | |
| `render_canvas(spec)` / `update_canvas(id,patch)` | no | Validated by zod `Canvas` |
| `load_skill(slug)` | no | Returns an **assigned** skill's body and narrows the tool set to the skill's declared `tools` (intersection only) |
| `create_task(...)` / `list_tasks(...)` | no | Tool-created rows carry `created_by='agent'` + `source_run_id`; results capped at ~50 items |
| `complete_task(id)` | no | |
| `update_task(id, ...)` | **conditional** | Needs approval only when the target is `created_by='user'` |
| `delete_task(id)` | **yes** | Soft delete; always gated |
| `create_event(...)` / `list_events(from,to)` | no | Recurrence is expanded on read |
| `update_event(id, ...)` | **conditional** | Needs approval only when the target is `created_by='user'` |
| `delete_event(id)` | **yes** | Soft delete; always gated |
| `find_free_slots(from,to,durationMinutes)` | no | Suggests free slots between existing events |
| `create_routine(name,prompt,schedule)` | no | Saves a **draft** routine and emits a `data-routine-proposal` part; the schedule is structured (frequency / weekdays / local `HH:mm`), never a cron string or a date |
| `list_routines()` | no | The user's routines with their schedule and next run |
| `update_routine(id,...)` | no | A changed schedule re-derives the RRULE and the next run |
| `pause_routine(id)` / `resume_routine(id)` | no | Pause / (re)activate a routine |
| `delete_routine(id)` | **yes** | Always gated |
| `handoff_to(agent, task, context?)` | no | Group-only: ends the current member turn and routes the task to an owned group member |
| `ask_agent(agent, question)` | no | Group-only: quick consult; returns the answer to the caller without transferring control |
| `post_to_group(message)` | no | Group-only: persists a visible progress update in the group chat |
| `create_monitor(url,...)` | yes | |
| MCP tools | per-tool flag | Default **yes** |

**Conditional approvals:** the gate resolves the target row's `created_by` server-side (scoped to the run's user). `created_by='user'` → the call parks for approval; `agent`/`suggested` → it runs immediately; an unverifiable target (no id, row gone, wrong owner) → **requires** approval.

Supervisor delegation is not a tool: `is_supervisor` agents execute the dedicated `delegate → fan_out → verify → merge` graph described in §4 (the former `delegate(agent,task)` row was removed 2026-11-18).

Group collaboration is attached dynamically to a member's existing single-agent graph. The tool
caller is taken from the child run's agent identity, never from model arguments. Membership and
privacy checks happen before a handoff/consult executes; a breach stops routing rather than
silently calling a foreign agent. The group tools stay attached for every round of the member
turn — they are never narrowed away by the late-round heuristic or by a skill's `tools` list. A
consult may ask one further member for help (nested consults run one level deeper, up to
`maxDepth = 2`), and its tokens are charged to the group budget.

## 9. Streaming
AI SDK UI message stream. Custom data parts: `data-run-event` (node/tool progress), `data-approval` (pending approval card), `data-canvas` (canvas id), `data-routine-proposal` (the Phase 10 routine confirmation card — `{ routineId, name, prompt, scheduleLabel, nextRuns, tz, status }`).

## 10. Persistent dashboards (Phase 13)
All dashboard endpoints require `requireUser()` and use the shared schemas in `packages/shared/src/dashboard.ts`. Responses and requests use camelCase. Widget config is validated through the Canvas component schema; at most 24 widgets are allowed per dashboard and dashboard specs are capped at 500 KB.

| Method | Route | Description |
|---|---|---|
| GET | `/api/dashboards?limit=&offset=` | Paginated caller-owned dashboard summaries |
| POST | `/api/dashboards` | Create `{ title, description?, layout?, widgets?, createdByAgentId? }` → **201** `{ dashboard }`; capped at 20 creates per user per hour (**429** when exceeded) |
| GET | `/api/dashboards/:id` | Owned dashboard with widgets and current version |
| PUT | `/api/dashboards/:id` | Update `{ title?, description?, layout?, widgets?, createdByAgentId? }`; a widget array replaces the current set; saves a version snapshot |
| DELETE | `/api/dashboards/:id` | Delete an owned dashboard and its widgets/versions |
| GET | `/api/dashboards/:id/versions` | List version metadata, newest first |
| POST | `/api/dashboards/:id/restore` | Restore `{ version }` as a new current version; history remains immutable |
| POST | `/api/dashboards/:id/refresh` | Phase 13.2: enqueue configured data-source refresh in Inngest |

Every service-role query filters by authenticated `user_id`; dashboard, widget and version RLS provide database-level ownership as defense in depth. Unknown or foreign dashboard IDs return **404**. Version listing returns at most the latest 50 snapshots; older snapshots are pruned on new revisions.
