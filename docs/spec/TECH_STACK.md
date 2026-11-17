# Tech Stack

Limits below were checked Nov 2026 and change often. **Re-verify before relying on them.**

## 1. Stack
| Layer | Choice | Free-tier notes |
|---|---|---|
| Mobile client | Expo (React Native, Expo Router) | Free. `expo/fetch` streaming needs Expo 52+. |
| Web/API server | Next.js (App Router) on Vercel Hobby | Free, **non-commercial only**. Function max duration ~300 s per current docs (older docs: 10–60 s; check dashboard). |
| LLM SDK | Vercel AI SDK | Open source |
| Agent framework | LangGraph.js | Open source |
| Durable jobs | Inngest Hobby | 50k executions/mo, 5 concurrent steps |
| Database + vectors | Supabase Free (Postgres + pgvector) | 500 MB DB, 1 GB files, 5 GB egress, 2 projects, **pauses after 1 week inactivity**, no backups |
| Auth | Supabase Auth (GitHub OAuth), single allowed account | Free |
| File storage | Supabase Storage (private buckets) | 1 GB |
| LLM: Google | `@ai-sdk/google`, `@ai-sdk/groq`, `@openrouter/ai-sdk-provider`, Gemini API free tier (Flash-class) | Rate-limited; per-model limits only in AI Studio; free-tier data may be used by Google; Pro models reportedly paid-only |
| LLM: Groq | `@ai-sdk/groq` | Fast open models. *Verify free-tier limits and which models support tools/vision.* |
| LLM: OpenRouter | `@openrouter/ai-sdk-provider` (community package) | One key, many models. *Verify which models are free and their data policies.* |
| Model routing | In-house `models.ts` registry + resolver + fallback | See IMPLEMENTATION_PLAN Phase 0.5 |
| Embeddings | Gemini embedding model *(verify free + dimension)* | Fix vector dimension in schema |
| Notes source of truth | Private GitHub repo (Obsidian vault) + Obsidian Git plugin | Free |
| Web search | Provider TBD *(verify free tier: Tavily/Exa/Brave etc.)* | |
| Tracing (optional) | Langfuse cloud *(verify)* | |
| Charts (Expo) | One RN chart lib *(pick after checking Expo Go vs dev build)* | |

## 2. Ownership rules
| Tool | Owns |
|---|---|
| Next.js | API routes, OAuth callbacks, Inngest endpoint |
| AI SDK | Model access, streaming protocol, tool definitions, MCP client, `useChat` |
| LangGraph | Agent graphs, state, checkpoints, `interrupt()` |
| Inngest | Durable execution, retries, cron, fan-out, waiting for events |
| Supabase | Data, auth, files |

**Rule:** never run a long LangGraph loop inside a chat request. Chat route either streams a short graph directly, or emits an Inngest event and streams progress.

## 3. Key libraries
`ai`, `@ai-sdk/react`, `@ai-sdk/google`, `@langchain/langgraph`, `@langchain/langgraph-checkpoint-postgres`, `@langchain/mcp-adapters` (or AI SDK MCP client), `inngest`, `@supabase/supabase-js`, `drizzle-orm` + `postgres`, `zod`, `react-native-webview`, `expo-secure-store`. Verify package names/versions at install time.

## 4. Environment variables
Server (Vercel env, never in the app bundle): `GOOGLE_GENERATIVE_AI_API_KEY`, `GROQ_API_KEY`, `OPENROUTER_API_KEY`, `SUPABASE_URL`, `SUPABASE_SERVICE_ROLE_KEY`, `DATABASE_URL` (pooled), `INNGEST_EVENT_KEY`, `INNGEST_SIGNING_KEY`, `ENCRYPTION_KEY` (32-byte, for MCP credentials), `GITHUB_VAULT_TOKEN`, `GITHUB_VAULT_REPO`, `SEARCH_API_KEY`, `ALLOWED_USER_ID`.
Client (public by design): `EXPO_PUBLIC_API_BASE_URL`, `EXPO_PUBLIC_SUPABASE_URL`, `EXPO_PUBLIC_SUPABASE_ANON_KEY`. The web dashboard receives the public Supabase URL and anon key from its server page; no extra public env vars are needed. Never put model or service keys in public variables.

## 5. Known constraints
- Remote (streamable HTTP) MCP only. stdio needs a long-lived worker.
- Inngest quota is consumed per step: batch work, keep short chats off Inngest.
- Supabase pause: add a GitHub Actions cron ping (free, not counted against Inngest).
- Handle 429s with backoff, then fall back across Google → Groq → OpenRouter (order configurable). Skip fallbacks that lack a required capability.
- Embeddings use one fixed model; don't switch it with the chat model.
- Streaming on device can be flaky; keep an XHR-based transport as fallback.
