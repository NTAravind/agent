# Agent

Personal AI agent: Expo mobile client + Next.js API on Vercel, Supabase for data/auth, Inngest for durable runs, LangGraph for the agent loop.

Built as an npm-workspaces monorepo:

```
apps/api          Next.js 16 (App Router) — API routes, Inngest endpoint, shadcn/ui
apps/mobile       Expo SDK 58 + Expo Router — iOS/Android client, HeroUI Native UI
packages/shared   zod schemas and shared types (@agent/shared)
docs/spec         product + technical specs (source of truth)
```

The mobile UI uses [HeroUI Native](https://heroui.com/native) (`heroui-native`) on
Uniwind/Tailwind v4. Root layout order: `GestureHandlerRootView` → `HeroUINativeProvider` →
app. Component reference: <https://heroui.com/native/llms.txt>.

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
| `npm test` | Provider-layer unit tests (resolver, capability gate, fallback ordering) |
| `npm run check:providers --workspace api` | Live check: same prompt on Google/Groq/OpenRouter + forced-429 fallback |
| `node scripts/check-env.mjs` | Lists env vars that are still missing |
| `node scripts/verify-setup.mjs --remote` | End-to-end setup verification (Supabase, allow-list, deployed API, Inngest) |

## Endpoints

| Route | Auth | Description |
|---|---|---|
| `GET /api/health` | Bearer Supabase JWT | Liveness + current user. Also the Phase 0 acceptance probe. |
| `GET /api/models` | Bearer Supabase JWT | Model registry, provider availability, today's usage. |
| `GET/POST/PUT /api/inngest` | Inngest signing key | Inngest function endpoint. |

## Model access

All LLM calls go through `apps/api/lib/models/` — no route may import a provider package directly.

```ts
import { generateTextWithFallback } from "@/lib/models";

const { text, modelId, attempts } = await generateTextWithFallback({
  prompt: "…",
  modelIds: ["google:gemini-3.6-flash"], // optional; default = model + fallbacks
  userId,
});
```

The chain retries once on 429/5xx/timeout, then moves to the next model, skipping any fallback that
lacks a capability the request needs (`vision`, `tools`, …). Every attempt is logged to
`provider_usage`.

## Phase status

Phase 0 (setup) and Phase 0.5 (provider layer) are implemented and verified live. Remaining manual
steps: re-copy the OpenRouter key (must start with `sk-or-v1-`), add the three provider keys to the
Vercel environment, and apply `db/migrations/0001_provider_usage.sql`.
# agent
