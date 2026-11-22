# Canvas & Chat Systems — Developer Reference

> **Audience:** A developer who wants to debug canvas rendering, implement canvas inline in chat message bubbles, or add canvas display to the web dashboard.

---

## Table of Contents

1. [Overview](#1-overview)
2. [Canvas System](#2-canvas-system)
   - 2.1 [Shared Schema](#21-shared-schema-packagesshardsrccanvasts)
   - 2.2 [API Routes](#22-api-routes-appsapiappapicanvases)
   - 2.3 [Server Library](#23-server-library-appsapilibcanvasests)
   - 2.4 [Agent Tools](#24-agent-tools-appsapilibagenttools-ts)
   - 2.5 [Mobile Client Library](#25-mobile-client-library-appsmobilesrclibcanvasests)
   - 2.6 [Mobile Renderer](#26-mobile-renderer-appsmobilesrccomponentscanvas-renderertsx)
   - 2.7 [Mobile Screens](#27-mobile-screens)
   - 2.8 [Background Refresh (Inngest)](#28-background-refresh-inngest)
3. [Chat System](#3-chat-system)
   - 3.1 [Shared Schema](#31-shared-schema-packagesshardsrcchats)
   - 3.2 [Chat API Route](#32-chat-api-route-appsapiappapicharoute-ts)
   - 3.3 [Custom Stream Data Parts](#33-custom-stream-data-parts)
   - 3.4 [Threads API](#34-threads-api)
   - 3.5 [Mobile Chat Screen](#35-mobile-chat-screen)
   - 3.6 [Mobile MessageBubble](#36-mobile-messagebubble-appsmobilesrccomponentsmessage-bubbletsx)
4. [Integrating Canvas Inline in Chat](#4-integrating-canvas-inline-in-chat--implementation-guide)
5. [Integrating Canvas in the Web Dashboard](#5-integrating-canvas-in-the-web-dashboard)
6. [Debugging Reference](#6-debugging-reference)

---

## 1. Overview

The app has two independent but connected systems:

| System | What it does | Where it lives |
|---|---|---|
| **Canvas** | JSON-spec–driven data display: charts, tables, stats, markdown, lists, images, buttons, tabs. Created by agents via tools, refreshed by Inngest. | `packages/shared/src/canvas.ts`, `apps/api/lib/canvases.ts`, `apps/api/app/api/canvases/`, `apps/mobile/src/components/canvas-renderer.tsx` |
| **Chat** | Real-time streaming chat with agents; supports tool calls, approvals, quick-reply options, and canvas hand-off via a custom stream data part. | `packages/shared/src/chat.ts`, `apps/api/app/api/chat/`, `apps/mobile/src/app/(tabs)/chat.tsx`, `apps/mobile/src/components/message-bubble.tsx` |

**How they connect:** When an agent runs the `render_canvas` tool, the chat route emits a `data-canvas` stream part containing the `canvasId`. Currently the mobile message-bubble renderer does **not** parse this part inline — the canvas is only accessible from the standalone `/canvas/:id` screen. See [§4](#4-integrating-canvas-inline-in-chat--implementation-guide) for how to close that gap.

---

## 2. Canvas System

### 2.1 Shared Schema (`packages/shared/src/canvas.ts`)

#### `CanvasSpec`

```ts
type CanvasSpec = {
  title?: string;
  root: CanvasComponent;
  dataSources?: DataSource[];
};
```

#### `CanvasComponent` — 9 node types

| Node type | Key props | Notes |
|---|---|---|
| `stat` | `label`, `value`, `unit?`, `trend?` | Large number card; trend shows delta. |
| `chart` | `chartType` (`line`\|`bar`\|`pie`), `labels[]`, `datasets[]` | Rendered with SVG via `react-native-svg`. |
| `table` | `columns[]`, `rows[][]` | Horizontal scroll, sticky first column. |
| `list` | `items[]` (`{ label, value?, href? }`) | Grouped rows with optional link. |
| `markdown` | `content` | Rendered with standard markdown parser. |
| `image` | `src`, `alt?`, `aspectRatio?` | Rendered via `expo-image`. |
| `button` | `label`, `action` | Triggers a `CanvasAction`. |
| `tabs` | `tabs[]` (`{ label, content: CanvasComponent }`) | State-driven tab switcher. |
| `stack` | `direction` (`row`\|`column`), `children[]` | Layout container; supports recursive nesting. |

Every node may optionally carry a `source` field (a `DataSource` kind) to mark it as a **bound component** that is rewritten on refresh.

#### `CanvasAction` (enum)

```ts
type CanvasAction =
  | { type: 'send_prompt'; prompt: string }
  | { type: 'refresh' }
  | { type: 'open_note'; noteId: string };
```

Actions are handled client-side by `CanvasActionHandler`.

#### `DataSource` kinds

```
web_search | search_notes | recall_memory | list_tasks | list_events
```

#### Validation

```ts
validateCanvasSpec(spec: unknown): CanvasSpec  // throws ZodError on failure
```

Hard limits enforced at validation time:

| Limit | Value |
|---|---|
| `MAX_SPEC_BYTES` | 100,000 (100 KB) |
| `MAX_CANVAS_DEPTH` | 4 (nesting levels) |

> [!IMPORTANT]
> Both `render_canvas` and `update_canvas` agent tools call `validateCanvasSpec` before writing to the database. A spec that exceeds depth or size limits will cause the tool to return an error — the agent will see it in the tool result.

---

### 2.2 API Routes (`apps/api/app/api/canvases/`)

All routes require `Authorization: Bearer <Supabase JWT>`. Canvas rows are always scoped to `user_id`.

#### `GET /api/canvases`

Returns `CanvasSummary[]` — `{ id, title, version, updatedAt, createdByRun }`. Used by the mobile canvas list screen.

#### `POST /api/canvases`

```jsonc
// Request body
{ "title": "My Canvas", "spec": { "root": { "type": "markdown", "content": "Hello" } } }

// Response
{ "id": "<uuid>", "title": "My Canvas", "spec": { ... }, "version": 1 }
```

Spec is Zod-validated server-side. Returns `400` on `invalid_spec`.

#### `GET /api/canvases/:id`

Returns full canvas: `{ id, title, spec, version, createdByRun, updatedAt }`.

#### `PUT /api/canvases/:id`

Replaces the spec entirely. Spec is validated. `version` increments by 1.

#### `DELETE /api/canvases/:id`

Deletes the canvas row. Returns `204`.

#### `POST /api/canvases/:id/refresh`

Re-runs all bound data sources without calling the LLM. Returns updated canvas. See [§2.3](#23-server-library-appsapilibcanvasests) for refresh semantics.

---

### 2.3 Server Library (`apps/api/lib/canvases.ts`)

#### Functions

| Function | Description |
|---|---|
| `createCanvas(userId, title, spec, createdByRun?)` | Inserts canvas row; returns full canvas. |
| `getCanvas(userId, id)` | Fetches single canvas; throws `not_found` if wrong user. |
| `listCanvases(userId)` | Returns `CanvasSummary[]` ordered by `updated_at` desc. |
| `updateCanvasSpec(userId, id, spec)` | Validates spec, replaces, increments `version`. |
| `deleteCanvas(userId, id)` | Deletes by `id` + `user_id`. |
| `refreshCanvas(userId, id)` | Re-runs data sources and rewrites bound components. |

#### `rewriteBoundComponents(root, dataSources, results)` (internal)

Walks the entire spec tree recursively. For each component that has a `source` field matching a data-source kind:

- **`markdown` nodes:** replace `content` with the query result text.
- **`list` nodes:** replace `items[]` with the query result rows.
- **`stat`, `chart`, `table` nodes:** ⚠️ v1 does **not** rewrite these — existing data is preserved. This is a known limitation.

> [!NOTE]
> To add support for `stat`/`chart`/`table` refresh in a future version, extend `rewriteBoundComponents` with result-to-data-shape mappers for those types.

---

### 2.4 Agent Tools (`apps/api/lib/agent/tools.ts`)

Two canvas tools are exposed to every agent:

#### `render_canvas`

```ts
// Input
{ title: string; spec: CanvasSpec }

// Output (returned to agent in tool result)
{ canvasId: string; title: string; version: number }
```

After the tool executes, the **chat route** emits a `data-canvas` stream part to the client:

```jsonc
// Stream part emitted on the AI SDK UI message stream
{ "type": "data-canvas", "canvasId": "<uuid>" }
```

The `createdByRun` field on the canvas row is set to the current `run_id`, linking the canvas to the agent run that created it.

#### `update_canvas`

```ts
// Input
{ id: string; spec: CanvasSpec }

// Output
{ canvasId: string; version: number }
```

Replaces the spec of an existing canvas. Increments `version`. Validates before writing.

> [!CAUTION]
> `update_canvas` does a full spec replacement, not a patch. The agent must supply the complete new spec, not just the changed nodes.

---

### 2.5 Mobile Client Library (`apps/mobile/src/lib/canvases.ts`)

All functions use `authedFetch` (adds the Supabase session JWT automatically).

| Function | Maps to |
|---|---|
| `fetchCanvases()` | `GET /api/canvases` |
| `fetchCanvas(id)` | `GET /api/canvases/:id` |
| `refreshCanvas(id)` | `POST /api/canvases/:id/refresh` |
| `updateCanvasSpec(id, spec)` | `PUT /api/canvases/:id` |
| `deleteCanvas(id)` | `DELETE /api/canvases/:id` |

---

### 2.6 Mobile Renderer (`apps/mobile/src/components/canvas-renderer.tsx`)

#### Exports

```ts
// Props
type CanvasActionHandler = (action: CanvasAction) => void;

// Renders a single node (recursive)
<CanvasNode node={CanvasComponent} onAction={CanvasActionHandler} />

// Renders the full canvas (starts at spec.root)
<CanvasView spec={CanvasSpec} onAction={CanvasActionHandler} />
```

#### Node rendering details

| Node | Implementation notes |
|---|---|
| `stat` | Large value text + label + optional trend badge. |
| `chart` | SVG via `react-native-svg`. Line = `<Polyline>`. Bar = `<Rect>` per value. Pie = `<Circle>` arcs. |
| `table` | `<ScrollView horizontal>`. First column uses `position: sticky` via fixed-width trick. |
| `list` | Maps `items[]` to `GroupedRow` components. Href items render with a chevron and call `onAction({ type: 'open_note', noteId: href })`. |
| `markdown` | Standard markdown parser (renders inside a `<Text>` tree). |
| `image` | `expo-image` with `contentFit: 'cover'` and `aspectRatio`. |
| `button` | `PillButton` themed component; calls `onAction` with the button's `action`. |
| `tabs` | Local `useState` for active tab index; renders child `CanvasNode` for active tab. |
| `stack` | `<View style={{ flexDirection: direction }}>` wrapping child `CanvasNode` renders. |
| **unknown** | Muted fallback card: `"Unknown node: <type>"` — never crashes. |

> [!TIP]
> The fallback for unknown node types means you can ship new node types in the spec schema before the renderer supports them — old clients degrade gracefully.

---

### 2.7 Mobile Screens

#### Canvas List — `apps/mobile/src/app/canvas.tsx`

- Fetches `fetchCanvases()` on mount.
- Searchable by title.
- Each card shows title, `v{version}` badge, and `updatedAt`.
- Tap → navigates to `/canvas/:id`.

#### Canvas Detail — `apps/mobile/src/app/canvas/[id].tsx`

- Fetches `fetchCanvas(id)` on mount.
- Renders `<CanvasView spec={canvas.spec} onAction={handleAction} />`.
- Pull-to-refresh calls `refreshCanvas(id)` then re-fetches.
- `handleAction` wires up:
  - `send_prompt` → navigates to chat tab with pre-filled prompt.
  - `refresh` → triggers `refreshCanvas`.
  - `open_note` → navigates to note detail.

---

### 2.8 Background Refresh (Inngest)

Two triggers run canvas refresh without an LLM call:

| Trigger | Event / Schedule | Handler |
|---|---|---|
| On-demand | `canvas/refresh.requested` Inngest event | Refresh function calls `refreshCanvas(userId, canvasId)` |
| Daily cron | Inngest cron schedule | Iterates all user canvases and refreshes each |

To manually trigger a refresh for testing:

```bash
# Via API (authenticated)
curl -X POST https://<host>/api/canvases/<id>/refresh \
  -H "Authorization: Bearer <JWT>"

# Via Inngest Dev Server event send
{ "name": "canvas/refresh.requested", "data": { "userId": "...", "canvasId": "..." } }
```

---

## 3. Chat System

### 3.1 Shared Schema (`packages/shared/src/chat.ts`)

#### `ChatRequest`

```ts
type ChatRequest = {
  threadId?: string;      // Client-generated UUID; create new thread if absent
  agentId?: string;       // Scope the agent for this message
  messages: ChatMessage[];
  model?: string;         // Override model; falls back to thread model then agent default
  attachments?: AttachmentRef[];
  tz?: string;            // Client timezone (IANA string)
};
```

#### `Thread`

```ts
type Thread = {
  id: string;
  title: string;
  model: string;
  agent_id?: string;
  agent?: AgentSummary;
  group_id?: string;
  group?: GroupSummary;
  created_at: string;
  updated_at: string;
};
```

#### `StoredMessage`

```ts
type StoredMessage = {
  id: string;
  thread_id: string;
  role: 'user' | 'assistant' | 'tool';
  model?: string;
  parts: MessagePart[];
  from_agent_id?: string;    // Set when message originated from an agent
  to_agent_id?: string;      // Set for handoffs
  handoff?: boolean;         // True when this message is a handoff to another agent
  run_id?: string;           // Links message to an agent run
};
```

#### `AttachmentRef`

```ts
type AttachmentRef = {
  id: string;        // Storage object ID
  mediaType: string; // MIME type (image/*, application/pdf)
  name?: string;
};
```

---

### 3.2 Chat API Route (`apps/api/app/api/chat/route.ts`)

**`POST /api/chat`** — full flow:

```
1. Parse & validate ChatRequest (Zod)
2. Resolve agent (agentId → DB lookup; 404 if not found)
3. Agent scope check: if thread exists and thread.agent_id ≠ agentId → 409 agent_mismatch
4. Group thread check: if thread.group_id is set → 409 group_thread (use group chat endpoint instead)
5. Create thread if threadId not supplied (or first message in new UUID thread)
6. Load attachments from storage, detect vision vs PDF
7. Build system prompt (agent persona + tool definitions)
8. Select model (request.model → thread.model → agent.model → env default)
9. Stream response via AI SDK UI message stream
10. During streaming: execute tool calls, emit data parts (run-event, approval, canvas, routine-proposal)
11. Persist assistant message to DB after stream ends
```

**Error codes:**

| HTTP | Code | Cause |
|---|---|---|
| 400 | `invalid_request` | Zod parse failure |
| 404 | `agent_not_found` | `agentId` not in DB |
| 409 | `agent_mismatch` | Thread belongs to a different agent |
| 409 | `group_thread` | Thread is a group thread |

---

### 3.3 Custom Stream Data Parts

The AI SDK UI message stream supports typed `data` parts in addition to text. The chat route emits these custom parts during streaming:

| Part type | Payload | When emitted |
|---|---|---|
| `data-run-event` | `{ runId, nodeId, type, ... }` | Each agent run node or tool start/end event |
| `data-approval` | `{ approvalId, toolName, args }` | When a sensitive tool needs user approval |
| `data-canvas` | `{ canvasId: string }` | Immediately after `render_canvas` tool executes |
| `data-routine-proposal` | `{ routineId, name, prompt, scheduleLabel, nextRuns, tz, status }` | When agent proposes a new scheduled routine |

#### Consuming `data-canvas` in the client

The AI SDK `useChat` hook exposes data parts on each message. Example client-side inspection:

```ts
// In a React Native component
for (const part of message.parts) {
  if (part.type === 'data-canvas') {
    const { canvasId } = part; // string
    // → fetch canvas, render inline card, or navigate
  }
}
```

> [!WARNING]
> Currently `apps/mobile/src/components/message-bubble.tsx` does **not** handle `data-canvas` parts. The canvas is only accessible from the Canvas tab. See [§4](#4-integrating-canvas-inline-in-chat--implementation-guide) for the implementation guide.

---

### 3.4 Threads API

| Method | Route | Description |
|---|---|---|
| `GET` | `/api/threads` | List threads with agent avatar + group summary |
| `POST` | `/api/threads` | Create thread; pass `groupId` to create a durable group chat |
| `GET` | `/api/threads/:id` | Thread + messages with agent identities resolved |
| `PATCH` | `/api/threads/:id` | Update title or model |
| `DELETE` | `/api/threads/:id` | Delete thread and all messages |

---

### 3.5 Mobile Chat Screen

**File:** `apps/mobile/src/app/(tabs)/chat.tsx`

#### Key hooks and state

| State | Purpose |
|---|---|
| `useChat` (from `@ai-sdk/react`) | Drives message list, streaming, submission |
| `ResilientChatTransport` | Custom transport that handles token refresh and retries |
| `isStreaming` | True while the AI SDK stream is open |
| `primaryActiveRunId` | The run ID of the most recent active agent run (for status polling) |
| `agentRuns` | Polled run state for showing progress per tool node |
| `isTaskActive` | Derived: `isStreaming || agentRuns.some(r => r.status === 'running')` |

#### Pause button

When `isTaskActive` is `true`, the send button is replaced with a **pause icon button**:

```ts
if (isTaskActive) {
  // Calls pauseRun(primaryActiveRunId) on the server, then
  // calls stop() from useChat to abort the stream
}
```

This was implemented to let users interrupt long-running agent tasks without losing the thread.

---

### 3.6 Mobile MessageBubble (`apps/mobile/src/components/message-bubble.tsx`)

Iterates `message.parts` and renders each part type:

| Part type | Rendered as |
|---|---|
| `text` | Markdown text, inside a `Bubble` component |
| `tool-invocation` | Collapsible tool call card (tool name + args + result) |
| `reasoning` | Italic muted text block |
| `options` | Quick-reply pill buttons below the bubble |
| `file` | Attachment chip (image preview or file icon + name) |
| `data-canvas` | ⚠️ **Not handled yet** — see [§4](#4-integrating-canvas-inline-in-chat--implementation-guide) |
| `data-approval` | Approval card with Approve / Deny buttons |
| `data-run-event` | Inline progress indicator for the active run node |
| `data-routine-proposal` | Routine proposal card |

---

## 4. Integrating Canvas Inline in Chat — Implementation Guide

> **Goal:** Render a compact canvas card (or full `CanvasView`) directly inside the message bubble when the agent emits a `data-canvas` stream part.

### Step 1 — Parse `data-canvas` in `MessageBubble`

In `apps/mobile/src/components/message-bubble.tsx`, add a branch inside the parts loop:

```tsx
// Inside the parts.map() loop in MessageBubble
if (part.type === 'data-canvas') {
  return (
    <InlineCanvasCard key={part.canvasId} canvasId={part.canvasId} />
  );
}
```

### Step 2 — Build `InlineCanvasCard`

Create `apps/mobile/src/components/inline-canvas-card.tsx`:

```tsx
import React, { useEffect, useState } from 'react';
import { View, Text, TouchableOpacity, ActivityIndicator } from 'react-native';
import { useRouter } from 'expo-router';
import { fetchCanvas } from '@/lib/canvases';
import { CanvasView } from './canvas-renderer';
import type { Canvas } from '@agent/shared';

export function InlineCanvasCard({ canvasId }: { canvasId: string }) {
  const [canvas, setCanvas] = useState<Canvas | null>(null);
  const [error, setError] = useState(false);
  const router = useRouter();

  useEffect(() => {
    fetchCanvas(canvasId)
      .then(setCanvas)
      .catch(() => setError(true));
  }, [canvasId]);

  if (error) return <Text>Could not load canvas.</Text>;
  if (!canvas) return <ActivityIndicator />;

  return (
    <View style={{ borderRadius: 12, overflow: 'hidden', marginTop: 8 }}>
      {/* Option A: Full render */}
      <CanvasView
        spec={canvas.spec}
        onAction={(action) => {
          if (action.type === 'open_note') router.push(`/notes/${action.noteId}`);
          if (action.type === 'send_prompt') {
            // push prompt back to the chat composer
          }
          if (action.type === 'refresh') {
            // call refreshCanvas(canvasId) and re-fetch
          }
        }}
      />

      {/* Option B: Compact tap-to-open card instead of full render */}
      <TouchableOpacity onPress={() => router.push(`/canvas/${canvasId}`)}>
        <Text>{canvas.title}</Text>
      </TouchableOpacity>
    </View>
  );
}
```

> [!TIP]
> For long or complex canvases, **Option B** (compact tap-to-open card) is safer for chat UX. Reserve full inline rendering for simple stat or markdown canvases.

### Step 3 — Wire `send_prompt` action to the composer

The chat screen exposes `append` from `useChat`. Pass it down through context or a prop so `InlineCanvasCard` can call:

```ts
append({ role: 'user', content: action.prompt });
```

### Step 4 — Handle `refresh` action

Call `refreshCanvas(canvasId)` from `apps/mobile/src/lib/canvases.ts`, then re-fetch and update local state.

---

## 5. Integrating Canvas in the Web Dashboard

> **Status:** No web dashboard canvas display exists yet. The `apps/api` Next.js app has no canvas rendering UI.

### Approach

1. **Fetch the canvas** from `GET /api/canvases/:id` using the existing session cookie.

2. **Render on the web** — `CanvasView` is a React Native component and cannot be used directly on the web. Options:

   | Option | Effort | Notes |
   |---|---|---|
   | Re-implement `CanvasView` as a React (web) component | Medium | Copy node-type logic, replace RN primitives with HTML. Use `recharts` or `chart.js` for chart nodes. |
   | Use `react-native-web` in the Next.js app | High | Requires Webpack alias config; may conflict with shadcn/ui. |
   | Render markdown and list nodes only; link others to mobile | Low | Quickest path; acceptable if dashboard is secondary. |

3. **Wrap in a shadcn/ui card:**

```tsx
// apps/api/components/canvas-card.tsx (new file)
import { Card, CardHeader, CardContent } from '@/components/ui/card';

export function CanvasCard({ canvas }: { canvas: Canvas }) {
  return (
    <Card>
      <CardHeader>{canvas.title} — v{canvas.version}</CardHeader>
      <CardContent>
        {/* WebCanvasView goes here */}
      </CardContent>
    </Card>
  );
}
```

4. **Dashboard listing:** Add a `/dashboard/canvases` page that calls `GET /api/canvases` and renders `CanvasCard` for each result.

---

## 6. Debugging Reference

### Common errors

| Error / symptom | Likely cause | Fix |
|---|---|---|
| `invalid_spec` (400) | `validateCanvasSpec` failure — depth > 4, size > 100 KB, or unknown field | Inspect the spec; check nesting depth and byte size |
| `not_found` (404) on canvas route | Wrong canvas ID or canvas owned by different user | Verify `user_id` matches the JWT sub |
| `agent_mismatch` (409) | Thread was created with a different `agentId` | Use the correct agent or start a new thread |
| `group_thread` (409) | Tried to `POST /api/chat` with a group thread ID | Use the group chat endpoint instead |
| Canvas data not refreshing | Data source kind not in `rewriteBoundComponents` | Only `markdown` and `list` nodes rewrite in v1; check `apps/api/lib/canvases.ts` |
| Canvas not shown inline in chat | `MessageBubble` doesn't handle `data-canvas` | Follow the guide in [§4](#4-integrating-canvas-inline-in-chat--implementation-guide) |

### Inspect `data-canvas` stream parts

Add a temporary log in `MessageBubble` to verify the part is arriving:

```ts
// apps/mobile/src/components/message-bubble.tsx
for (const part of message.parts) {
  console.log('[MessageBubble] part:', part.type, part);
}
```

### Test canvas CRUD with curl

```bash
JWT="<paste Supabase JWT here>"
HOST="http://localhost:3000"

# Create
curl -X POST "$HOST/api/canvases" \
  -H "Authorization: Bearer $JWT" \
  -H "Content-Type: application/json" \
  -d '{"title":"Test","spec":{"root":{"type":"markdown","content":"Hello"}}}'

# List
curl "$HOST/api/canvases" -H "Authorization: Bearer $JWT"

# Refresh (re-runs data sources)
curl -X POST "$HOST/api/canvases/<id>/refresh" -H "Authorization: Bearer $JWT"
```

### Test spec validation

```bash
# Should return 400 invalid_spec (nesting too deep)
curl -X POST "$HOST/api/canvases" \
  -H "Authorization: Bearer $JWT" \
  -H "Content-Type: application/json" \
  -d '{
    "title": "Deep",
    "spec": {
      "root": {
        "type": "stack",
        "direction": "column",
        "children": [{
          "type": "stack", "direction": "column", "children": [{
            "type": "stack", "direction": "column", "children": [{
              "type": "stack", "direction": "column", "children": [{
                "type": "markdown", "content": "too deep"
              }]
            }]
          }]
        }]
      }
    }
  }'
```

### Check Inngest canvas refresh

In the Inngest Dev Server (`http://localhost:8288`), look for:
- Event: `canvas/refresh.requested`
- Function: canvas refresh function
- Logs will show which data sources were queried and which components were rewritten.

### Verify agent tool execution

In the Inngest function logs for a chat run, look for `render_canvas` and `update_canvas` tool invocations. The tool result should contain `{ canvasId, title, version }`. If the stream part isn't reaching the client, add a log in `apps/api/app/api/chat/route.ts` where `data-canvas` is emitted.

---

*Last updated: auto-generated by development session. Keep in sync when modifying `packages/shared/src/canvas.ts`, `apps/api/lib/canvases.ts`, or `apps/mobile/src/components/canvas-renderer.tsx`.*
