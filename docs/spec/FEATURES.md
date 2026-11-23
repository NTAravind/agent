# Features

Legend: **P0** MVP · **P1** next · **P2** later · **$** needs paid service · **✗** out of scope. Free-tier claims must be re-verified before building.

## 1. Core AI
| Feature | Pri | Notes |
|---|---|---|
| Streaming chat, multi-turn context | P0 | AI SDK `useChat`, messages persisted |
| Reasoning / step-by-step | P0 | Reasoning-capable Gemini Flash-class model |
| Image understanding | P0 | Image parts to multimodal model |
| Document understanding (PDF, txt, md) | P0 | Small: inline file part. Large: chunk → embed |
| Code generation/debug | P0 | Plain model output; sandbox execution P2 |
| Real-time info | P0 | Search tool (provider TBD, verify free tier) |
| Provider model dashboard | P1 | Fetch Google, Groq, OpenRouter, Mistral, DeepSeek, Hugging Face and Cohere catalogs; choose which models are exposed to mobile; show usage per provider/model |
| Agent task model chooser | P1 | Choose a preferred model per task, preserving capability checks and fallback routing |
| Audio/other media input | P2 | Where model supports it |

## 2. Autonomous agent
| Feature | Pri | Notes |
|---|---|---|
| Tool calling | P0 | Native + MCP tools |
| Task planning & multi-step | P1 | LangGraph planner → executor |
| Autonomous tool choice | P1 | Router inside graph |
| Self-correction / retry | P1 | Error node + retry policy |
| Human approval | P1 | LangGraph `interrupt()` + approval card |
| Background execution | P1 | Inngest durable steps |
| Task monitoring | P1 | `agent_runs` + `run_events`, live timeline |

## 3. Web intelligence
| Feature | Pri | Notes |
|---|---|---|
| Search & research report | P0/P1 | Search API + summarise + cite |
| Page extraction / summarise | P1 | Fetch/extract tool |
| Compare products/services | P1 | Output to canvas table |
| Verify across sources | P1 | Verifier node |
| Monitor websites for changes | P1 | Inngest cron + content hash |
| Lead finding, competitor research | P2 | Built on research + monitor |
| Real browser automation | P2 | Browser MCP; usually needs paid/hosted browser |

## 4. Image, video, creative
| Feature | Pri | Notes |
|---|---|---|
| Text-to-image / edit / restyle | P2 | Free availability uncertain; verify |
| Thumbnails/social creatives | P2 | Image gen + canvas |
| Image-to-video / text-to-video | $ | Not free; skip v1 |
| Video understanding | P2 | Model-dependent |

## 5. Voice
| Feature | Pri | Notes |
|---|---|---|
| Speech-to-text, text-to-speech | P2 | Device/native speech APIs first (free) |
| Voice commands → tasks | P2 | Transcript feeds the same agent |
| Realtime voice, interruptions, VAD | $ | Not free; later |

## 6. Memory & personalisation
| Feature | Pri | Notes |
|---|---|---|
| Short-term memory | P0 | Thread history + LangGraph checkpointer |
| Long-term memory | P0 | Inngest extracts facts after chats → `memories` |
| Preferences, past decisions | P1 | Tagged memories |
| Custom personality/instructions | P0 | Per-agent system prompt |
| Knowledge base / second brain | P0 | GitHub vault → chunks → pgvector |
| Recall past conversations | P1 | Search over messages |

## 7. X / social intelligence
All **$ / P3**. X API is paid. Hide behind a tool/MCP interface so it can be added later.

## 8. Multi-agent
| Feature | Pri | Notes |
|---|---|---|
| Custom agents with roles | P1 | `agents` table |
| Agent avatars and identity | P1 | Emoji, icon or uploaded image; identify the agent in chat, threads, runs and approvals |
| Supervisor + delegation | P2 | LangGraph supervisor |
| Parallel research | P2 | Inngest fan-out / parallel branches |
| Cross-check, combine results | P2 | Verifier/merger nodes |
| Progress display, audit | P1 | Timeline UI + `run_events` |

## 9. Platform features (added)
| Feature | Pri | Notes |
|---|---|---|
| Multi-provider models (Google, Groq, OpenRouter, Mistral, DeepSeek, Hugging Face, Cohere) | P0 | Registry, picker, per-agent model, automatic fallback |
| MCP store (one-tap add) | P1 | Remote servers only |
| Canvas / dynamic dashboards | P1 | JSON spec → native render |
| Notes editor + graph/backlinks | P1 | Read/write vault |
| Skills (progressive disclosure) | P1 | Vault markdown bundles; name + description in the prompt, body loaded on demand; tool allow-list can only narrow |
| Tasks & calendar | P1 | Lists, subtasks, due dates, priorities, recurring events (RRULE expanded on read), soft delete |
| Reminders | P1 | `reminder/tick` cron → Expo push, claimed in `reminder_log` so each fires once |
| Agent run alerts | P1 | Expo push on top-level agent task success or failure; supervisor child runs are grouped under the parent alert |
| Routines (chat-first scheduling) | P1 | Agent proposes a schedule, user confirms, result posts back into the agent's chat |
| Agent groups & handoff | P1 | Dynamic groups are durable chats; members consult or hand off sequentially, with server-side membership, hop/token/depth guards, approval-gated child runs, visible handoff chips, and `@agent` entry routing. A group conversation is never an ordinary chat: `/api/chat` refuses it (409 `group_thread`) and the app routes it to the group screen (Phase 11) |

## Free vs not free (summary)
Free: chat, vision, docs, search (limited), memory, notes, approvals, multi-agent, agent groups, MCP, canvas, monitoring, skills, tasks/calendar, reminders, routines. Likely paid: video gen, realtime voice, X data, hosted browsers, high image-gen volume.
