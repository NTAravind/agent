# design.md: Design Language for the App (Expo / React Native , Android first )

This file is the single source of truth for UI. Follow it exactly. If something is not covered here, choose the quieter, plainer, more monochrome option. Do not invent new styles.

## 1. Principles

1. **Monochrome UI, colorful characters.** Chrome, text, buttons and surfaces are white, light gray, black and gray. The only saturated color on screen comes from the agent "marks" (the little colored blob characters). Never add color elsewhere.
2. **Soft and quiet.** Big radii, no borders, hairline dividers only, very soft shadows. Nothing glows, shines or gradients.
3. **Native iOS feel.** System font, SF Symbols-style outline icons, bottom sheets, pill inputs, floating round buttons.
4. **Generous space.** Large touch targets (44pt minimum), roomy rows, 17pt body text.
5. **Calm copy.** Short, human, lowercase-friendly sentences. No hype, no "magic" language.

## 2. Hard Rules: Do NOT

- No "AI-looking" colors: no purple/indigo/violet-to-blue gradients, no neon, no glowing or colored shadows, no mesh gradients, no rainbow borders.
- No "AI-looking" icons: no sparkles (✨ or ✦), no magic wand, no robot, no brain, no chip, no lightning bolt "AI" badge, no star-burst, no "AI" or "beta" labels.
- No emoji as icons or decoration in UI.
- No filled or duotone icon packs, no Material ripple look, no heavy 3D or skeuomorphic effects.
- No borders around cards or inputs (use fill color only). Hairline dividers inside grouped lists are allowed.
- No new accent color for buttons, links or highlights beyond the ones defined below.
- No dark navy, slate-blue or tinted grays. Grays are neutral.
- No gradient fills on buttons, cards, avatars or marks. Marks are flat color.
- No full-width bottom tab bar or Material-style FAB. Navigation uses the floating round buttons described below.

## 3. Color Tokens

Values were sampled from the reference screens. Treat as exact.

```ts
export const colors = {
  // Surfaces
  background: '#FCFCFC',      // screen background (near white, not pure white)
  surface: '#F3F3F3',         // cards, grouped rows, agent bubbles, input fields
  surfaceRaised: '#FFFFFF',   // floating round buttons, header pill, sheets, option list
  overlay: 'rgba(0,0,0,0.20)',// dim behind bottom sheets (page turns light gray)

  // Text
  textPrimary: '#0A0A0A',
  textSecondary: '#8E8E93',   // section labels, previews, timestamps, placeholders
  textTertiary: '#B5B5BA',    // file extensions, disabled

  // Lines
  divider: '#E2E2E4',         // hairline (StyleSheet.hairlineWidth), inset from the left edge

  // Actions
  primary: '#111111',         // primary buttons, user bubble, send button
  onPrimary: '#FFFFFF',
  link: '#2F6BDB',            // text actions ("Add member", "Reset to default") and hyperlinks
  success: '#4CAF6A',         // check mark on a selected option, online status dot
  recording: '#E8404A',       // recording square + timer text only
  recordingBg: '#FBE9EA',     // recording pill background

  // Agent mark palette (the ONLY decorative color in the app)
  mark: {
    black:  '#000000',
    brown:  '#8B6743',
    red:    '#E8404A',
    orange: '#EE7230',
    amber:  '#F0A030',
    green:  '#5BC87C',
    teal:   '#52B8A8',
    blue:   '#3B82F6',
    purple: '#8B5CF6',
    pink:   '#EC4899',
    gray:   '#777777',
  },
};
```

Notes:
- `link` blue is for text actions and hyperlinks only (underline hyperlinks inside message text). Never use it as a fill.
- Mark colors are picked by the user per agent. They never appear on buttons, headers or backgrounds.

## 4. Typography

System font only (San Francisco on iOS). Do not load custom fonts.

| Role | Size / line | Weight | Color |
|---|---|---|---|
| Screen/agent name (settings card) | 24 / 30 | 600 | textPrimary |
| Sheet title (e.g. "Google Calendar") | 24 / 30 | 600 | textPrimary |
| List row title (chat list name, settings rows) | 20 / 26 | 500 | textPrimary |
| Body / message text | 17 / 22 | 400 | textPrimary |
| Secondary line (preview, description, subtitle) | 17 / 22 | 400 | textSecondary |
| Section label ("Character", "Routines", "Includes") | 15 / 20 | 400 | textSecondary |
| Timestamp / meta / right-aligned type label | 15 / 20 | 400 | textSecondary |
| Tag pill text | 15 / 20 | 400 | textSecondary |

- Sentence case everywhere ("Add routine", "Reset to default", "Ask SLMob"). No ALL CAPS, no letter-spacing tweaks.
- File names show the extension in `textTertiary` (e.g. `week-meal-prep` + `.md`).
- Single-line previews truncate with an ellipsis (`numberOfLines={1}`).
- In search results, the matched term is bold (700) inside secondary text.

## 5. Spacing, Radius, Elevation

```ts
export const space = { xs: 4, sm: 8, md: 12, lg: 16, xl: 24, xxl: 32 };

export const radius = {
  pill: 999,      // inputs, tags, buttons, header pill, round buttons
  card: 24,       // grouped settings cards, bubbles, attachment card
  inner: 20,      // option list inside a bubble
  sheet: 32,      // bottom sheets and popovers (top corners)
  tile: 10,       // small icon tiles (file icon, A-E badges)
};

export const shadow = {
  floating: {     // round buttons, header pill, popovers
    shadowColor: '#000',
    shadowOpacity: 0.08,
    shadowRadius: 20,
    shadowOffset: { width: 0, height: 6 },
    elevation: 0, // do not use Android elevation look
  },
};
```

- Screen horizontal padding: **16**.
- Vertical gap between message bubbles: **10**.
- Grouped card inner padding: 16 horizontal, rows at least 56 tall.
- Section label sits 8 above its card and is inset 16 from the card edge.
- Cards have no border and no shadow (flat `surface` fill). Only floating elements get a shadow.

## 6. Components

### 6.1 Floating header (all screens)
- No navigation bar background. Content scrolls underneath; add a soft fade at the top (background color to transparent, about 120pt tall) using `expo-linear-gradient` with background-to-transparent only (never colored).
- Left: round **back button**, 44x44, `surfaceRaised`, chevron-left icon, `floating` shadow.
- Center (chat screens): a **title pill**, `surfaceRaised`, pill radius, height 44, containing the agent mark (28pt) + agent name (20/500). `floating` shadow.
- Right: round 44x44 button (desktop/monitor icon on chat, `ellipsis` on settings and sheets).
- Settings screens show the back button and ellipsis only, with the large agent mark centered below.
- A header with a primary action (e.g. Instructions) puts a black pill **Save** button on the right (see 6.2) instead of the round icon.

### 6.2 Buttons
- **Primary pill**: height 44, horizontal padding 24, `primary` fill, white 17/600 text, pill radius ("Save").
- **Secondary / completed pill**: `surface` fill, `textPrimary` 17/600 text ("Added" state of a connector). No border.
- **Text action**: `link` color, 17/400, leading outline icon when relevant ("+ Add routine", "Add member", "Reset to default"). No background.
- **Round icon button**: 44x44 `surfaceRaised` with `floating` shadow. Inside sheets, round buttons use `surface` fill and no shadow (close X on the left, ellipsis on the right, both 44x44).
- Pressed state: opacity 0.6 (`Pressable`). No ripple, no scale bounce, no color change.

### 6.3 Chat bubbles
- **Agent message**: `surface` fill, radius 24, padding 16 horizontal / 14 vertical, text 17/22 `textPrimary`, max width about 85% of the screen, left aligned. Several consecutive agent messages stack as separate bubbles with a 10 gap.
- **User message**: `primary` (#111) fill, white text, radius 24, right aligned, max width about 80%.
- **Reply/quote reference**: small `textSecondary` 15pt single line with a curved reply arrow icon, placed directly above the bubble it relates to (right aligned above a user bubble, left aligned above an agent bubble). Text truncates with an ellipsis.
- **Hyperlinks** inside text: `link` color with underline.
- **File attachment card**: `surface` fill, radius 24, padding 12 horizontal, with a 44x44 `tile` icon block (slightly darker gray, file-type glyph such as "M↓"), file name 20/500 with the extension in `textTertiary`, and file size below in 15pt `textSecondary`.

### 6.4 Quick-reply options inside an agent bubble
- Agent bubble contains the question (17/22), then a white (`surfaceRaised`) list with radius 20 and no shadow.
- Each row is 60 tall with a leading letter badge (A, B, C...): 32x32, radius 10, `surface` fill, `textSecondary` 15pt letter. Then the option text 20/400.
- Rows are separated by a hairline divider inset from the left.
- After a choice is made, the list collapses to only the chosen row, badge replaced by nothing, with a `success` green check icon on the right. Other options disappear.

### 6.5 Composer
- Row at the bottom with safe-area padding: a round **+** button (44, `surfaceRaised`, floating shadow) and a pill text field (`surfaceRaised`, floating shadow, height 52, placeholder "Ask {AgentName}" in `textSecondary`).
- Right inside the field: a small mic button, 36x36 circle, `surface` fill, `textSecondary` mic icon.
- **Recording state**: the mic is replaced by a pill with `recordingBg`, a small `recording` red rounded square (stop), and a timer `0:10` in `recording` color; next to it a round **send** button, 40x40, `primary` fill with a white arrow-up icon.
- **+ menu**: a popover above the button, `surfaceRaised`, radius 32, `floating` shadow, rows with a 28pt outline icon plus label 20/400: "Attach Image", "Take Photo", "Choose File". No dividers, 16 vertical padding per row.

### 6.6 Grouped settings cards
- `surface` fill, radius 24, rows separated by hairline dividers that start after the leading icon (not edge to edge).
- Row: leading icon or mark (about 28pt), title 20/400, trailing chevron-right in `textTertiary`.
- Name/description card: first line is the name centered 24/600, hairline, second line centered 17 `textSecondary` (e.g. "Meal prepping").
- Section label above the card: 15pt `textSecondary`.
- Helper caption below a card: 15pt `textSecondary`, inset 16 (e.g. "How this agent's mark looks everywhere").
- Routine row: leading outline clock icon (purple-ish tinted stroke is NOT allowed; use `textSecondary` stroke), title 20/400, subtitle 17 `textSecondary` ("Every Sunday at 8:41 AM"), chevron. Empty state is "No routines yet" in `textSecondary`, followed by a "+ Add routine" text action.
- Text editor screen (Instructions): a `surface` card, radius 24, min height about 220, padding 16, 17/22 text. Save is the black pill in the header.

### 6.7 Character picker (settings)
- Inside a grouped card, section 1: grid of **color swatches**, 36pt circles, 20 gap, wrapping rows, using the `mark` palette in this order: black, brown, red, orange, amber, green, teal, blue, purple, pink, gray.
- Hairline divider.
- Section 2: row of **shape options** rendered in the currently selected color, about 36pt: circle, soft ellipse/blob, rounded square, pill, triangle, hexagon, cloud, drop.
- The selected swatch or shape gets a 2pt `#C8C8CC` ring with a 4pt gap (a ring around it, not a fill change).
- Hairline divider, then a "Reset to default" text action in `link` color.

### 6.8 Bottom sheet (e.g. connector detail)
- Slides up, top radius 32, `background` fill with a very subtle fade, page behind dimmed with `overlay`.
- Top row: round close button (X) left, round ellipsis button right (both `surface`, 44).
- Content: 56pt app icon (rounded square, as supplied by the service), title 24/600, domain/subtitle 17 `textSecondary` beneath, description 17/22 `textSecondary`.
- "Includes" label (15 `textSecondary`) over a `surface` card with a row: "1 connector" left, "View source ↗" right in `textSecondary`.
- Bottom: centered pill button 44 tall ("Added" state as secondary pill).
- Use a native-feeling sheet (`expo-router` formSheet or `@gorhom/bottom-sheet`), never a centered modal.

### 6.9 Search
- Opens as a large sheet (same style as 6.8). Top row: round close button, a pill search field (`surface`, magnifier icon in `textSecondary`, query in 20/400, small gray circular clear button on the right), and a round filter button (three horizontal lines of decreasing length icon).
- Result row: avatar or mark (60pt) on the left, title 20/500, subtitle 17 `textSecondary` single line (matched term in bold), and a right-aligned type label ("Group", "Agent", "Message") in 15 `textSecondary`.
- No dividers between results; use about 24pt vertical rhythm.

### 6.10 Chat list (home)
- Top row: a 44pt initials avatar on the left (circle, `#E5E5E7` fill, initials in `textSecondary` 20/500, thin white ring) and two round buttons on the right (search, plus), 44 each, `surfaceRaised`, floating shadow.
- Row: mark/avatar 64pt on the left, then name 20/500 followed by an optional **tag pill** (`surface`, pill radius, 15 `textSecondary`, padding 12x4, truncates with an ellipsis), timestamp 15 `textSecondary` right aligned, and a one-line preview 17 `textSecondary` below.
- Rows are about 120pt apart with no dividers and no card backgrounds.
- Group chats show a cluster of up to 3 marks arranged as a triangle (one on top, two below) in one 64pt avatar slot.
- **Status dot**: 14pt circle `success` color with a 3pt white ring at the bottom-right of the avatar, shown when the agent is active.

## 7. Agent Marks (the characters)

Every agent has a flat-colored shape with two small white slanted highlight marks near the upper right, reading as eyes. This is the only illustrative element in the product.

- Shapes: circle, blob (soft ellipse), rounded square (squircle), pill, triangle (heavily rounded corners), hexagon (rounded), cloud (three overlapping circles), drop (teardrop).
- Fill: a flat color from the `mark` palette. Black marks use a pure black fill.
- Highlights: two short, rounded, white strokes (about 12% of the shape width long, 6% wide) tilted about 20 degrees, sitting close together at the upper right. In small sizes they stay visible, never smaller than 2pt.
- Sizes: 28 (header pill), 36 (picker), 64 (chat list), about 120 (settings hero), 100 inside group clusters at relative scale.
- Implement with `react-native-svg` as a single `<AgentMark shape color size />` component. No gradients, no shadows, no outlines.
- Inside the small group-chat cluster, marks are slightly smaller, never overlapping except for a tiny tuck between the two lower marks.

## 8. Iconography

- Use SF Symbols on iOS through `expo-symbols` (`SymbolView`) with the `regular` weight, and a fallback of `lucide-react-native` at `strokeWidth={1.75}` for Android and web. Keep one style: outline, rounded caps, uniform stroke.
- Sizes: 24 in headers and rows, 28 in popover menus, 20 inline with text.
- Color: `textPrimary` by default, `textSecondary` for decorative or secondary icons, `textTertiary` for chevrons.
- Allowed icons (plain, functional): chevron-left, chevron-right, close (X), ellipsis, plus, magnifier, filter, mic, stop (square), arrow-up, check, desktop/monitor, clock, document/text, photo-on-rectangle, camera, folder, person-plus, reply arrow, external link arrow.
- Forbidden: anything on the list in section 2. When unsure, use plain text instead of an icon.

## 9. Motion and Feedback

- Use `react-native-reanimated` with short, calm easing (200 to 250 ms, ease-out). Sheets use a spring with no overshoot.
- Pressed feedback: opacity only. Light haptic (`expo-haptics`, `ImpactFeedbackStyle.Light`) on option selection, send, and swatch/shape selection.
- Typing/loading: three small `textTertiary` dots in an agent bubble, or a plain text status. No shimmer gradients, no sparkle animations, no glowing pulse.

## 10. Expo Implementation Notes

- Stack: Expo (SDK current), `expo-router`, `react-native-reanimated`, `react-native-gesture-handler`, `react-native-svg`, `expo-symbols`, `expo-blur`, `expo-linear-gradient`, `expo-haptics`, `react-native-safe-area-context`.
- Centralize tokens in `theme.ts` (colors, space, radius, shadow, type) and never hardcode hex values or sizes in components.
- Required shared components: `AgentMark`, `RoundButton`, `PillButton`, `TextAction`, `Bubble`, `OptionList`, `GroupedCard` (+ `GroupedRow`), `SectionLabel`, `TagPill`, `Composer`, `SheetHeader`.
- Header blur is optional; if used, `expo-blur` `BlurView` with `tint="light"` and low intensity, never tinted with color.
- Respect safe areas (top 59 on notched devices), keep the composer above the keyboard with `KeyboardAvoidingView`.
- Light mode is the reference. If dark mode is added later, invert to near-black surfaces with neutral grays only, keep marks identical, and keep the same rules from section 2.

## 11. Pre-Merge Checklist

- [ ] The only colorful pixels on the screen belong to agent marks, the green check/status dot, link text, or the recording state.
- [ ] No gradient fills, glows or colored shadows anywhere.
- [ ] No sparkle/wand/robot/brain icons or emoji in UI.
- [ ] Every card, bubble and pill uses a radius from the token list, with no borders.
- [ ] Body text is 17/22 system font, in sentence case.
- [ ] Floating round buttons are 44pt, white, softly shadowed.
- [ ] Primary actions are black pills; text actions are link blue with no background.
- [ ] Bottom sheets (not centered modals) are used for detail, search and pickers.
