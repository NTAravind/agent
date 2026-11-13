# Phase 0 runbook

Everything in this document is a one-time manual setup. The code for it is already in the repo.

---

## 1. Supabase project

1. Create a project at <https://supabase.com> (Free plan).
2. **Project settings → API**:
   - `Project URL` → `SUPABASE_URL`
   - `anon` public key → `SUPABASE_ANON_KEY`
   - `service_role` key → `SUPABASE_SERVICE_ROLE_KEY` (server only!)
3. **Project settings → Auth → Providers → GitHub**:
   - Turn GitHub on, paste the Client ID and Client Secret of the GitHub OAuth app (step 2).
   - GitHub OAuth app callback URL: `https://<project-ref>.supabase.co/auth/v1/callback`.
4. **Project settings → Auth → URL Configuration → Redirect URLs** — add:
   - `agentapp://auth/callback` (the Expo app deep link)
   - `http://localhost:3000/**` for local web experiments
5. Keep the project awake: the workflow in `.github/workflows/keepalive.yml` pings it every 3 days.
   Add `SUPABASE_URL` and `SUPABASE_SERVICE_ROLE_KEY` as repository secrets.

## 2. GitHub OAuth app

1. <https://github.com/settings/developers> → **New OAuth App**.
2. Homepage URL: your Vercel URL. Authorization callback URL: `https://<project-ref>.supabase.co/auth/v1/callback`.
3. Copy the Client ID / Client Secret into the Supabase GitHub provider settings.

The app itself does not talk to GitHub OAuth directly — Supabase is the broker, and the mobile app
only ever receives a Supabase session.

## 3. Allow-list your account

The API is single-user. After signing in once through the app (or the Supabase dashboard), copy the
user UUID from **Authentication → Users** and set it as `ALLOWED_USER_ID` in both
`apps/api/.env.local` and the Vercel environment. Every protected route rejects any other user id
with `403 forbidden`.

## 4. Inngest

1. Create an app at <https://app.inngest.com> → **Apps → New App**.
2. Copy **Event key** → `INNGEST_EVENT_KEY`, **Signing key** → `INNGEST_SIGNING_KEY`.
3. After deploying, point the app at `https://<your-domain>/api/inngest` (Inngest → App → Sync).
4. Locally, run `npx inngest-cli@latest dev` and set `INNGEST_DEV=1` in `apps/api/.env.local`
   (Inngest v4 defaults to cloud mode and needs a signing key there).

## 5. Vercel

1. Import the repo at <https://vercel.com/new>.
2. **Root Directory**: `apps/api`. Framework preset: Next.js. Install command stays `npm install`
   (workspaces are installed from the repo root).
3. Add the environment variables from `apps/api/.env.example` (Preview + Production).
4. Deploy. `GET https://<your-domain>/api/health` must return `401 unauthorized` without a token.

## 6. LLM provider keys (needed from Phase 0.5 on)

- `GOOGLE_GENERATIVE_AI_API_KEY` — <https://aistudio.google.com/apikey>
- `GROQ_API_KEY` — <https://console.groq.com/keys>
- `OPENROUTER_API_KEY` — <https://openrouter.ai/settings/keys>

Add all three to the Vercel environment **and** to `apps/api/.env.local`. They are server-only: never use an `EXPO_PUBLIC_*` name.

Verify them with the live provider check (consumes a few free-tier tokens):

```bash
npm run check:providers --workspace api
```

Notes from the first run (2026-11-13):
- **OpenRouter keys must start with `sk-or-v1-`.** A key copied without that prefix is rejected with `401 Missing Authentication header` — the `/api/v1/models` endpoint still returns 200, so do not use it to validate a key.
- `google:gemini-3.8-flash` currently answers `503 high demand` on the free tier. The default model is `google:gemini-3.6-flash` until Google's capacity recovers (`apps/api/lib/models/registry.ts`).
- Groq's `llama-3.1-8b-instant` and `llama-3.3-70b-versatile` were shut down for free/developer tiers on 2026-08-16; the registry uses `openai/gpt-oss-*` and `qwen/qwen3.8-27b` instead.

## 6b. Database migrations

`db/migrations/*.sql` holds the schema for the app. Apply them in order:

1. Supabase dashboard → **SQL Editor** → paste the file contents → **Run**.
2. Or with the CLI: `supabase db push` (needs `DATABASE_URL` with the DB password).

| Migration | What it creates |
|---|---|
| `0001_provider_usage.sql` | `provider_usage` table + RLS (drives the usage meter) |

Until `0001` is applied, LLM calls still work — usage rows are silently skipped.

## 7. Mobile app

```bash
cp apps/mobile/.env.example apps/mobile/.env
# EXPO_PUBLIC_API_BASE_URL=https://<your-vercel-domain>   (or http://localhost:3000 in dev)
# EXPO_PUBLIC_SUPABASE_URL=https://<project-ref>.supabase.co
# EXPO_PUBLIC_SUPABASE_ANON_KEY=<anon key>

npm run dev:mobile
```

The app ships with `expo-secure-store` (session) and `expo-web-browser` (OAuth). On a simulator the
`agentapp://` deep link works out of the box; on a physical device install a development build
(`npx expo run:ios` / `npx expo run:android`) or use Expo Go with the matching scheme.

## 8. Acceptance check (Phase 0 "done when")

1. `npm run dev:api`
2. `npm run dev:mobile`
3. Sign in with the allow-listed GitHub account.
4. Tap **Check /api/health** in the app → the JSON response with `status: "ok"` appears.

## 9. Shadcn/ui

`apps/api` is already a shadcn project (`apps/api/components.json`, `components/ui/button.tsx`).
Add components with:

```bash
cd apps/api && npx shadcn@latest add <component>
```
