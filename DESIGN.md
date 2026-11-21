# Agent — Mobile App Screen Catalog

> **Design reference** for the Expo mobile app (`apps/mobile`). Every route in `src/app/` is a screen. This document captures the current implementation state (Phases 0–7 complete, Phase 8 pending) so a designer can audit, redline, or hand off.

---

## Global Patterns

| Pattern | Details |
|---------|---------|
| **Navigation** | Expo Router v5, stack + tabs. Root `_layout.tsx` holds the tab bar (Chat, Agents, Canvas, Notes, Settings). Deep links: `chat?threadId=…`, `chat?agentId=…`, `agents/[id]`, `agents/[id]/edit`, `canvas/[id]`, `run/[id]`, `note/[id]`. |
| **Header** | `AppHeader` (translucent frosted blur with `expo-blur`, hairline border, left / center / right slots). Chat has two contexts: free chat (menu · ModelPicker capsule · new chat) and agent chat (back · avatar+name capsule · search+details). Icons are Lucide React Native via `constants/icons.ts`. |
| **Colors** | Grok Obsidian Palette: deep pitch-black background (`#000000`/`#09090b`), dark graphite surfaces (`#121215`/`#18181b`), ultra-thin translucent borders (`rgba(255, 255, 255, 0.08)` / `#27272a`), pure white text, subtle glowing indicators. |
| **Typography** | HeroUI Native `Typography` variants: `heading` (32), `title` (24), `body` (16), `body-xs` (12). Weight: `semibold` for labels, `medium` for body. |
| **Spacing** | 4 pt base. `gap-1` (4), `gap-2` (8), `gap-3` (12), `p-3` (12), `p-4` (16), `p-5` (20). |
| **Radius** | `rounded-xl` (12) for cards, `rounded-3xl` (24) for floating capsule containers, `rounded-full` for chips/pills and buttons. |
| **Shadows/Elevation** | Subtle: `shadow-sm` on cards, `shadow-lg` on modals/sheets. No heavy elevation. |
| **Motion** | Modal slide-up (300 ms), sheet drag-handle, `active:opacity-60` on pressable rows. Smooth pulse for streaming/thinking. |
| **Empty States** | Grok-inspired centered glowing geometric emblem + bold prompt *"What do you want to explore?"* + categorized capability pills (DeepSearch, Think, Quick Answer, Agent Task). |
| **Loading** | `Spinner` (HeroUI) for full-screen; inline skeleton rows for lists; glowing pulse and elapsed thinking badge for reasoning models. |
| **Error** | Inline red `Typography` under field; toast for transient errors; full-screen "Something went wrong" with retry. |
| **Accessibility** | All interactive: `accessibilityRole`, `accessibilityLabel`, `accessibilityHint`. Dynamic Type supported (system font scale). |

---

## Tab Bar (Root Layout)

**Route:** `src/app/_layout.tsx` → renders 5 tabs.

| Tab | Icon | Label | Screen |
|-----|------|-------|--------|
| 1 | `message-square` | **Chat** | `chat.tsx` |
| 2 | `bot` | **Agents** | `agents.tsx` |
| 3 | `layout-dashboard` | **Canvas** | `canvas.tsx` |
| 4 | `file-text` | **Notes** | `notes.tsx` |
| 5 | `settings` | **Settings** | `settings.tsx` |

**Visual:** iOS: native tab bar (sf-symbols). Android: bottom navigation with labels. Active tint = `accent`. Inactive = `muted`.

---

## 1. Chat — `src/app/chat.tsx`

**Purpose:** Conversational interface with the current agent. Multi-turn, streaming, attachments, model/agent switching. Also serves as the **per-agent chat** when opened with `chat?agentId=…` (or a thread that belongs to an agent).

### Layout Zones

```
┌─────────────────────────────────────┐
│ AppHeader                            │  ← sticky
│  free chat: ☰ · ModelPicker · ＋     │
│  agent ctx: ← · [avatar] Name · 🔍 🛏│
│  agent ctx adds: model picker pill   │
├─────────────────────────────────────┤
│                                     │
│         Message List (ScrollView)   │  ← auto-scroll to bottom
│  ┌───────────────────────────────┐  │
│  │ MessageBubble (user)          │  │  right-aligned bubble
│  │ MessageBubble (assistant)     │  │  avatar left + content
│  │   ├─ Markdown + syntax hl     │  │
│  │   ├─ Tool call chips          │  │
│  │   ├─ Canvas cards (inline)    │  │
│  │   ├─ Approval cards           │  │
│  │   └─ [View task] button       │  │  → run/[id] when a run is active
│  └───────────────────────────────┘  │
│                                     │
├─────────────────────────────────────┤
│ Attachment Preview Row (horizontal) │  ← only when attachments exist
├─────────────────────────────────────┤
│ Composer (grows with text)          │  ← sticky bottom
│  [+]  [text input]  [send]          │
│  AgentPicker only in free chat      │
└─────────────────────────────────────┘
```

### Header contexts

| Context | Trigger | Left | Center | Right |
|---------|---------|------|--------|-------|
| **Free chat** | default | `menu` (threads) | ModelPicker | new chat `＋` |
| **Agent chat** | `chat?agentId=…` or a thread with an agent | `chevron-left` (back) | rounded-square agent avatar + name (`body` semibold) | `search` (in-thread, TODO(backend)) + details icon (`SLEEP_ICON` constant in `constants/icons.ts`) |

In agent context the model picker moves to a small bordered pill under the header (capability preserved), and the `AgentPicker` row above the composer is hidden — the agent is fixed by the context.

### Key Components

| Component | Visual Spec |
|-----------|-------------|
| **ModelPicker** | Pill capsule button, shows current model label + chevron. Opens bottom sheet modal. |
| **AgentPicker** | Sleek horizontal pill row (free chat only) with micro-avatars. |
| **Composer** | Floating capsule container (`rounded-3xl`) with dark glass background, subtle border, embedded mode toggles (DeepSearch, Think, Task), leading `[+]` attachment button, multiline text input, and high-contrast circular send button (pure white circle with black arrow). |
| **Attachment Preview** | Horizontal scroll, 56×56 rounded-xl thumbnails. Image = preview; PDF/doc = file icon + name. Tap ⨉ to remove. |
| **MessageBubble** | User: right-aligned, compact dark graphite capsule (`#1c1c21`, `rounded-2xl`). Assistant: left, full-bleed natural text, no boxy container, with 24pt agent avatar alongside. Includes Grok-style collapsible "Thinking" accordion drawer (`✦ Thought for 4s ▾`), tool chips, sleek numbered citation pills, inline canvas cards, and action bar (Copy, Share, View task). |
| **Tool Chip** | Rounded pill, muted bg, icon + label. Collapsible: tap → expands JSON args/result. |
| **Canvas Card** | Inline 320×200 preview of canvas spec (stat/chart/markdown). Tap → pushes Canvas detail. |
| **Approval Card** | Amber border, warning icon. Shows agent name, tool, summary, args (expandable). Buttons: Approve (primary), Deny (ghost). |

### States

| State | Handling |
|-------|----------|
| **Empty** | Centered: "New chat" illustration + suggestions chips (tap → pre-fills composer). |
| **Streaming** | Assistant bubble shows token-by-token. Skeleton shimmer on code blocks. |
| **Error** | Inline red toast under composer; message shows "Retry" action. |
| **Offline** | Banner "You're offline — messages will send when reconnected". |

---

## 2. Agents — `src/app/agents.tsx`

**Purpose:** Browse, search and manage agents; quick access to each agent's chat. Each agent = persona + model + tools + MCP servers.

### Layout

```
┌─────────────────────────────────────┐
│ [User Avatar]              (🔍) (＋)│  ← Profile avatar left, circular search & add buttons right
├─────────────────────────────────────┤
│   (🟣 68)      (💧 68)      (☁️ 68)   │  ← Top quick-access pinned creature avatars
│ Chief of Staff    EA     Inbox Mgr  │     centered labels below
├─────────────────────────────────────┤
│ [Teal Sq] Sales Outbound    8:41 AM │  ← Clean contact conversation rows
│           Outreach drafts queued…   │     organic creature avatar (48pt) + name +
│ [Brwn O]  Talent Scout      8:22 AM │     activity preview + relative timestamp
│           Shortlist of 6 candidates…│
│ [Orng E]  Growth Marketer   8:05 AM │
│           A/B copy variants ready…  │
│ [Red P]   Customer Support Yesterday│
│           12 tickets resolved…      │
│ [Pink T]  Expense Manager  Yesterday│
│           Receipts coded — one needs│
│ [Purp S]  Invoice Collector  Tuesday│
│           Pulled 9 invoices from…   │
│ [Grn C]   Apartment Hunter   Tuesday│
│           3 new listings match…     │
└─────────────────────────────────────┘
```

### Top Bar & Quick-Access Row

- **Top Bar**: User profile avatar on left, circular Search (`🔍`) and Create (`+`) action buttons on right.
- **Top Pinned Creatures**: 3 prominent organic creature avatars (`AgentTile`, 68×68pt) evenly spaced with agent titles centered below.
- **Creature Avatars**: Organic SVG shapes (circle, droplet, cloud, squircle, egg, pill, triangle) featuring distinctive angled character eye-markings and accent badges (droplets, dots).

### Contact List Rows

- Full-bleed vertical list with clean spacing.
- Each `AgentListRow`: 48pt creature avatar, agent name in bold (`text-[16px]`), activity/message preview (`text-[14px] text-zinc-500`), and clean relative timestamp (`8:41 AM`, `Yesterday`, `Tuesday`).
- **Tap →** opens that agent's chat: `/chat?agentId=…`.
- **Swipe left / Long press →** reveals row actions: pause/resume (server-backed, flips from the active run's `paused` status), skip (`TODO(backend)`), notifications (local mute).

### States

| State | Handling |
|-------|----------|
| **Loading** | `Skeleton` (shimmer) tiles in the quick-access row + 5 skeleton rows in the panel. |
| **Empty** | "Create your first agent" CTA → `/agents/new/edit`. |
| **Error** | Inline error message + **Retry** button. |
| **Search** | HeroUI `BottomSheet` + `SearchField`; filters by name, role or active-run goal; result rows show avatar + name + activity. |

---

## 3. Agent Overview — `src/app/agents/[id].tsx` + Editor `agents/[id]/edit.tsx`

**Purpose:** `agents/[id]` is the agent **overview** (identity, quick actions, info, tools, danger zone). The full configuration form lives at `agents/[id]/edit.tsx` (create flow: `agents/new` redirects to `agents/new/edit`).

### Overview layout (`agents/[id].tsx`)

```
┌─────────────────────────────────────┐
│ AppHeader (← · Name · ⋯)            │
├─────────────────────────────────────┤
│          (breathing room)           │
│           [ avatar 96 ]             │  ← centered
│            Agent 1 (h2)             │
│        [ Active: goal chip ]        │  ← only while a run is active
├─────────────────────────────────────┤
│ ┌─ surface sheet, rounded-t-2xl ──┐ │  ~2/3 of the screen
│ │ ┌─────┐┌─────┐┌─────┐┌─────┐   │ │  quick actions (4 tiles)
│ │ │⏸pause││🔔  ││🛌  ││🧠  │   │ │  rounded-xl, border=accent when on
│ │ └─────┘└─────┘└─────┘└─────┘   │ │
│ │ AGENT INFO            [Edit]    │ │  name · role · model · supervisor
│ │ ─────────────────────────────── │ │
│ │ TOOLS      [Edit tools][Add int]│ │  toolCount summary chip
│ │ DANGER ZONE  [Duplicate][Delete]│ │  destructive + confirmation
│ └─────────────────────────────────┘ │
└─────────────────────────────────────┘
```

- **Quick actions** (`AgentQuickActions`): pause/resume (server-backed per active run; tile disabled when there is no active run) · notifications (`TODO(backend)`, local) · sleep/wake (`SLEEP_ICON`, same glyph as the chat header details button; `POST /api/agents/:id/sleep|wake` — pauses all of the agent's tasks and blocks new ones) · memory on/off (`brain`/`brain-off`, `TODO(backend)` local). Each is an `accessibilityRole="switch"` tile with active border (`accent`), icon and caption; disabled tiles dim to `opacity-40` with `accessibilityState.disabled`. Sleep state comes from `agent.isSleeping` and also shows a `💤 Sleeping` chip under the name.
- **Tools sheet**: `Edit tools` opens a HeroUI `BottomSheet` summarising enabled tools (per-tool toggles live on each MCP integration's screen — `TODO(backend)` for per-agent tool prefs); **Add integrations** routes to the MCP Store (`mcp.tsx`).
- **Danger zone**: Duplicate (`TODO(backend)`) and Delete (confirmation dialog → `DELETE /api/agents/:id`) — moved here from the list's long-press menu. The `⋯` header menu repeats Edit/Duplicate/Delete as a fallback.

### Editor (`agents/[id]/edit.tsx`)

Unchanged from the previous phase — the full form moved here without rewriting it.

### Sections (ScrollView)

| Section | Fields | Visual |
|---------|--------|--------|
| **Identity** | Avatar picker (Emoji/Icon/Upload tabs + 8 color swatches), Name (required), Role (optional) | Avatar large (56) top-center. Name input full-width. Role placeholder "e.g. Senior Researcher". |
| **Model** | Primary model picker (ModelPicker), Fallback order (chips, max 5) | Primary = large pill. Fallbacks = numbered chips; tap to add/remove. |
| **Supervisor** | Toggle "This agent orchestrates specialists". When on: hides Model/Tools (inherited from children). | Card with switch + helper text "Supervisors delegate to other agents". |
| **Instructions** | Instructions textarea (maps to `system_prompt`) | Multiline input. |
| **Danger Zone** | Delete agent (red, confirmation dialog). | Separated, red button. |

### Avatar Picker Modal

Three tabs: **Emoji** (grid 4×4), **Icon** (glyph grid), **Upload** (signed URL → Supabase Storage `avatars` bucket). Color swatch row (8) below emoji/icon.

---

## 4. Canvas List — `src/app/canvas.tsx`

**Purpose:** Gallery of saved canvases (dashboards/reports).

### Layout

```
┌─────────────────────────────────────┐
│ AppHeader ("Canvas" + [+] create)   │
├─────────────────────────────────────┤
│  ┌─────────┐ ┌─────────┐ ┌─────────┐ │  ← 2-col grid (phone) / 3-col (tablet)
│  │ Canvas  │ │ Canvas  │ │ Canvas  │ │
│  │ Card    │ │ Card    │ │ Card    │ │
│  └─────────┘ └─────────┘ └─────────┘ │
└─────────────────────────────────────┘
```

### Canvas Card

- **Aspect:** 16:10 preview (rendered from spec — first component snapshot or placeholder).
- **Overlay:** Title (truncated 2 lines), updated-at (relative time).
- **Tap →** `canvas/[id].tsx` (detail). Long press → duplicate / delete.

### Empty

"No canvases yet" + "Create dashboard" CTA.

---

## 5. Canvas Detail — `src/app/canvas/[id].tsx`

**Purpose:** Full-screen native rendering of a canvas spec. Pull-to-refresh re-runs data sources.

### Layout

```
┌─────────────────────────────────────┐
│ AppHeader (title + [⋯] menu)        │  ← sticky
├─────────────────────────────────────┤
│                                     │
│  Canvas Renderer (ScrollView)       │  ← components flow vertically
│  ┌───────────────────────────────┐  │
│  │ Stat / Metric                 │  │
│  │ Chart (line/bar/pie)          │  │
│  │ Table (sticky header, sort)   │  │
│  │ Markdown                      │  │
│  │ Image                         │  │
│  │ Button (action)               │  │
│  │ Tabs                          │  │
│  │ Stack (h/v)                   │  │
│  └───────────────────────────────┘  │
│                                     │
└─────────────────────────────────────┘
```

### Component Visuals

| Component | Spec |
|-----------|------|
| **Stat** | Large number (heading), label (muted), trend sparkline optional. Card `p-4`. |
| **Chart** | Reanimated/Victory Native. Legend bottom. Tooltip on press. Responsive width. |
| **Table** | Sticky header, horizontal scroll if needed. Row hover (web) / press highlight (native). |
| **Markdown** | `react-native-markdown-render`. Links open in-app browser. |
| **Image** | Full-width, aspect preserved. Tap → fullscreen zoom. |
| **Button** | Accent primary. `onPress` → `open_url` / `run_agent` / `refresh_canvas`. |
| **Tabs** | Segmented control (HeroUI). Lazy-mount panels. |
| **Stack** | Flex direction `row`/`col`, gap-3. Children any component. |

### Header Menu (⋯)

- **Refresh** — re-runs data sources (POST `/api/canvases/:id/refresh`).
- **Ask about this** — opens Chat with canvas as context.
- **Edit spec** — JSON editor modal (dev only).
- **Delete** — confirm → DELETE.

---

## 6. Notes — `src/app/notes.tsx` + `src/app/note.tsx`

**Purpose:** Obsidian-style markdown vault with wikilinks, backlinks, hybrid search.

### Notes List (`notes.tsx`)

```
┌─────────────────────────────────────┐
│ AppHeader ("Notes" + [🔍] search)   │
├─────────────────────────────────────┤
│ Folder Tree (collapsible)           │  ← left 30% on tablet, modal drawer on phone
├─────────────────────────────────────┤
│ Note List (filtered)                │
│  ┌───────────────────────────────┐  │
│  │ NoteRow                       │  │
│  │  Title                        │  │
│  │  Folder • updated 2h ago      │  │
│  └───────────────────────────────┘  │
└─────────────────────────────────────┘
```

### Note Detail (`note/[id].tsx`)

```
┌─────────────────────────────────────┐
│ AppHeader (title + [⋯] edit/delete) │
├─────────────────────────────────────┤
│                                     │
│ Markdown Body (ScrollView)          │
│  - Wikilinks [[title]] → tap pushes │
│    note/[id] (or creates new)       │
│  - Images render inline             │
│  - Code blocks syntax highlighted   │
│                                     │
├─────────────────────────────────────┤
│ Backlinks Section                   │
│  "Linked from:" + list of notes     │
└─────────────────────────────────────┘
```

### Edit Mode

- Swap to textarea (monospace, 16). Save = confirm dialog. Cancel = discard.
- Toolbar: **B** **I** `#` `[]` `` ` `` ````` `🔗` (insert wikilink picker).

### Search Modal (🔍)

- Full-screen. Debounced query → hybrid search (FTS + vector). Results = list with snippet highlight. Tap → opens note.

---

## 7. Runs / Tasks — `src/app/run.tsx` + `src/app/runs.tsx`

**Purpose:** Durable agent runs (background, survive app close). Timeline + specialist children.

### Run List (`runs.tsx`)

```
┌─────────────────────────────────────┐
│ AppHeader ("Runs")                  │
├─────────────────────────────────────┤
│  ┌───────────────────────────────┐  │
│  │ RunRow                        │  │
│  │  [avatar] Goal (truncated)    │  │
│  │  status • model • 2m ago      │  │
│  │  [chevron]                    │  │
│  └───────────────────────────────┘  │
└─────────────────────────────────────┘
```

**Status chips:** `queued` (muted), `running` (accent pulse), `succeeded` (green), `failed` (red), `cancelled` (muted).

### Run Detail (`run/[id].tsx`)

```
┌─────────────────────────────────────┐
│ AppHeader (goal + status chip)      │
├─────────────────────────────────────┤
│                                     │
│ Timeline (vertical, ScrollView)     │
│  ┌───────────────────────────────┐  │
│  │ Node Event                    │  │
│  │  [agent avatar] Plan          │  │
│  │  10:23 AM  •  1.2s            │  │
│  │  └─ Tool: search (✓)          │  │
│  │  └─ Tool: fetch_page (✓)      │  │
│  └───────────────────────────────┘  │
│  ┌───────────────────────────────┐  │
│  │ Node Event                    │  │
│  │  [agent avatar] Act           │  │
│  │  10:24 AM  •  3.1s            │  │
│  └───────────────────────────────┘  │
│                                     │
├─────────────────────────────────────┤
│ Specialists Section (supervisor only)│
│  ┌───────────────────────────────┐  │
│  │ Specialist Card               │  │
│  │  [avatar] Name • status       │  │
│  │  Tap → child run detail       │  │
│  └───────────────────────────────┘  │
├─────────────────────────────────────┤
│ Final Result (markdown card)        │
└─────────────────────────────────────┘
```

**Visual language:**
- Timeline: connecting line left of avatar (2px, `border` color).
- Tool chips inside node: icon + name + status (✓ green, ✗ red, ⏳ amber).
- Specialist cards show child run status inline.

---

## 8. MCP Store — `src/app/mcp.tsx` + `src/app/mcp/[id].tsx`

**Purpose:** Browse, connect, and manage remote MCP servers.

### Marketplace List (`mcp.tsx`)

```
┌─────────────────────────────────────┐
│ AppHeader ("MCP Store")             │
├─────────────────────────────────────┤
│ Search Bar                          │
├─────────────────────────────────────┤
│  ┌───────────────────────────────┐  │
│  │ Server Card                   │  │
│  │  [icon 48] Name               │  │
│  │  Description (2 lines)        │  │
│  │  Auth: [badge]  Free: [badge] │  │
│  │  [Connect] / [Manage]         │  │
│  └───────────────────────────────┘  │
└─────────────────────────────────────┘
```

**Auth badges:** `None` (gray), `API Key` (blue), `OAuth` (purple). **Free badge:** green "Free" / gray "Paid".

### Connect Flow

1. Tap **Connect** → permission sheet (list of tools, each with "Require approval" default from server manifest).
2. **API Key** → secure text input (Expo SecureStore).
3. **OAuth** → opens system browser (PKCE + DCR). Returns to `mcp/oauth/callback`.
4. Success → server card shows **Manage** (opens detail).

### Server Detail (`mcp/[id].tsx`)

- Connection status (Connected / Error / Expired).
- Tool list with per-tool enable + approval toggles.
- **Setup Instructions** card (if listing has `instructions` markdown).
- Disconnect button (destructive).

---

## 9. Memories — `src/app/memories.tsx`

**Purpose:** View / delete durable memories extracted from chats.

### Layout

```
┌─────────────────────────────────────┐
│ AppHeader ("Memories")              │
├─────────────────────────────────────┤
│  ┌───────────────────────────────┐  │
│  │ MemoryRow                     │  │
│  │  Content (2 lines)            │  │
│  │  Thread • 3 days ago          │  │
│  │  [🗑] delete                  │  │
│  └───────────────────────────────┘  │
└─────────────────────────────────────┘
```

**Empty:** "No memories yet — they appear after chats finish."

---

## 10. Settings — `src/app/settings.tsx`

**Purpose:** Account, defaults, theme, vault status.

### Sections

| Section | Controls |
|---------|----------|
| **Account** | Email (read-only), **Sign out** (destructive button). |
| **Defaults** | Default model picker, Fallback order (reorderable). |
| **Memory** | List + delete (same as Memories screen). |
| **Vault** | Repo status (last sync, branch), **Sync now** button. |
| **Appearance** | Theme: Light / Dark / System (segmented). |
| **About** | Version, build, links to GitHub / Privacy. |

---

## 11. Auth — `src/app/auth/sign-in.tsx`

**Purpose:** Supabase Auth (GitHub OAuth only, single allowed account).

### Layout

```
┌─────────────────────────────────────┐
│         (centered, max-w 360)       │
│  ┌───────────────────────────────┐  │
│  │ Logo / App Name               │  │
│  │ "Agent"                       │  │
│  ├───────────────────────────────┤  │
│  │ [GitHub] Continue with GitHub │  │  ← primary, full-width
│  │                               │  │
│  │ "Only the allowed account     │  │
│  │  can sign in." (muted, xs)    │  │
│  └───────────────────────────────┘  │
└─────────────────────────────────────┘
```

**Post-OAuth:** Redirects to `/` (chat). If not allowed → 403 screen with "Contact admin".

---

## 12. Threads — `src/app/threads.tsx`

**Purpose:** Thread list drawer (also accessible from Chat header).

### Layout

```
┌─────────────────────────────────────┐
│ AppHeader ("Threads" + [+] new)     │
├─────────────────────────────────────┤
│  ┌───────────────────────────────┐  │
│  │ ThreadRow                     │  │
│  │  [agent avatar] Title         │  │
│  │  model • 3 messages • 2h ago  │  │
│  │  [⋯] rename / delete          │  │
│  └───────────────────────────────┘  │
└─────────────────────────────────────┘
```

**Tap →** opens Chat with `threadId`. **New** → generates UUID, navigates to Chat empty state.

---

## Component Catalog (Reusable)

| Component | Location | Props / Variants |
|-----------|----------|------------------|
| `AppHeader` | `src/components/app-header.tsx` | `left`, `center`, `right`, `bottomInset` |
| `AgentPicker` | `src/components/agent-picker.tsx` | `agents`, `selectedId`, `onSelect` |
| `ModelPicker` | `src/components/model-picker.tsx` | `models`, `selectedId`, `onSelect` |
| `ModelBadges` | `src/components/model-picker.tsx` | `model` (shows provider + capability pills) |
| `MessageBubble` | `src/components/message-bubble.tsx` | `role`, `parts`, `modelLabel`, `agent`, `runId`, `onViewTask` |
| `Composer` | `src/components/composer.tsx` | `value`, `onChangeText`, `onSend`, `attachments`, `onAttach*` |
| `AgentAvatar` | `src/components/agent-avatar.tsx` | `avatar`, `size` (24–96), `shape` (`circle` \| `rounded`) |
| `AgentTile` | `src/components/agent-tile.tsx` | `agent`, `onPress`, `isPersonal` — 76pt quick-access tile |
| `AgentListRow` | `src/components/agent-list-row.tsx` | `agent`, `activeRun`, `onPress`, `onActionPress`, `isActionsOpen`, `onActionsToggle` |
| `AgentRowActions` | `src/components/agent-row-actions.tsx` | `isOpen`, `onClose`, `onActionPress` (`pause` \| `skip` \| `notify`), `disabled` |
| `AgentQuickActions` | `src/components/agent-quick-actions.tsx` | `agentName`, `isPaused`, `pauseDisabled`, `notificationsEnabled`, `isSleeping`, `memoryEnabled` + toggles |
| `AgentDetailSection` | `src/components/agent-detail-section.tsx` | `label`, `children`, `action`, `secondaryAction` |
| `AgentSearch` | `src/components/agent-search.tsx` | `agents`, `runs`, `onSelect`, `onClose`, `isOpen` (HeroUI BottomSheet + SearchField) |
| `SLEEP_ICON` / `CHAT_HEADER_ICONS` / `SCREEN_ICONS` | `src/constants/icons.ts` | centralised Lucide icon constants (swap one to change both screens) |
| `CanvasRenderer` | `src/components/canvas/` | `spec` (zod-validated) |
| `StatCard`, `ChartCard`, `TableCard`, `MarkdownCard`, `ImageCard`, `ButtonCard`, `TabsCard`, `StackCard` | `src/components/canvas/` | Component-specific props |
| `ApprovalCard` | `src/components/approval-card.tsx` | `approval`, `onApprove`, `onDeny` |

---

## Icon Set

- **Primary:** Lucide React Native (`lucide-react-native`, tree-shaken). Used everywhere: headers, row actions, quick actions, empty states. Icon constants live in `src/constants/icons.ts`; colors come from HeroUI `useThemeColor` so light and dark both work.
- **Provider logos:** Custom SVG in `assets/provider-logos/` (google, groq, openrouter, mistral, deepseek, huggingface, cohere). Shown in model picker + dashboard.

---

## Responsive Breakpoints

| Breakpoint | Layout Changes |
|------------|----------------|
| **Phone** (< 768) | Single column. Tabs bottom. Drawers for folder tree, thread list. Canvas grid = 1 col. |
| **Tablet** (≥ 768) | Two-column: sidebar (folders/threads/agents) + detail. Canvas grid = 2–3 cols. Modal → popover. |
| **Desktop Web** (≥ 1024) | Persistent sidebar. Full canvas renderer width. |

---

## Motion & Interaction Checklist

- [ ] Modal slide-up (300 ms, ease-out)
- [ ] Sheet drag-to-dismiss
- [ ] List item press ripple (`active:opacity-60`)
- [ ] Skeleton shimmer (1.5s loop)
- [ ] Streaming token animation (no layout shift)
- [ ] Pull-to-refresh (canvas, notes, threads)
- [ ] Reorder drag (fallback models, specialist priority)
- [ ] Toast slide-in/out (top, 2.5s)

---

## Dark Mode Tokens

| Token | Light | Dark |
|-------|-------|------|
| `background` | `#FFFFFF` | `#0A0A0B` |
| `surface` | `#F4F4F5` | `#18181B` |
| `foreground` | `#18181B` | `#FAFAFA` |
| `muted` | `#71717A` | `#A1A1AA` |
| `accent` | `#2563EB` | `#3B82F6` |
| `border` | `#E4E4E7` | `#27272A` |
| `destructive` | `#DC2626` | `#EF4444` |

---

## Open Design Questions (Phase 8+)

| Feature | Decision Needed |
|---------|-----------------|
| **Website Monitors** | Card layout in Canvas? Separate "Monitors" tab? Notification design? |
| **Image Generation** | Inline in Chat composer? Separate "Create" tab? Gallery view? |
| **Voice** | Push-to-talk vs always-listening? Waveform visual? Transcript bubbles? |
| **Code Sandbox** | Terminal UI? File tree? Output preview? |
| **X Data** | Tweet card design? Thread view? Search composer? |

---

*Generated from `docs/spec/UI_UX_SPEC.md` + live code audit (2026-11-20). Screens reflect Phases 0–7 implementation.*