# Persistent Bots: Master Spec

Status: draft v1. This is the source of truth for the Bot evolution. Each phase prompt points here. If a phase prompt and this spec disagree, stop and ask.

## 0. How to use this spec (instructions for the coding agent)

1. Read this file, then `AGENT_HARNESS.md`, `SYSTEM_ARCHITECTURE.md` and `docs/spec/`.
2. **Verify the docs against the source.** Documentation may be stale. Where this spec cites a name (`agent_runs`, `run_events`, `tool_gate`, `SENSITIVE_TOOLS`, `CORE_TOOLS`, `toolsForStep`, `agent_mcp_tool_permissions`, `findLatestApprovalForRunTool`, `MAX_AGENT_STEPS`), confirm it exists and behaves as described. Report differences.
3. Work one phase at a time. **At the end of each phase, stop, post the phase deliverables, and wait for explicit approval.**
4. Extend the existing harness. Do not rebuild it. Do not add another orchestration framework or scheduler.
5. Do not claim a feature is done if it is only a UI, a stub or a placeholder. If a backend (browser, shell) is not configured, the tool must not be offered to the model and the UI must say so.

## 1. Goal

Agents behave as persistent AI workers (Bots): each has identity, memory, skills, tools and a workspace, survives restarts, can be assigned a goal, and can delegate to specialists. A user can assign a goal, leave, and return to finished work, saved findings and tangible results.

## 2. Non-negotiables (preserve)

- LangGraph harness, checkpointing, durable runs on Inngest, pause/resume/cancel, idempotent execution.
- Tool **declaration → gate → execution** separation. No model executes a privileged operation directly. `tool_gate` is never bypassed.
- Approvals are server-verified and authoritative.
- Model registry, provider fallback, model capability checks. No hardcoded provider.
- Group privacy restrictions (`private_ok`).
- Identity (user id, agent id, run id, workspace prefix) always comes from server context, never from model-supplied arguments.
- Tool output, file contents and other agents' outputs are **untrusted data**, never instructions.
- All long-running work is asynchronous and independent of an open HTTP request.

## 3. Vocabulary and entities

| Concept | Meaning | Storage |
|---|---|---|
| **Bot** | The persistent worker and its identity. UI/doc word only. | Existing `agents` table (do **not** rename the table) |
| **Conversation** | A user-to-Bot (or group) message thread | Existing threads/messages |
| **Work task** | A durable goal assigned to a Bot, with plan, status, optional parent | New `work_tasks` (see below) |
| **Run** | One execution attempt of a work task | Existing `agent_runs` + nullable `work_task_id` |
| **Skill** | Reusable instructions/workflow that never expands permissions | Existing skills system, extended |
| **Routine** | A trigger that creates work tasks on a schedule or event | Existing routines, extended |
| **Workspace** | Persistent files/execution environment | New, see section 7 |

**Naming rule:** the existing productivity tasks (`create_task` etc.) are a different feature. The new entity is `work_tasks` in schema, code and tool names. "Task" is only the UI label.

**Duplication rule:** `agent_runs`, `run_events` and the checkpointer remain the only execution record. `work_tasks` holds only what they cannot: goal, plan, parent link, assignee, status, structured brief, structured result. Any additional new table must be justified in the Phase 1 assessment.

### Minimum `work_tasks` shape (refine in Phase 1)

`id, user_id, agent_id (assignee), parent_task_id, conversation_id?, routine_id?, objective, brief (jsonb), plan (jsonb), status, result (jsonb), completion_criteria (jsonb), created_at, updated_at`. Status values: `pending | running | awaiting_approval | awaiting_review | completed | failed | cancelled`.

## 4. Orchestration

Use the existing graph. One lead-driven engine; do not maintain two diverging ones.

- **Delegation = child work task + child run.** The primary Bot calls `delegate(agent_id, brief)`. Server creates the child `work_task` and child run. Children can run in parallel. Result comes back as structured `result`, not prose.
- **Structured brief:** task id, parent task id, objective, expected output (schema), relevant context, relevant memory (explicitly selected), available skills, allowed tools, completion criteria, workspace file manifest.
- **Handoff** (existing `handoff_to`) remains for conversational group turns. It is not the delegation mechanism.
- **Lead as manager:** the primary Bot can poll child status, read results, request a revision (new child run on the same task, bounded retry count), and aggregate. It does not mark its own task completed until children are completed and verification passes.
- **Capability matching:** the supervisor sees a roster of capability cards (role, skills, tool summary), not full prompts. The server validates that the target Bot has the required skill/tool before accepting a delegation.
- **Permission ceiling:** a child's effective tools = (child's own permissions) ∩ (parent's effective permissions) ∩ (tools named in the brief). Delegation can never grant more than the parent has.
- **Depth and fan-out caps:** configurable max delegation depth, max children per task, max revisions per task.
- **General chat:** a chat with no bound Bot. Messages go to the supervisor, which routes to a Bot from the registry. A direct chat with a specific Bot skips the supervisor. Model this as an ephemeral group whose lead is the supervisor, rather than a second engine. When delegated work completes, post a `task-complete` message part `{ work_task_id, run_id, agent_id, conversation_id }`; the UI renders "*<Bot> completed your task*" with an **Open chat** button.
- **Chat-to-background:** add a `start_background_run`-style tool so a chat turn can create a work task and durable run and then reply "on it." Verify first whether an equivalent already exists.
- **Per-item fan-out:** "do X for each of N items" must not be squeezed into one step. Support per-item child tasks (or batched steps) so 10 items get real depth.
- **Known limits to verify and address:** per-step round caps; MCP tools being dropped from later tool rounds (`CORE_TOOLS` only); plan size caps. Decide per limit: raise, make configurable per Bot/skill, or route around via child tasks.

## 5. Memory hierarchy

| Level | Scope | Rules |
|---|---|---|
| User shared | All Bots, subject to permission | Preferences, background, general instructions |
| Bot | One Bot | Learned workflows, Bot-specific instructions |
| Task | One work task tree | Findings, intermediate results, decisions |
| Conversation | One thread | Messages |

- Relevance-based retrieval only. Never inject everything.
- A specialist does not receive another Bot's private memory. Relevant memory is **explicitly selected into the brief** by the parent, within the parent's own access.
- Task findings are **promoted** to Bot or shared memory only by an explicit step (user action or an approved promotion tool). Tool output is never auto-saved as a permanent user fact.
- Reuse the existing memory service and extraction. Add scope, do not fork it. Verify how the current vault and extraction behave before designing.

## 6. Skills

Extend the existing trusted skill loader. A skill has: name, description, instructions, required tools, optional tools, input schema, output format, version, access permissions. Bots discover and load relevant skills on demand. **A skill can narrow tools, never widen them.** Starter set: Ecommerce Prospect Research, Website UX Audit, SEO Analysis, Personalized Outreach, Competitor Research, Code Review.

## 7. Workspaces and files

### 7a. Shared group/run workspace (needed for multi-Bot pipelines)

- Private Supabase Storage bucket. Path: `{user_id}/{work_task_root_id or group_run_id}/.temp/...`
- `workspace_files` table: `id, user_id, path, created_by_agent, work_task_id, mime, size, status (temp|pending_review|kept|discarded), description, private, expires_at, created_at`.
- Agents never receive storage credentials. Tools: `ws_write`, `ws_read`, `ws_list`. Server derives the prefix from context.
- Handoffs and briefs pass a **manifest** (paths, schema, author), never bulk content.
- `private` flag is inherited from the writer's privacy context; non-private members cannot read private files.
- **Keep-or-discard:** every file is registered; decisions are collected **once per batch** at run end via a single Review Files approval (per-file Keep/Discard in the approval `edits` payload). "Keep" moves the file to the permanent artifacts prefix and is a gated, sensitive action. Unanswered after 24h means discard. Routines (queue/deny mode) leave files in a review inbox, then purge on expiry. Optional `deliverable` flag allows an immediate prompt for specific files.
- Retention: `.temp` has a TTL and a per-user quota. Verify the storage cap and design purging accordingly.

### 7b. Persistent per-Bot workspace (computer)

- Execution environment abstraction with pluggable backends: `filesystem` (backed by 7a/Storage first), `browser`, `shell`, plus existing API and MCP tools.
- Environment is bound to (user, Bot). Different users are isolated. Resumable across tasks.
- A backend is selected by config (e.g. `WORKSPACE_BACKEND`, `BROWSER_BACKEND`, `SHELL_BACKEND`). **Unset means disabled and the tools are not offered.**
- Sandboxed backends run outside the serverless function. Inngest orchestrates; the sandbox executes. Sandboxes get no platform secrets and a restricted network allowlist. Shell and computer use are gated by default.
- Sandbox tools are declarations and run only via `tool_exec` after the gate, as one more route next to group tools, MCP and builtins.
- Phase 5 starts with the abstraction and filesystem. Browser and shell only if a backend is actually configured.

## 8. Central permission policy

One policy layer decides, per (Bot, tool, resource, action): allowed, read-only vs mutating, requires approval.

- **Auto:** web search, read pages, analyze files, write to `.temp`, create internal reports.
- **Approval:** send email, publish, purchase, delete user data, move file to permanent storage, any sensitive external action.
- **MCP defaults:** read-only MCP tools default to no approval (explicit per-tool override), mutating tools default to approval. Verify the current default (`requires_approval`) and its effect on routines in `deny` mode.
- **Approval binding:** confirm the durable path binds an approval to the specific action (tool + argument digest), not just run + tool name. Fix if not.
- **Batch approval:** multi-item irreversible actions (e.g. 10 emails) use one approval that shows every item and its exact content.
- **Routines:** inherit approval mode. In `deny`/`queue` mode nothing blocks on a human; gated actions are queued or denied and reported.

## 9. Routines

Routines are the scheduling layer for Bots. Reuse Inngest. Support: schedule, enable/disable, pause/resume, timezone, history, failure reporting, approval inheritance, event triggers where supported. A routine creates a work task for a Bot (or a group/lead Bot) and runs the same orchestration. Creation stays draft-then-confirm.

## 10. Observability and frontend

Work history is derived from `work_tasks`, `agent_runs`, `run_events`, approvals, artifacts. Do not duplicate. Bot view shows: current task and status, progress, active specialists, recent activity, pending approvals, completed tasks, generated files, memory, skills, routines. A Bot's conversation and its task history are separate views. Follow the existing design system. Do not redesign unrelated screens.

## 11. Phases and exit criteria

| Phase | Scope | Exit criteria |
|---|---|---|
| 1 | Assessment, data model, migration plan | Docs only. Approved. |
| 2 | Bot layer: identity/config, `work_tasks`, Bot memory scope, work history | Migrations applied, tests green, no regression |
| 3 | Orchestration: delegate, child tasks, aggregation, verification, general chat, completion card, background-run tool, fan-out | Parent/child tracking works, permission ceiling tested |
| 4 | Skills and routines | Routine creates work task and completes end to end |
| 5 | Workspaces: shared bucket, review flow, then abstraction and backends | Isolation tests pass, disabled backends not offered |
| 6 | Frontend | Bot-centric screens working against real data |
| 7 | Hardening and full scenario | All tests below pass |

## 12. Testing

- **Deterministic suite:** mock model and mock tools drive the Bangalore scenario (primary plus Research, Website Analysis, Outreach, Verification). No live web.
- **Live smoke test:** separate, opt-in.
- Cover: parent/child links, independent Bot execution, memory isolation, permission ceiling (child cannot exceed parent), approval handling and argument binding, batch approval, pause/resume, retry idempotency, crash recovery (kill mid-run, resume), routine execution in deny/queue mode, cross-user isolation (DB, Storage, workspace), file review and TTL purge, private-file access by non-private members, frontend updates.
- Website Analysis without a browser backend must degrade to `fetch_page`, state what it could not check, and never invent UX findings.
- Outreach produces drafts only. Sending stays gated.
- Verification runs in a separate context (ideally a different model) from the producers and rejects unsupported claims.

## 13. Definition of done

Updated `AGENT_HARNESS.md` and architecture docs, migrations, API changes, backend, frontend, tests, and configuration instructions for every env var and external backend. Anything not implemented is listed explicitly as not implemented.
