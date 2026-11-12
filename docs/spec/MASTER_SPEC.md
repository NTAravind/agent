# Master Spec: Personal AI Agent ("Grok-style" assistant + Second Brain)

*Status: v0.1 draft · Owner: you (single user) · Last updated: 12 Nov 2026*

## 1. Vision
A personal, always-available AI assistant you can use from your phone (Expo) and web. It chats, researches, runs long tasks in the background, remembers you through an Obsidian-style second brain, can be extended with MCP servers in one click, and can show answers as live dashboards ("canvas").

## 2. Goals
- G1. One agent that plans and executes tasks from a single instruction, asking approval before sensitive actions.
- G2. A second brain: your Obsidian vault (markdown + `[[wikilinks]]`) is searchable and writable by the agent.
- G3. MCP store: add/remove tool servers per agent with one tap.
- G4. Canvas: agent renders dashboards/reports natively in the app from a JSON spec.
- G5. Runs anywhere (cloud), **free**, single user.
- G6. Provider-agnostic: Google, Groq and OpenRouter selectable per chat/agent via the AI SDK, with automatic fallback.

## 3. Non-goals (v1)
- Multi-user, teams, billing, public sharing.
- Self-hosted model inference.
- stdio MCP servers (needs a long-lived host).
- X/Twitter intelligence (paid API) and realtime speech-to-speech (not free).
- Video generation (not on Gemini free tier).

## 4. Constraints
| Constraint | Consequence |
|---|---|
| Free tiers only | Gemini free tier, Vercel Hobby, Supabase Free, Inngest Hobby. Design for quotas. |
| Personal use | Vercel Hobby (non-commercial) is acceptable. Auth = your GitHub account only. |
| Mobile-first | Expo app is the primary client; the server is a Next.js API. |
| Privacy | Gemini free tier may use requests to improve Google products. Don't send sensitive notes through it by default. |

## 5. Principles
1. **Server owns intelligence, client owns pixels.** Keys and agents live on the server; Expo renders.
2. **Durable by default.** Anything over ~1 minute runs in Inngest, never inside a chat request.
3. **Approve before harm.** Sensitive tools require explicit approval.
4. **Specs, not code.** The agent emits validated JSON for UI; never executable code.
5. **Rebuildable.** Supabase is an index; the GitHub vault is the source of truth for notes.

## 6. Document map
| File | Purpose |
|---|---|
| FEATURES.md | Scope, priorities, what is free vs paid |
| TECH_STACK.md | Tools, free-tier limits, env vars |
| ARCHITECTURE.md | Components, flows, security |
| DATABASE_SCHEMA.md | Postgres/pgvector schema, RLS |
| API_SPEC.md | HTTP routes, agent tools, Inngest events |
| UI_UX_SPEC.md | Expo screens, canvas catalog, design tokens |
| IMPLEMENTATION_PLAN.md | Phases, acceptance criteria, risks |

## 7. Success criteria
- Ask from phone → get streamed answer with citations in < 3 s to first token.
- "Research X and put it on a dashboard" completes in the background and appears in the Canvas tab.
- Agent finds a note you wrote months ago and links it in its answer.
- Adding an MCP server takes ≤ 3 taps and its tools work in the next run.
- Monthly cost: $0.

## 8. Glossary
**Agent**: configured LLM + tools + instructions. **Run**: one execution of an agent graph. **Vault**: Obsidian folder in a private GitHub repo. **Canvas**: persisted JSON UI spec rendered natively. **MCP**: Model Context Protocol tool server.
