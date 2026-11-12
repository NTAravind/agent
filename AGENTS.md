# Project rules

## Repo layout (monorepo, npm workspaces)
```
apps/api      Next.js 16 App Router (API routes, Inngest endpoint, shadcn/ui)
apps/mobile   Expo SDK 58 + Expo Router (iOS/Android client)
packages/shared  zod schemas + shared types (imported as @agent/shared)
docs/spec     product + technical specs (source of truth)
```
Install everything from the repo root: `npm install`.

## Spec files
- MASTER_SPEC.md: vision, goals, non-goals, principles
- FEATURES.md: scope and priorities (P0/P1/P2)
- TECH_STACK.md: chosen tools and free-tier constraints
- ARCHITECTURE.md: components, flows, security
- DATABASE_SCHEMA.md: SQL schema and RLS
- API_SPEC.md: routes, agent tools, Inngest events
- UI_UX_SPEC.md: Expo screens, canvas component catalog
- IMPLEMENTATION_PLAN.md: phases with "done when" criteria

## Rules
- The specs are the source of truth. If code and spec disagree, ask me, then update the spec.
- Work one phase at a time, in the order of IMPLEMENTATION_PLAN.md. Don't start the next phase until I confirm.
- Anything marked "verify" in the specs must be checked against current docs before use.
- Never put API keys in `EXPO_PUBLIC_*` variables.
- Sensitive tools require approval, per ARCHITECTURE.md section 4.
- Each feature needs to be approved by the user.

## Conventions
- Server code lives in `apps/api`; it is the only place that may read provider or service secrets.
- All model access goes through the shared provider layer (`packages/shared` / `apps/api/lib/models`), never directly from a route.
- Shared zod schemas and API contracts live in `packages/shared` so the mobile app and the API cannot drift.
- Mobile never stores anything but the Supabase session (SecureStore).
