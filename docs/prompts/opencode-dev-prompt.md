# OpenCode Dev Prompt — Autonomous Multi-Agent AI Platform (with shadcn/ui)

## How to use

1. Put the spec in your repo root as `SPEC.md` (your `writing-block.md`).
2. Create an `AGENTS.md` in the repo root and paste **Part A** into it (OpenCode reads this automatically every session).
3. Paste **Part B** into OpenCode as your first message.
4. For each later phase, paste **Part C** with the phase number filled in.

---

# PART A — `AGENTS.md` (persistent rules)

```markdown
# Project: Autonomous Multi-Agent AI Platform

The full product and technical spec is in `SPEC.md`. It is the source of truth.
Read the relevant sections before starting any task. If the spec is ambiguous,
make the simplest decision consistent with the spec and record it in `docs/decisions.md`.

## Stack
- Monorepo: pnpm workspaces (+ Turborepo)
- Web: Next.js (App Router, TypeScript strict)
- Mobile: Expo / React Native (built later, Phase 9)
- UI (web): **shadcn/ui + Tailwind CSS + Radix primitives + lucide-react**
- AI: Vercel AI SDK (model interaction, streaming)
- Orchestration: LangGraph (reasoning, planning, delegation)
- Durable execution: Inngest
- Data: Supabase (Postgres, Auth, Realtime, Storage) + pgvector
- Validation: Zod everywhere (messages, task payloads, tool inputs, env)

## Hard rules (never violate)
1. Credentials are NEVER exposed to the LLM, prompts, logs, or task messages.
2. No agent may bypass permission or approval checks.
3. LangGraph = reasoning. Inngest = durable execution. Never run long agent
   executions inside Next.js request handlers.
4. Never hardcode integrations into agent definitions. Use the capability registry.
5. Database is the source of truth, not conversation history.
6. External actions must be idempotent.
7. Every table has UUID PK, timestamps, FKs, indexes, and RLS policies.
8. Packages must not have circular dependencies; expose clear public interfaces.
9. Backend first, UI second — but when building UI, follow the UI rules below.
10.clarify any doubts before proceeding implementation
## UI rules (shadcn/ui)
- ALL web UI must be built with shadcn/ui components. Do not hand-roll buttons,
  inputs, dialogs, dropdowns, tables, tabs, toasts, etc. If a shadcn component
  exists, use it.
- Install components via the CLI only: `pnpm dlx shadcn@latest add <component>`.
  Never copy-paste component code by hand or invent components that look like shadcn.
- Shared primitives live in `packages/ui` (monorepo shadcn setup). App-specific
  composed components live in `apps/web/components` and `apps/web/features/*`.
- Style with Tailwind utility classes and the shadcn CSS variable theme tokens
  (`bg-background`, `text-muted-foreground`, `border`, etc.). No hardcoded hex colors,
  no inline styles, no other UI libraries (no MUI, Chakra, Ant, etc.).
- Use `cn()` from `lib/utils` for conditional classes.
- Icons: `lucide-react` only.
- Forms: shadcn `Form` + `react-hook-form` + `zod` resolver, reusing the same Zod
  schemas used by the backend where possible.
- Data tables: shadcn `Table` + TanStack Table (`DataTable` pattern).
- Toasts: `sonner`. Dark mode: `next-themes`, with a theme toggle.
- Every screen must handle: loading (`Skeleton`), empty state, error state
  (`Alert`), and be responsive and keyboard accessible.
- Mobile (Expo): shadcn is web-only. Use NativeWind + React Native Reusables
  (the shadcn-style RN library) so mobile mirrors the web design tokens.

## Workflow rules
- Work one phase at a time, in the order defined in SPEC.md section 20.
- Before coding a phase: read the relevant spec sections, then write a short plan.
- After coding: run typecheck, lint, tests, and build. Fix everything before reporting done.
- Write tests for security-critical code (vault, permissions, approvals) and for
  the message bus / task engine.
- Commit in small logical commits with clear messages.
- Do not start the next phase until the current milestone is verified.
- Never add dependencies without stating why. Prefer what's already in the stack.
- Never commit secrets. Maintain `.env.example` and validate env with Zod.
```

---

# PART B — Kickoff prompt (paste into OpenCode first)

```text
You are the lead engineer building the Autonomous Multi-Agent AI Platform described in
SPEC.md. Read AGENTS.md and SPEC.md fully before doing anything.

GOAL
Build the platform phase by phase following SPEC.md section 20. We are starting with
PHASE 1 — Foundation. Do not begin Phase 2 until I confirm Phase 1.

UI REQUIREMENT
All web UI uses shadcn/ui (Tailwind + Radix + lucide-react), as defined in AGENTS.md.
Set this up correctly from day one.

TASKS FOR THIS SESSION

1. Plan first
   - Summarize your understanding of Phase 1 in under 15 lines.
   - List the files/folders you will create.
   - List any ambiguities and the default you'll choose for each.
   Then proceed without waiting unless something is blocking.

2. Monorepo setup
   - Scaffold the structure from SPEC.md section 19 (apps/web, apps/mobile placeholder,
     apps/worker, packages/*, supabase/, infrastructure/).
   - pnpm workspaces + Turborepo, shared tsconfig (strict), ESLint, Prettier.
   - Each package has its own package.json, `src/index.ts` public API, and tsconfig.

3. shadcn/ui setup (monorepo-aware)
   - Create `packages/ui` as the shared shadcn component package.
   - Initialize shadcn for the monorepo (`pnpm dlx shadcn@latest init`) so that
     `apps/web` and `packages/ui` each have a valid `components.json` with aliases
     pointing to the shared package for primitives.
   - Configure Tailwind (current version supported by shadcn CLI) with the shared
     theme tokens in one place; support light + dark via next-themes.
   - Install the baseline components: button, input, label, textarea, card, form,
     dialog, sheet, dropdown-menu, select, tabs, table, badge, avatar, skeleton,
     alert, sonner, separator, tooltip, sidebar, breadcrumb, command, scroll-area.
   - Build an `AppShell` in apps/web using shadcn `Sidebar` with nav entries for the
     16 sections in SPEC.md section 17 (stub pages are fine for sections not yet built).
   - Add a theme toggle and a `ui-demo` dev page showing the components render
     correctly in light and dark.

4. Supabase + auth
   - Configure Supabase client (server + browser) with the SSR helpers.
   - Migrations in `supabase/migrations` for: profiles, workspaces, workspace_members
     (multi-workspace-ready, but one personal workspace per user for now).
   - RLS policies on every table. Trigger that creates a profile + personal workspace
     on signup.
   - Auth pages built with shadcn `Card` + `Form`: sign up, log in, log out,
     password reset. Protected routes via middleware.

5. Workspace management
   - Workspace settings page (rename, view details) using shadcn forms.
   - Workspace is resolved server-side and available to all authenticated routes.

6. Inngest + env
   - Configure Inngest in apps/worker with a health-check function and the Next.js
     serve endpoint or a documented separate runtime.
   - Zod-validated env management (`packages/shared/env`), `.env.example` for all apps.

7. Verification (required before you say "done")
   - `pnpm typecheck`, `pnpm lint`, `pnpm build` all pass.
   - Tests for the signup trigger / RLS behavior where feasible.
   - A short `docs/phase-1.md` with: what was built, how to run locally, env vars
     needed, and known gaps.

MILESTONE (from spec)
A user can sign up, log in, and create/see their workspace, using a polished shadcn/ui
interface with dark mode.

RULES FOR THIS RUN
- Follow AGENTS.md strictly. No UI outside shadcn/ui. No hand-written replicas of
  shadcn components.
- Do not implement features from later phases (agents, vault, MCP, etc.) beyond
  empty placeholder pages.
- If a command fails, diagnose and fix it rather than skipping it.
- At the end, give me: (a) what's done, (b) how to run it, (c) what you decided
  on ambiguities, (d) anything that needs my input (API keys, Supabase project, etc.).
```

---

# PART C — Phase continuation template

```text
Read AGENTS.md and SPEC.md. Phase [N] ([PHASE NAME]) is next.
Phase [N-1] is verified and complete.

1. Re-read the spec sections for this phase and summarize the plan in under 15 lines.
2. Implement every bullet listed under "Phase [N]" in SPEC.md section 20.
3. Backend/packages first, with Zod schemas, migrations + RLS, and tests for
   anything security-critical.
4. Then build the UI for this phase with shadcn/ui only (install components with the
   CLI, shared primitives in packages/ui, feature components in apps/web/features/*).
   Every screen needs loading, empty, and error states, and must work in dark mode.
5. Run typecheck, lint, tests, and build. Fix all failures.
6. Update docs/phase-[N].md.
7. Verify the phase milestone from the spec and report the result honestly,
   including anything that doesn't work yet.

Do not start Phase [N+1].
```

## Suggested UI per phase (shadcn components to pull in)

| Phase | UI to build | shadcn components |
|---|---|---|
| 2 Agent Core | Agent list, agent builder, streaming chat | `card`, `form`, `slider`, `switch`, `select`, `tabs`, `scroll-area`, `textarea`, `avatar` |
| 3 Credential Vault | Connected accounts, permission matrix, audit log | `table`, `dialog`, `badge`, `checkbox`, `alert-dialog`, `data-table` |
| 4 MCP/Capabilities | MCP marketplace, capability browser | `command`, `card`, `badge`, `sheet`, `input` |
| 5 Single-agent autonomy | Task manager, approval inbox | `table`, `progress`, `badge`, `dialog`, `sonner` |
| 6 Memory | Memory manager | `table`, `tabs`, `dialog`, `command`, `select` |
| 7 Multi-agent | Task execution visualizer, team builder | `resizable`, `collapsible`, `accordion`, `hover-card`, `tabs` |
| 8 Integrations | Skills marketplace, templates, schedules | `card`, `calendar`, `popover`, `toggle-group` |
| 9 Frontend | Dashboard, usage analytics | `chart`, `card`, `breadcrumb`, `pagination` |

## Tips for running this in OpenCode

- Use a stronger model in **plan mode** for the plan step, then switch to build mode for implementation.
- Keep each session scoped to one phase. Start a fresh session per phase; `AGENTS.md` carries the rules over.
- If the agent drifts into custom UI, reply: *"Replace that with the shadcn/ui equivalent via the CLI, per AGENTS.md."*
- Add the shadcn MCP server to your OpenCode config if you want the agent to browse and install registry components itself.
