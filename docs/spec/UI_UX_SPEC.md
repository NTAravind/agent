# UI / UX Spec (Expo app)

## 1. Principles
- **Grok-inspired Cyber-Minimalism**: Obsidian / pure pitch-black canvas (`#000000` / `#09090b`), smoky graphite surfaces (`#121215` / `#18181b`), razor-thin translucent borders (`rgba(255, 255, 255, 0.08)`), high-contrast typography, and subtle glowing electric accents.
- Chat is home; everything else is one tap away.
- Show work: long tasks show a live timeline, not a spinner; reasoning models surface an interactive collapsible "Thinking" trace accordion.
- Ask before acting: approvals are impossible to miss and fast to answer.
- Native-feeling, dark and light themes, thumb-reachable floating capsule controls.

## 2. Navigation (bottom tabs)
| Tab | Purpose |
|---|---|
| Chat | Threads, composer, streaming messages, inline canvases |
| Agents | Agents as chats: last message preview, unread badge |
| Today | Agenda: today's events + due/overdue tasks, quick-add, complete by tap |
| Notes | Vault browser, search, note view with backlinks, markdown editor |
| More | Canvas, Routines, Groups, Skills, Memories, account/diagnostics |

Approvals badge appears on the tab bar and as a banner anywhere.

Tab order is **Chat, Agents, Today, Notes, More**. Detail screens (agent detail, note editor, tasks, calendar) stay in the root stack so deep links keep working; the tab navigator only creates screens for its own tab targets.

## 2b. Productivity (Phase 9)
- **Today**: header with the date; quick-add row ("Add a task for today…"); sections in order — Schedule (today's events, time + location), Overdue (red), Due today, Suggested (accept ✓ / dismiss ✗), Upcoming. Agent-created items carry a small **AI** badge; memory-extracted items carry a **SUGGESTED** badge.
- **Tasks**: list chips (one per task list, plus "new list"), task rows with tap-to-complete circle, title, due label, priority dot, recurrence glyph, subtask indentation, per-row "Subtask" and delete actions; composer sheet for new task/subtask.
- **Calendar**: segmented Month / Week / Agenda; month grid with per-day event dots and a selected-day agenda below; week view lists seven days; agenda is chronological. Event editor sheet: title, date, start/end time, all-day switch, location, "repeat weekly" switch, reminder minutes.
- **Note editor**: markdown textarea + editable vault path (rename/move). Save commits to the vault immediately (user-initiated, no approval); a rename removes the old file. Delete asks for confirmation.
- **Reminders**: push notifications deep-link into Today (`/`) or Calendar (`/calendar`); remote push requires a development build (Expo Go cannot receive remote notifications on Android since SDK 53).

## 2c. Routines (Phase 10)
- **Chat header (agent context)**: a **clock icon** opens the routine sheet for that agent — list of its routines (name, schedule label, next run, status), tap for the detail sheet.
- **Routine detail sheet**: schedule label, next run (+ the two after it), the prompt, and the actions **Pause / Resume**, **Run now**, **Edit**, **Delete**. The editor covers name, prompt, frequency (daily / weekly / monthly), weekday chips and the local `HH:mm`.
- **Proposal card** (inline in the chat): when the agent proposes a schedule, a bordered card shows the name, the plain-English schedule (*"Every Monday at 09:00"*), the prompt and the **next three runs** in the user's timezone, with **Confirm** and **Edit** buttons. Nothing recurring starts until Confirm is tapped; after confirming the card shows a **Scheduled** badge.
- **Trigger chip**: a routine-fired message renders as a small violet pill (*"Routine · Monday summary"*) instead of a normal user bubble.
- **Routines screen** (More → Routines): the same list as the sheet, one row per routine (name, schedule, next run, status badge); tapping opens the detail sheet.
- **Timezone**: the chat request carries the device timezone so "every Monday at 9" means 9 where the user is; the server owns the dates.

## 3. Screens
**Chat**:
- **Header**: Translucent frosted blur header (`expo-blur`), clean minimalist icons (`menu`, `plus`, `back`, `details`), centered pill-shaped model picker.
- **Empty / Welcome Hero**: Grok-style centered glowing geometric emblem, bold prompt (*"What do you want to explore?"*), categorized prompt pills with icons (🌐 DeepSearch, 🧠 Think & Analyze, ⚡ Quick Answer, 🛠️ Run Agent Task).
- **Composer**: Floating `rounded-3xl` dark glass capsule with embedded quick toggles: **DeepSearch** (web search), **Think** (reasoning models), and **Task Mode** (autonomous run), flanked by `+` media attach and a circular high-contrast send button (pure white circle with black arrow).
- **Messages**:
  - User: Compact dark graphite capsule bubble (`#1c1c21`, `rounded-2xl`).
  - Assistant: Full-bleed natural typography directly on canvas. Includes interactive collapsible **"Thinking"** trace accordion (*"✦ Thought for 4s ▾"*) for reasoning tokens, sleek numbered source citation cards for web search results, collapsible tool chips, inline canvas cards, approval cards, and an action bar (copy, regenerate, view task).
**Run detail**: header (goal, status — `queued / running / awaiting_approval / paused / succeeded / failed / cancelled` —, elapsed), vertical timeline of events (node, tool call, result, retry), with the responsible agent's avatar on each step and child run; footer controls (Pause + Cancel while executing, Resume + Cancel while paused), final result. Supervisor runs show a **Specialists** section with each child run (specialist avatar + name + status), tappable through to the child's own timeline.
**Approval card**: agent avatar and identity (for example, “Researcher wants to…”), tool name, plain-language summary, arguments (expandable), buttons Approve / Deny, optional edit of arguments. States: pending, approved, denied, expired.
**Canvas list/detail**: cards with title and last updated; detail renders spec full-screen, pull-to-refresh, "Ask about this" button that opens chat with the canvas as context.
**Notes**: folder tree, search bar (hybrid), note view (markdown, `[[links]]` tappable, backlinks section), **edit** (markdown editor with a rename/move path field; writes commit to the vault immediately — no approval, because they are user-initiated), "Ask agent about this note".
**Agents**: list with avatar, role and MCP tool count; swipe/long-press row actions (**pause/resume the active task** is server-backed, skip and notifications are local) and a per-row activity line (`⏸ Paused: …` for paused tasks); overview with quick-action tiles — pause/resume the active task (disabled when none), notifications (local), **sleep/wake** (pauses all of the agent's tasks and blocks new ones while asleep), memory (local) — plus editor for name, role, instructions, primary model + fallback order, tools toggle list with per-tool "require approval", **Skills** (assign/unassign, saved immediately) and a **Supervisor** switch (orchestrates specialist agents in multi-agent runs). Avatar picker has Emoji, Icon and Upload tabs plus a color swatch row.
**Skills**: list of `skills/<slug>/SKILL.md` bundles (tool chips, assignment count); editor for name, slug, description, tool allow-list and body; delete. Reachable from **More**.
**Routines**: list of the user's routines (name, schedule label, next run, status badge); tap opens the routine sheet (schedule, next run, pause/resume, edit, run now, past runs). Reachable from **More** and from the clock icon in an agent's chat header.
The new-task form includes an **agent picker** (a supervisor agent is preselected when one exists, with a hint explaining it delegates to specialists) and a model chooser populated from enabled provider catalog entries.
**Store**: grid of servers with icon, description, auth type. Tap Add → permission sheet listing tools → connect (OAuth in system browser or key entry) → enable for agents. Connected servers show a Manage state. Detail screens show a **Setup instructions** card when the listing has `instructions` (steps only, never secrets).
**Settings**: sign out, memory viewer (list, delete), vault repo status and last sync, default model and fallback order, theme.
**Web provider dashboard**: provider key status (configured/missing, never shown), refreshable model catalogs for Google, Groq, OpenRouter, Mistral, DeepSeek, Hugging Face and Cohere with per-model mobile availability toggles, plus request/token/error usage grouped by provider and model. A fourth **Integrations** tab (shadcn/ui only) manages marketplace listings: search, create/edit dialog (name, slug, category, description, URL, auth type, icon URL, Instructions textarea), enable/disable switch, and delete behind a cascade-confirm dialog.

## 4. Canvas component catalog (v1)
| Type | Props | Rendering notes |
|---|---|---|
| `stat` | label, value, delta? | Large number card |
| `chart` | kind: line\|bar\|pie, data[{x,y}] | Single series v1; touch tooltip |
| `table` | columns, rows | Horizontal scroll, sticky first column |
| `list` | items[{title, subtitle?, link?}] | |
| `markdown` | text | Same renderer as chat |
| `image` | uri, alt | Signed Storage URL only |
| `button` | label, action, payload? | `action` ∈ `send_prompt`, `refresh`, `open_note` |
| `tabs` | tabs[{label, child}] | |
| `stack` | direction, children | Layout; nesting depth ≤ 4 |
Invalid or unknown nodes render a muted "can't display this block" card, never crash. Spec size limit 100 KB. Optional `html` fallback in sandboxed WebView (no network, no bridge).

## 5. Design tokens (Grok obsidian palette)
- Canvas: `#000000` (deep true pitch black) / `#09090b` (zinc-950)
- Surface / Cards: `#121215` / `#18181b` (obsidian charcoal)
- Borders: `rgba(255, 255, 255, 0.08)` / `#27272a` (ultra-thin hairline)
- Accent: `#ffffff` (crisp white) / subtle neon glow `#38bdf8`
- Spacing scale: 4/8/12/16/24/32. Radius: 12 (chips/cards), 24 (capsule containers), 9999 (full pills). Type: system font; sizes 12/14/16/20/28. Avatar sizes: 24 pt in timelines, 32 pt in chat, 56 pt in the editor. Minimum tap target 44 pt.

## 6. States & feedback
- Loading: skeletons for lists; streaming cursor and glowing indicator for chat.
- Empty: Grok-style hero and quick capability suggestions.
- Errors: plain cause + action ("Rate limit reached. Retrying in 20 s." / Retry button). No blame, no apology.
- Offline: cached threads and canvases readable; composer queues until online.
- Quota meter warns at 80% of monthly free limits.

## 7. Accessibility & platform
Dynamic type, screen reader labels on all controls and chart summaries (text alternative), reduced-motion respected, haptics on approvals. Primary target iOS/Android via Expo; web build is optional later.

## 8. Voice (P2)
Hold-to-talk using device speech recognition, transcript editable before sending; read-aloud toggle per message using device TTS.
