# Mobile App Screen Reference

> Complete navigation guide for the Expo mobile app (`apps/mobile`). Every route in `src/app/` is a screen. Deep links work everywhere.

---

## Tab Bar (Root Layout)

**Route:** `src/app/_layout.tsx`

| Tab | Icon | Label | Screen | Deep link |
|-----|------|-------|--------|-----------|
| 1 | `message-square` | **Chat** | `chat.tsx` | `chat?threadId=…` or `chat?agentId=…` |
| 2 | `bot` | **Agents** | `agents.tsx` | `agents/[id]`, `agents/[id]/edit`, `agents/new/edit` |
| 3 | `layout-dashboard` | **Canvas** | `canvas.tsx` | `canvas/[id]` |
| 4 | `file-text` | **Notes** | `notes.tsx` | `note/[id]` |
| 5 | `settings` | **Settings** | `settings.tsx` | — |

Active tint = `accent`, inactive = `muted`. iOS uses native tab bar; Android uses bottom navigation with labels.

---

## 1. Chat — `src/app/chat.tsx`

**Purpose:** Conversational interface with the current agent. Two contexts: **free chat** (no agent fixed) and **agent chat** (agent fixed by context).

### Entry points
| Path | Context |
|------|---------|
| `/chat` | Free chat — model/agent pickers in header |
| `/chat?threadId=<uuid>` | Resume existing thread — inherits its agent & model |
| `/chat?agentId=<uuid>` | **Contact chat** — resumes the agent's most recent thread (newest by `updated_at`); if none exists, the first send creates one seamlessly |
| `/chat?agentId=<uuid>&prompt=<text>` | Contact chat with pre-filled composer |

### Layout zones

```
┌─────────────────────────────────────┐
│ AppHeader                           │  ← sticky
│  free chat: ☰ · ModelPicker · ＋    │
│  agent ctx: ← · (avatar Name) · 🔍 🛏│  ← avatar+name → contact card
│  agent ctx adds: model pill below   │
├─────────────────────────────────────┤
│ Message List (ScrollView)           │  ← auto-scroll
│  User: right bubble                 │
│  Assistant: left avatar + content   │
│  Tool parts → chips                 │
│  Canvas cards inline                │
│  Approval cards                     │
│  [View task] right-aligned          │
│  ┌ Task bubbles (agent runs) ─────┐ │  ← live: status, current step,
│  │ goal · status · step · tools   │ │     tool chips, View task (right)
│  │                  [View task]   │ │     polled every 3–4s
│  └────────────────────────────────┘ │
├─────────────────────────────────────┤
│ Attachment preview row (horizontal) │
├─────────────────────────────────────┤
│ Composer (grows)                    │  ← sticky bottom
│  [+]  [text]  [send]                │
│  AgentPicker only in free chat      │
└─────────────────────────────────────┘
```

### Header contexts

| Slot | Free chat | Agent chat (`agentId` or thread with agent) |
|------|-----------|---------------------------------------------|
| **Left** | `menu` → threads | `chevron-left` → back **+ tappable 32pt avatar & name → `/agents/[id]` (contact card)** |
| **Center** | ModelPicker | *(empty — identity lives on the left)* |
| **Right** | `＋` new chat | `search` (TODO) + `details` (`SLEEP_ICON`) → contact card |

In agent context the **model picker moves to a pill under the header** (kept accessible), and the **AgentPicker row above the composer is hidden** — the agent is fixed by the context.

### Thread resumption (contact behavior)
Opening `/chat?agentId=<id>` fetches the agent's threads (`GET /api/threads`), picks the most recent one with `agent_id === agentId`, and loads its history. The `useChat` id swap is staged: history is stashed and applied after the new Chat instance exists. If the user sends before resumption completes (or no thread exists), the client-generated thread id wins and the server creates a thread on first send.

### Live runs inside the thread
While an agent chat is open:
- **`GET /api/runs` is polled every 4s** and filtered by `run.agent_id` — executing runs, **paused** runs, and the 3 most recent finished ones render as **`RunTaskBubble`** cards (max 4) after the messages, so tasks started elsewhere appear in the conversation.
- The **primary active run's detail** (`GET /api/runs/:id`) is **polled every 3s** — only an *executing* run holds the slot (a paused run never steals it; the runs poll picks a resumed run back up). Its event timeline drives the live **current step** line (open `node_start`/`tool_call`, LIFO) and recent **tool chips**, transitioning in place (`Plan` → `Thinking` → tools → completion) without leaving the chat.
- Each bubble's right-aligned **View task** → `/run/[id]`. Status transitions are reflected by the status chip (`Queued / Running / Awaiting approval / Paused / Done / Failed / Cancelled`).
- Assistant messages containing tool parts keep a right-aligned **View task** button linked to the agent's active run (`TODO(backend)`: messages still carry no `run_id`).

### Key components
- **ModelPicker** — pill button, opens bottom sheet.
- **AgentPicker** — horizontal chip row (free chat only).
- **Composer** — rounded-2xl container, multiline, leading `[+]` (photo/document), trailing send (accent).
- **MessageBubble** — user = right bubble; assistant = left with 24pt avatar. Parts: text → markdown → code blocks → citations → tool chips → canvas cards → approvals → **View task** button (`runId` prop, right-aligned) → `run/[id]`.
- **RunTaskBubble** — agent-run task card in the timeline: goal, status chip, live current-step line (spinner while running, Lucide `wrench` for tool steps), recent tool chips, right-aligned **View task**.
- **SLEEP_ICON** constant in `constants/icons.ts` (defaults to `Bed`; swap to `Info` or `SlidersHorizontal` in one place).

---

## 2. Agents List — `src/app/agents.tsx`

**Purpose:** Browse, search, create agents; quick-access to each agent's chat.

### Layout

```
┌─────────────────────────────────────┐
│ AppHeader ("Agents" h2 · 🔍)        │  ← left-aligned title, search only
├─────────────────────────────────────┤
│ QUICK ACCESS                        │  ← horizontal scroll
│  ┌────┐ ┌────┐ ┌────┐ ┌────┐ ┌──┐  │
│  │🟦76│ │    │ │    │ │    │ │＋ │  │  rounded-2xl tiles (76pt)
│  └─┬──┘ └─┬──┘ └─┬──┘ └─┬──┘ └──┘  │
│  Personal  A1  A2  A3  New        │
├─────────────────────────────────────┤
│ ALL AGENTS (surface panel,         │
│ ┌─────────────────────────────────┐ │  rounded-t-2xl)
│ │ [44] Name                       │ │
│ │      current activity (muted)   │ │  thin dividers, no cards
│ │ ─────────────────────────────── │ │
│ └─────────────────────────────────┘ │
├─────────────────────────────────────┤
│ New task (kept for backwards compat)│
│ Runs list                           │
└─────────────────────────────────────┘
```

### Pinned / quick-access row
- **Order:** personal agent (first non-supervisor, marked with accent dot) → other agents → **New** tile (`plus` icon).
- **Tile:** 76×76 `rounded-2xl` surface, rounded-square avatar (`shape="rounded"`), label below (`body-xs` semibold).
- **Tap →** `/chat?agentId=<id>`.

### Agent list panel
- One large `surface` panel with `rounded-t-2xl` top radius.
- **Rows:** 44pt circular avatar, name (`body` semibold), one-line truncated activity subtitle (`body-xs` muted) = active run's goal → role → "Idle".
- **Row actions** (pause/resume · skip · notifications): **swipe left** (gesture-handler) or **long-press** (fallback). Slides in a `rounded-full` surface/border pill with three icon buttons. Only one row open; tap elsewhere or scroll closes it. **Pause/Resume is server-backed** (`POST /api/runs/:id/pause|resume` on the agent's active run; the pill flips from the run's `paused` status) — skip stays `TODO(backend)`, notifications is a local mute toggle.
- **Tap row →** `/chat?agentId=<id>`.

### Header actions
- **🔍 Search** → HeroUI `BottomSheet` + `SearchField` (filters by name, role, or the active run's goal — matched via the run's `agent_id`).
- Creation lives in the **New** quick-access tile (and the empty-state CTA) — the header stays search-only.

### Run ↔ agent matching
`GET /api/runs` joins `agent_id` + the agent summary on every row, so list subtitles, search results and the overview's "Active:" chip all match runs by `agent_id` (the old goal-substring heuristic is gone).

### States
| State | Handling |
|-------|----------|
| **Loading** | `Skeleton` shimmer tiles (quick row) + 5 skeleton rows (panel). |
| **Empty** | "Create your first agent" CTA → `/agents/new/edit`. |
| **Error** | Inline message + **Retry** button. |

---

## 3. Agent Overview — `src/app/agents/[id].tsx`

**Purpose:** Read-only summary + quick controls. The full editor lives at `agents/[id]/edit.tsx`.

### Layout

```
┌─────────────────────────────────────┐
│ AppHeader (← · Name · ⋯)            │
├─────────────────────────────────────┤
│          (breathing room)           │
│           [ avatar 96 ]             │  ← centered
│            Agent 1 (h2)             │
│        [ Active: goal chip ]        │  ← only if run active
├─────────────────────────────────────┤
│ ┌─ surface sheet, rounded-t-2xl ──┐ │  ~2/3 screen
│ │ ┌─────┐┌─────┐┌─────┐┌─────┐   │ │  quick actions (4 tiles)
│ │ │⏸  ││🔔  ││🛌  ││🧠  │   │ │  rounded-xl, accent border when on
│ │ └─────┘└─────┘└─────┘└─────┘   │ │
│ │ AGENT INFO            [Edit]    │ │  name · role · model · fallback ·
│ │ ─────────────────────────────── │ │  supervisor · instructions (2 lines)
│ │ TOOLS      [Edit tools][Add int]│ │  toolCount chip + sheet
│ │ DANGER ZONE  [Duplicate][Delete]│ │  destructive + confirm
│ └─────────────────────────────────┘ │
└─────────────────────────────────────┘
```

### Quick actions (`AgentQuickActions`)
Four `accessibilityRole="switch"` tiles — pause and sleep are server-backed; notifications and memory are optimistic local state (`TODO(backend)`):
1. **Pause/Resume** — pauses/resumes the agent's active run (`POST /api/runs/:id/pause|resume`); disabled (dimmed, `accessibilityState.disabled`) when there is no active run. State derives from the run's `paused` status.
2. **Notifications** — bell ↔ bell-off (`TODO(backend)`).
3. **Sleep/Wake** — `SLEEP_ICON` (same glyph as chat header details button); `POST /api/agents/:id/sleep|wake` pauses all of the agent's tasks and blocks new ones until wake. Server state (`agent.isSleeping`), shown with a `💤 Sleeping` chip.
4. **Memory** — `brain` / `brain-off` (`save_memory` / `recall_memory`, `TODO(backend)`).

### Sections
| Section | Content | Actions |
|---------|---------|---------|
| **Agent info** | name, role, primary model, **fallback models** (comma list), supervisor flag, **instructions preview** (2-line truncate) | **Edit** → `/agents/[id]/edit` |
| **Tools** | tool count summary + chip | **Edit tools** → sheet; **Add integrations** → `/mcp` |
| **Danger zone** | Duplicate, Delete (confirm) | — |

### ⋯ Header menu (fallback)
Repeats Edit / Duplicate / Delete — moved here from the list's long-press context menu.

### Create flow
`/agents/new` **redirects** to `/agents/new/edit` (the editor in create mode).

---

## 4. Agent Editor — `src/app/agents/[id]/edit.tsx`

**Purpose:** Full configuration (create + edit). Unchanged from previous phase.

### Sections (ScrollView)
| Section | Fields | Visual |
|---------|--------|--------|
| **Identity** | Avatar picker (Emoji/Icon/Upload + 8 colors), Name (req), Role (opt) | Avatar 56pt top-center |
| **Model** | Primary (ModelPicker), Fallback order (chips, max 5) | Primary = pill; fallbacks = numbered chips |
| **Supervisor** | Toggle "orchestrates specialists" | Switch + helper; hides Model/Tools when on |
| **Instructions** | Textarea (maps to `system_prompt`) | Multiline |
| **Danger Zone** | Delete agent (confirm) | Red button |

### Avatar picker
Three tabs: **Emoji** (4×4 grid), **Icon** (glyph grid), **Upload** (signed URL → Supabase `avatars` bucket). Color swatch row below emoji/icon.

---

## 5. Canvas List — `src/app/canvas.tsx`
**Purpose:** Gallery of saved canvases (dashboards/reports).
- 2-col grid (phone) / 3-col (tablet).
- Card: 16:10 preview, title overlay, updated-at.
- Tap → `canvas/[id]`; Long press → duplicate/delete.
- Empty: "No canvases yet" + CTA.
- Header: title + **＋** create.

---

## 6. Canvas Detail — `src/app/canvas/[id].tsx`
**Purpose:** Full-screen native rendering of a canvas spec. Pull-to-refresh re-runs data.

### Layout
- Sticky header: title + `⋯` menu (Refresh · Ask about this · Edit spec · Delete).
- ScrollView: components flow vertically (Stat / Chart / Table / Markdown / Image / Button / Tabs / Stack).

### Component visuals
| Component | Spec |
|-----------|------|
| **Stat** | Large number (heading), label (muted), optional trend sparkline. Card `p-4`. |
| **Chart** | Reanimated/Victory Native. Legend bottom. Tooltip on press. |
| **Table** | Sticky header, horizontal scroll if needed. Row press highlight. |
| **Markdown** | `react-native-markdown-render`. Links open in-app browser. |
| **Image** | Full-width, aspect preserved. Tap → fullscreen zoom. |
| **Button** | Accent primary. `onPress` → `open_url` / `run_agent` / `refresh_canvas`. |
| **Tabs** | Segmented control (HeroUI). Lazy-mount panels. |
| **Stack** | Flex `row`/`col`, gap-3. Children any component. |

---

## 7. Notes — `src/app/notes.tsx` + `src/app/note/[id].tsx`
**Purpose:** Obsidian-style markdown vault with wikilinks, backlinks, hybrid search.

### Notes list (`notes.tsx`)
```
┌─────────────────────────────────────┐
│ AppHeader ("Notes" + 🔍 search)     │
├─────────────────────────────────────┤
│ Folder Tree (collapsible)           │  ← 30% tablet / drawer phone
├─────────────────────────────────────┤
│ Note List (filtered)                │
│  ┌───────────────────────────────┐  │
│  │ NoteRow                       │  │
│  │  Title                        │  │
│  │  Folder • updated 2h ago      │  │
│  └───────────────────────────────┘  │
└─────────────────────────────────────┘
```

### Note detail (`note/[id].tsx`)
- Markdown body (ScrollView): wikilinks `[[title]]` → push `note/[id]` (create if missing), images inline, code blocks highlighted.
- Backlinks section: "Linked from:" + list.
- **Edit mode**: swap to textarea (monospace 16), save = confirm, cancel = discard. Toolbar: **B I # [] ` ``` 🔗**.
- **Search modal** (🔍): full-screen, debounced hybrid search (FTS + vector), snippet highlight, tap → open note.

---

## 8. Runs / Tasks — `src/app/run.tsx` + `src/app/runs.tsx`
**Purpose:** Durable agent runs (background, survive app close). Timeline + specialist children.

### Run list (`runs.tsx`)
- Header "Runs".
- Rows: avatar, goal (truncated), status chip + model + relative time, chevron.
- Status chips: `queued` (muted), `running` (accent pulse), `awaiting_approval` (orange), `paused` (violet), `succeeded` (green), `failed` (red), `cancelled` (muted).

### Run detail (`run/[id].tsx`)
```
┌─────────────────────────────────────┐
│ AppHeader (goal + status chip)      │
├─────────────────────────────────────┤
│ Timeline (vertical ScrollView)      │
│  ┌───────────────────────────────┐  │
│  │ [agent avatar] Plan           │  │  10:23 · 1.2s
│  │      └─ Tool: search (✓)      │  │
│  │      └─ Tool: fetch_page (✓)  │  │
│  └───────────────────────────────┘  │
│  ┌───────────────────────────────┐  │
│  │ [agent avatar] Act            │  │  10:24 · 3.1s
│  └───────────────────────────────┘  │
│                                     │
├─────────────────────────────────────┤
│ Specialists (supervisor only)       │
│  ┌───────────────────────────────┐  │
│  │ [avatar] Name · status        │  │  tap → child run detail
│  └───────────────────────────────┘  │
├─────────────────────────────────────┤
│ Final Result (markdown card)        │
└─────────────────────────────────────┘
```

- Timeline connecting line (2px `border`) left of avatar.
- Tool chips inside node: icon + name + status (✓ green, ✗ red, ⏳ amber).
- **Footer controls** (inside the timeline card): executing → spinner + "Working in background…" + **Pause** + **Cancel** (confirm sheet); `paused` → violet "Paused — stopped at its last step" + **Resume** + **Cancel**. Actions call `POST /api/runs/:id/pause|resume|cancel`; failures surface in a dismissible red error banner at the top of the scroll view (shared by approval errors).
- Polling: the detail polls every 2.5s while executing **or paused** (so a resume flips live), and stops on terminal statuses.

---

## 9. MCP Store — `src/app/mcp.tsx` + `src/app/mcp/[id].tsx`
**Purpose:** Browse, connect, manage remote MCP servers.

### Marketplace (`mcp.tsx`)
- Search bar.
- Server cards: icon 48pt, name, description (2 lines), auth badge (`None`/`API Key`/`OAuth`), free/paid badge, **Connect** / **Manage**.

### Connect flow
1. Tap **Connect** → permission sheet (tools + "Require approval" per tool).
2. **API Key** → secure text input (Expo SecureStore).
3. **OAuth** → system browser (PKCE + DCR), returns to `mcp/oauth/callback`.
4. Success → card shows **Manage**.

### Server detail (`mcp/[id].tsx`)
- Connection status (Connected / Error / Expired).
- Tool list with per-tool enable + approval toggles.
- **Setup Instructions** card (if manifest has markdown).
- **Disconnect** (destructive).

---

## 10. Memories — `src/app/memories.tsx`
**Purpose:** View / delete durable memories extracted from chats.
- Rows: content (2 lines), thread + relative time, delete button.
- Empty: "No memories yet — they appear after chats finish."

---

## 11. Settings — `src/app/settings.tsx`
| Section | Controls |
|---------|----------|
| **Account** | Email (read-only), **Sign out** (destructive). |
| **Defaults** | Default model picker, fallback order (reorderable). |
| **Memory** | List + delete (same as Memories screen). |
| **Vault** | Repo status (last sync, branch), **Sync now**. |
| **Appearance** | Theme: Light / Dark / System (segmented). |
| **About** | Version, build, GitHub / Privacy links. |

---

## 12. Auth — `src/app/auth/sign-in.tsx`
**Purpose:** Supabase Auth (GitHub OAuth only, single allowed account).
- Centered card, max-w 360: logo, **Continue with GitHub** (primary full-width), muted note "Only the allowed account can sign in."
- Post-OAuth → `/` (chat). Not allowed → 403 screen "Contact admin".

---

## 13. Threads — `src/app/threads.tsx`
**Purpose:** Thread list drawer (also from Chat header).
- Header "Threads" + **＋** new.
- Rows: agent avatar, title, model · message count · relative time, `⋯` rename/delete.
- Tap → opens Chat with `threadId`. **New** → generates UUID, navigates to Chat empty state.

---

## Reusable Component Catalog

| Component | Location | Key props |
|-----------|----------|-----------|
| `AppHeader` | `components/app-header.tsx` | `left`, `center`, `right`, `bottomInset` |
| `AgentPicker` | `components/agent-picker.tsx` | `agents`, `selectedId`, `onSelect` |
| `ModelPicker` | `components/model-picker.tsx` | `models`, `selectedId`, `onSelect` |
| `MessageBubble` | `components/message-bubble.tsx` | `role`, `parts`, `modelLabel`, `agent`, `runId`, `onViewTask` |
| `Composer` | `components/composer.tsx` | `value`, `onChangeText`, `onSend`, `attachments` |
| `AgentAvatar` | `components/agent-avatar.tsx` | `avatar`, `size` (24–96), `shape` (`circle` \| `rounded`) |
| `AgentTile` | `components/agent-tile.tsx` | `agent`, `onPress`, `isPersonal` |
| `AgentListRow` | `components/agent-list-row.tsx` | `agent`, `activeRun`, `onPress`, `onActionPress`, `isActionsOpen`, `onActionsToggle` |
| `AgentRowActions` | `components/agent-row-actions.tsx` | `isOpen`, `onClose`, `onActionPress`, `isPaused`, `notificationsEnabled`, `runActionsDisabled` |
| `AgentQuickActions` | `components/agent-quick-actions.tsx` | `agentName`, toggles + callbacks |
| `AgentDetailSection` | `components/agent-detail-section.tsx` | `label`, `children`, `action`, `secondaryAction` |
| `AgentSearch` | `components/agent-search.tsx` | `agents`, `runs`, `onSelect`, `onClose`, `isOpen` |
| `RunTaskBubble` | `components/run-task-bubble.tsx` | `run`, `detail` (live `RunDetail` for the primary active run), `onViewTask` — exports `deriveRunStep(events)` |
| `Skeleton` | HeroUI Native | `variant` (shimmer/pulse), `className` |
| `BottomSheet` | HeroUI Native | `isOpen`, `onOpenChange`, `snapPoints` |
| `SearchField` | HeroUI Native | compound: `SearchField.Input`, `ClearButton`, `SearchIcon` |

---

## Icon System
All icons are **Lucide React Native** (`lucide-react-native`) via **`src/constants/icons.ts`**:

| Constant | Value | Used in |
|----------|-------|---------|
| `SLEEP_ICON` | `Bed` | Chat header details + overview sleep tile |
| `CHAT_HEADER_ICONS.back` | `ChevronLeft` | Agent chat back |
| `CHAT_HEADER_ICONS.search` | `Search` | In-thread search |
| `CHAT_HEADER_ICONS.menu` | `Menu` | Free chat threads |
| `CHAT_HEADER_ICONS.create` | `Plus` | Free chat new |
| `CHAT_HEADER_ICONS.details` | `SLEEP_ICON` | Agent chat details |
| `SCREEN_ICONS.search` | `Search` | Agents header search |
| `SCREEN_ICONS.create` | `Plus` | New tile, empty-state CTA |
| `SCREEN_ICONS.more` | `MoreHorizontal` | Overview ⋯ menu |
| `SCREEN_ICONS.wrench` | `Wrench` | Task-bubble tool step line |
| `AGENT_LIST_ACTION_ICONS` | `Pause`/`Play`/`SkipForward`/`Bell`/`BellOff` | Row pill |
| `AGENT_OVERVIEW_ICONS` | `Pause`/`Play`/`Bell`/`BellOff`/`Bed`/`Brain`/`BrainOff` | Quick actions |

Colors from HeroUI `useThemeColor('foreground'/'accent'/'muted'/'border')` — light & dark automatically.

---

## Deep Link Cheatsheet

| Screen | Path | Params |
|--------|------|--------|
| Chat (free) | `/chat` | — |
| Chat (existing thread) | `/chat` | `threadId` |
| Chat (agent contact) | `/chat` | `agentId` — resumes the agent's most recent thread; first send creates one |
| Chat (agent + prompt) | `/chat` | `agentId`, `prompt` |
| Agents list | `/agents` | — |
| Agent overview | `/agents/[id]` | `id` (uuid) |
| Agent editor | `/agents/[id]/edit` | `id` (uuid or `new`) |
| Create agent | `/agents/new/edit` | — |
| Canvas list | `/canvas` | — |
| Canvas detail | `/canvas/[id]` | `id` |
| Note list | `/notes` | — |
| Note detail | `/note/[id]` | `id` |
| Run list | `/runs` | — |
| Run detail | `/run/[id]` | `id` |
| MCP store | `/mcp` | — |
| MCP server | `/mcp/[id]` | `id` |
| Memories | `/memories` | — |
| Settings | `/settings` | — |
| Threads | `/threads` | — |
| Sign in | `/auth/sign-in` | — |

---

## Responsive Breakpoints

| Breakpoint | Layout |
|------------|--------|
| **Phone** (< 768) | Single column. Tabs bottom. Drawers for folder tree, thread list. Canvas grid = 1 col. Modal = full-screen. |
| **Tablet** (≥ 768) | Two-column: sidebar (folders/threads/agents) + detail. Canvas grid = 2–3 cols. Modal → popover where appropriate. |
| **Desktop Web** (≥ 1024) | Persistent sidebar. Full canvas renderer width. |

---

## Motion & Interaction Checklist

- [x] Modal/sheet slide-up (300 ms, ease-out) — HeroUI `BottomSheet`
- [x] Sheet drag-to-dismiss — `@gorhom/bottom-sheet`
- [x] List item press ripple (`active:opacity-60`)
- [x] Skeleton shimmer (1.5 s loop) — HeroUI `Skeleton variant="shimmer"`
- [x] Streaming token animation (no layout shift) — `ai-sdk` + `MessageBubble`
- [x] Pull-to-refresh (Canvas, Notes, Threads) — `RefreshControl`
- [x] Live run updates in agent chat — `GET /api/runs` every 4s + `GET /api/runs/:id` every 3s (step transitions update in place)
- [x] Toast slide-in/out (top, 2.5 s) — HeroUI `Toast`

---

## Theming Tokens (NativeWind)

| Token | Light | Dark |
|-------|-------|------|
| `background` | `#FFFFFF` | `#0A0A0B` |
| `surface` | `#F4F4F5` | `#18181B` |
| `foreground` | `#18181B` | `#FAFAFA` |
| `muted` | `#71717A` | `#A1A1AA` |
| `accent` | `#2563EB` | `#3B82F6` |
| `border` | `#E4E4E7` | `#27272A` |
| `destructive` | `#DC2626` | `#EF4444` |

Used everywhere via `className="bg-background text-foreground border-border"` etc. No hardcoded hex.