# API Spec

Base URL: `EXPO_PUBLIC_API_BASE_URL`. All routes require `Authorization: Bearer <Supabase JWT>` (except webhooks/OAuth callback/Inngest) and verify the user equals `ALLOWED_USER_ID`. Errors: `{ "error": { "code": string, "message": string } }`.

## 1. Chat
| Method | Route | Description |
|---|---|---|
| POST | `/api/chat` | Body `{ threadId?, messages, agentId?, model?, mode: "chat"\|"agent" }` (`model` = registry id like `groq:...`; falls back to agent/default). Streams AI SDK UI message stream. `mode:"agent"` creates a run and streams its progress parts. |
| GET | `/api/threads` | List threads (cursor paging) |
| GET | `/api/threads/:id` | Thread + messages |
| PATCH/DELETE | `/api/threads/:id` | Rename / delete |
| GET | `/api/models` | Registry with capabilities, `available` (key configured), today's usage per provider |
| PUT | `/api/settings/models` | `{ defaultModel, fallbackOrder[] }` |

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
| GET/POST | `/api/agents` | List / create |
| PATCH/DELETE | `/api/agents/:id` | Update / delete |
| POST | `/api/runs` | `{ agentId, goal, threadId? }` → `{ runId }` (queues Inngest) |
| GET | `/api/runs/:id` | Status + result |
| GET | `/api/runs/:id/events?after=` | Poll or SSE of `run_events` |
| POST | `/api/runs/:id/cancel` | Cancel |
| GET | `/api/approvals?status=pending` | Pending approvals |
| POST | `/api/approvals/:id` | `{ decision: "approve"\|"deny", edits? }` → emits `approval/decided` |

## 5. MCP store
| Method | Route | Description |
|---|---|---|
| GET | `/api/mcp/servers` | Registry with `connected` flag |
| POST | `/api/mcp/connections` | `{ serverId, apiKey? }` or returns `{ authUrl }` for OAuth |
| GET | `/api/mcp/oauth/callback` | Completes OAuth, stores encrypted creds |
| DELETE | `/api/mcp/connections/:id` | Disconnect |
| GET | `/api/mcp/connections/:id/tools` | Live tool list |
| PUT | `/api/agents/:id/mcp` | `{ connectionId, tools:[{name, requiresApproval}] }` |

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
| `delegate(agent,task)` | no | Supervisor only |
| MCP tools | per-tool flag | Default **yes** |

## 9. Streaming
AI SDK UI message stream. Custom data parts: `data-run-event` (node/tool progress), `data-approval` (pending approval card), `data-canvas` (canvas id).
