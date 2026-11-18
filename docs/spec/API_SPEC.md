# API Spec

Base URL: `EXPO_PUBLIC_API_BASE_URL`. All routes require `Authorization: Bearer <Supabase JWT>` (except webhooks/OAuth callback/Inngest) and verify the user equals `ALLOWED_USER_ID`. Errors: `{ "error": { "code": string, "message": string } }`.

## 1. Chat
| Method | Route | Description |
|---|---|---|
| POST | `/api/chat` | Body `{ threadId?, messages, agentId?, model?, mode: "chat"\|"agent" }` (`model` = registry id like `groq:...`; falls back to agent/default). Streams AI SDK UI message stream. `mode:"agent"` creates a run and streams its progress parts. |
| GET | `/api/threads` | List threads (cursor paging), including the selected agent's `avatar` object when set |
| GET | `/api/threads/:id` | Thread + messages |
| PATCH/DELETE | `/api/threads/:id` | Rename / delete |
| GET | `/api/models` | Only mobile-enabled catalog models, capabilities, `available` (key configured), today's usage per provider |
| PUT | `/api/settings/models` | `{ defaultModel, fallbackOrder[] }` |
| GET | `/api/admin/models` | Provider catalog, mobile availability, provider key status and recent provider/model usage |
| POST | `/api/admin/models/refresh` | Fetch catalogs from configured providers and persist model metadata |
| PATCH | `/api/admin/models` | `{ models:[{ id, enabled }] }` to control mobile availability |

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
| GET | `/api/search?q=&k=` | Hybrid search over notes + memories |

## 4. Agents, runs, approvals
| Method | Route | Description |
|---|---|---|
| GET/POST | `/api/agents` | List / create (`AgentCreateSchema`: name, role, instructions, model, fallbackModels, avatar, isSupervisor). Full agent responses: `avatar` object (image avatars carry a response-only signed `url`; `value` stays the raw Storage path), `toolCount`, `isSupervisor` |
| PATCH/DELETE | `/api/agents/:id` | Update (`AgentPatchSchema`; `null` clears nullable fields) / delete |
| POST | `/api/agents/:id/avatar` | Returns a signed Storage upload URL for an image avatar |
| POST | `/api/agents/run` | `{ goal, threadId?, model?, agentId?, inline? }` → `{ runId }` (queues Inngest unless `inline: true`; `agentId` scopes the run to an agent, `model` is preferred for task nodes) |
| GET | `/api/runs` | List recent top-level runs — supervisor child runs are excluded and live under their parent |
| GET | `/api/runs/:id` | Status + result + the full `run_events` timeline (returned whole on each poll — there is no separate events/SSE route); includes the run agent's `avatar` object, `pendingApprovals`, and for supervisor runs `children` (child runs each embedded with their agent summary) |
| POST | `/api/runs/:id/cancel` | Cancel |
| GET | `/api/approvals?status=pending` | Pending approvals |
| POST | `/api/approvals/:id` | `{ decision: "approve"\|"deny", edits? }` → emits `approval/decided` |

**Supervisor runs:** runs whose agent has `is_supervisor = true` execute the dedicated supervisor graph `delegate → fan_out → verify → merge` (`apps/api/lib/agent/supervisor.ts`) instead of the single-agent graph. `delegate` emits ≥2 structured briefs on distinct specialist agents (capped at 4); `fan_out` creates full single-agent child runs (`agent_runs.parent_run_id`, idempotent on Inngest retry) and runs them in parallel with `approvalMode: "deny"` — children auto-deny sensitive tools instead of parking on approvals (v1 decision, not yet approval-gated); `verify` cross-checks their outputs with a model from a *different* provider than the workers (`pickCrossProviderModel`, keyed providers only); `merge` synthesizes the final answer with the run's model chain, applying the verifier's corrections. Fewer than 2 specialists falls back to the single-agent graph plus a `message` event. Dispatch is `executeRun` (`apps/api/lib/agent/execute.ts`), used by both POST `/api/agents/run` and the Inngest handler.

## 5. MCP store
| Method | Route | Description |
|---|---|---|
| GET | `/api/mcp/servers` | Registry with `connected` flag; camelCase rows incl. `instructions`. `?all=1` (admin) also returns disabled listings |
| GET | `/api/mcp/servers/:id` | Single listing (admin) |
| POST | `/api/mcp/servers` | Admin create listing (`MCPServerCreateSchema`); 409 on duplicate slug |
| PUT | `/api/mcp/servers/:id` | Admin update (`MCPServerPatchSchema`); supports `slug`, `instructions`, `disabled`; 409 on duplicate slug |
| DELETE | `/api/mcp/servers/:id` | Admin delete (cascades to tools/connections) |
| POST | `/api/mcp/connections` | `{ serverId, apiKey? }` or returns `{ authUrl }` for OAuth |
| GET | `/api/mcp/oauth/callback` | Completes OAuth, stores encrypted creds |
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
| `chat/completed` | Extract & upsert memories |
| `vault/changed` | Parse, chunk, embed changed notes |
| `document/uploaded` | Parse, chunk, embed document |
| `canvas/refresh.requested` + cron | Refresh data-bound canvases |
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
| `create_monitor(url,...)` | yes | |
| MCP tools | per-tool flag | Default **yes** |

Supervisor delegation is not a tool: `is_supervisor` agents execute the dedicated `delegate → fan_out → verify → merge` graph described in §4 (the former `delegate(agent,task)` row was removed 2026-11-18).

## 9. Streaming
AI SDK UI message stream. Custom data parts: `data-run-event` (node/tool progress), `data-approval` (pending approval card), `data-canvas` (canvas id).
