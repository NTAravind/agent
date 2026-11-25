# Phase 1: Architecture Assessment, Data Model, Migration Plan

You are working on my existing autonomous AI agent platform. Read `BOT_MASTER_SPEC.md` first. It is the source of truth.

**This phase is documentation only. Do not modify application code, schemas or migrations. Do not create migration files yet.**

## Inspect

- `AGENT_HARNESS.md`, `SYSTEM_ARCHITECTURE.md`, `docs/spec/`
- `apps/api/lib/agent/`, `apps/api/lib/inngest/`, `apps/api/lib/mcp/`, `apps/api/lib/chat/`, `apps/api/lib/models/`
- Existing migrations and current database schema
- Existing agent, memory, skills, routines, groups, approvals and execution UI (Expo and Next.js)

## Verify against source (do not trust the docs)

For each item, state: confirmed / differs / not found, with file and line references.

1. `executeRun()`, `runAgent()`, `runSupervisor()`, `runGroup()`: what each does and how they are dispatched
2. How `agents.is_supervisor` (or equivalent) is used
3. LangGraph state and checkpointing: where state lives, what resume relies on
4. Tool declaration vs execution: how `tool_gate` and `tool_exec` work, including every execution route
5. Approval path: does the durable path bind an approval to arguments, or only to run + tool name? (`findLatestApprovalForRunTool`)
6. MCP tool permissions: default `requires_approval`, per-agent overrides, and what happens to MCP read tools in a routine in `deny`/`queue` mode
7. Per-step tool availability: do MCP tools disappear after the first tool rounds of a step (`toolsForStep`, `CORE_TOOLS`)? Step, round and plan caps
8. Whether anything already lets a chat turn start a durable run
9. Existing productivity-task tools and tables (name collision check for `work_tasks`)
10. Memory service: scopes, retrieval, extraction, vault, and where Bot-level scope would attach
11. Skills: loading, tool narrowing, storage
12. Routines: schema, scheduling through Inngest, approval inheritance, whether they can target a group
13. Group privacy (`private_ok`) enforcement
14. Run and event records (`agent_runs`, `run_events`): what they already capture that a work history needs
15. Any Supabase Storage usage today, buckets, RLS, size limits

## Deliverables (write to `docs/bots/phase-1/`)

1. `assessment.md`: current architecture as it actually is, a table of doc-vs-source differences, and the risks you found. Keep it short and specific.
2. `proposed-architecture.md`: how Bot, Conversation, Work task, Run, Skill, Routine and Workspace relate, and which existing tables are reused vs new. Justify every new table. Cover the permission ceiling for delegation, the general-chat-as-ephemeral-group approach, and the shared workspace with keep-or-discard review.
3. `data-model.md`: ER diagram (Mermaid), column lists, indexes, RLS policies, ownership and permission rules for every new or changed table.
4. `migration-plan.md`: ordered, reversible steps, backfill needs, and what could break production. No SQL files yet.
5. `execution-flow.md`: Mermaid sequence diagrams for (a) the Bangalore scenario end to end, (b) a routine-triggered run, (c) an approval pause and resume, (d) a child task failure and revision.
6. `phase-checklist.md`: phases 2 to 7 broken into small, testable tasks with acceptance criteria and the tests that prove them.
7. `open-questions.md`: anything you could not determine from the code or that needs my decision. Number them.

## Rules

- If the source contradicts the spec, say so and propose a resolution. Do not silently pick one.
- Do not propose a new orchestration framework, scheduler or table that duplicates `agent_runs`, `run_events` or the checkpointer without a written justification.
- Do not claim anything works that you did not verify in code.

## Stop

When the deliverables are written, **stop**. Summarize the top five risks and your open questions. Wait for my explicit approval before starting Phase 2.
