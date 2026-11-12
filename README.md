# Agent

Personal AI agent: Expo mobile client + Next.js API on Vercel, Supabase for data/auth, Inngest for durable runs, LangGraph for the agent loop.

Built as an npm-workspaces monorepo:

```
apps/api          Next.js 16 (App Router) — API routes, Inngest endpoint, shadcn/ui
apps/mobile       Expo SDK 58 + Expo Router — iOS/Android client
packages/shared   zod schemas and shared types (@agent/shared)
docs/spec         product + technical specs (source of truth)
```

## Setup

```bash
npm install                 # from the repo root, installs all workspaces
cp apps/api/.env.example apps/api/.env.local
cp apps/mobile/.env.example apps/mobile/.env
```

Then follow [`docs/runbook-phase-0.md`](docs/runbook-phase-0.md) for the account-level steps
(Supabase, GitHub OAuth, Vercel, Inngest, provider API keys).

## Commands

| Command | What it does |
|---|---|
| `npm run dev:api` | Next.js dev server on :3000 |
| `npm run dev:mobile` | Expo dev server |
| `npm run build` | Production build of the API |
| `npm run lint` | ESLint (api) + Expo lint (mobile) |
| `npm run typecheck` | `tsc --noEmit` for every workspace |

## Endpoints

| Route | Auth | Description |
|---|---|---|
| `GET /api/health` | Bearer Supabase JWT | Liveness + current user. Also the Phase 0 acceptance probe. |
| `GET/POST/PUT /api/inngest` | Inngest signing key | Inngest function endpoint. |

## Phase status

Phase 0 (setup) is implemented in code; the account-level steps in the runbook still need to be
executed by hand (Supabase project, GitHub OAuth app, Vercel project, Inngest app, provider keys).
