# UI / UX Spec (Expo app)

## 1. Principles
- Chat is home; everything else is one tap away.
- Show work: long tasks show a live timeline, not a spinner.
- Ask before acting: approvals are impossible to miss and fast to answer.
- Native-feeling, dark and light themes, thumb-reachable controls.

## 2. Navigation (bottom tabs)
| Tab | Purpose |
|---|---|
| Chat | Threads, composer, streaming messages, inline canvases |
| Canvas | Saved dashboards/reports |
| Notes | Vault browser, search, note view with backlinks |
| Agents | Agent list, runs, MCP tools per agent |
| Store | MCP server directory |
| Settings | Profile, model, memory, vault, theme |

Approvals badge appears on the tab bar and as a banner anywhere.

## 3. Screens
**Chat**: thread list drawer with the selected agent's avatar badge; composer with attach (image/PDF/file), mic (P2), agent picker, **model picker** (a flat list labelled by provider — Google, Groq, OpenRouter, Mistral, DeepSeek, Hugging Face, Cohere — with capability badges and a warning if the model can't handle the attachment), mode toggle (Chat / Run as task). Messages render the authoring agent's avatar alongside markdown, code with copy, citations as tappable chips, tool-call chips (collapsible), inline canvas cards, approval cards.
**Run detail**: header (goal, status, elapsed), vertical timeline of events (node, tool call, result, retry), with the responsible agent's avatar on each step and child run; cancel button, final result. Supervisor runs show a **Specialists** section with each child run (specialist avatar + name + status), tappable through to the child's own timeline.
**Approval card**: agent avatar and identity (for example, “Researcher wants to…”), tool name, plain-language summary, arguments (expandable), buttons Approve / Deny, optional edit of arguments. States: pending, approved, denied, expired.
**Canvas list/detail**: cards with title and last updated; detail renders spec full-screen, pull-to-refresh, "Ask about this" button that opens chat with the canvas as context.
**Notes**: folder tree, search bar (hybrid), note view (markdown, `[[links]]` tappable, backlinks section), edit (writes need confirmation), "Ask agent about this note".
**Agents**: list with avatar, role and MCP tool count; editor for name, role, instructions, primary model + fallback order, tools toggle list with per-tool "require approval", and a **Supervisor** switch (orchestrates specialist agents in multi-agent runs). Avatar picker has Emoji, Icon and Upload tabs plus a color swatch row.
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

## 5. Design tokens (starting point)
Spacing scale 4/8/12/16/24/32. Radius 8 (inputs), 12 (cards). Type: system font; sizes 12/14/16/20/28. Avatar sizes: 24 pt in timelines, 32 pt in chat, 56 pt in the editor. If an avatar image is missing or unavailable, fall back to its emoji. Color roles: background, surface, text, text-muted, primary, success, warning, danger (define light and dark values). Minimum tap target 44 pt.

## 6. States & feedback
- Loading: skeletons for lists; streaming cursor for chat.
- Empty: say what to do next ("Add your vault in Settings to search notes").
- Errors: plain cause + action ("Rate limit reached. Retrying in 20 s." / Retry button). No blame, no apology.
- Offline: cached threads and canvases readable; composer queues until online.
- Quota meter warns at 80% of monthly free limits.

## 7. Accessibility & platform
Dynamic type, screen reader labels on all controls and chart summaries (text alternative), reduced-motion respected, haptics on approvals. Primary target iOS/Android via Expo; web build is optional later.

## 8. Voice (P2)
Hold-to-talk using device speech recognition, transcript editable before sending; read-aloud toggle per message using device TTS.
