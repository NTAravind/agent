import {
  ArrowUp,
  Bed,
  Bell,
  BellOff,
  Brain,
  BrainOff,
  CalendarClock,
  Check,
  ChevronDown,
  ChevronLeft,
  ChevronUp,
  Copy,
  Globe,
  Info,
  Menu,
  MoreHorizontal,
  Paperclip,
  Pause,
  Play,
  Plus,
  RotateCcw,
  Search,
  SkipForward,
  SlidersHorizontal,
  Sparkles,
  Square,
  Wrench,
  X,
} from 'lucide-react-native';

/**
 * Centralised icon constants so glyphs can be swapped in one place.
 * All icons are Lucide React Native components.
 */

/**
 * Sleep/snooze glyph for the chat details button and the agent detail
 * quick actions. Swap this one constant to change both (e.g. to `Info`).
 */
export const SLEEP_ICON = Bed;

/** Icons used in the agent list row action pill. */
export const AGENT_LIST_ACTION_ICONS = {
  pause: Pause,
  play: Play,
  skipForward: SkipForward,
  bell: Bell,
  bellOff: BellOff,
} as const;

/** Icons used in the agent overview quick actions. */
export const AGENT_OVERVIEW_ICONS = {
  pause: Pause,
  play: Play,
  bell: Bell,
  bellOff: BellOff,
  sleep: SLEEP_ICON,
  brain: Brain,
  brainOff: BrainOff,
} as const;

/** Icons used in the per-agent chat header. */
export const CHAT_HEADER_ICONS = {
  back: ChevronLeft,
  search: Search,
  menu: Menu,
  create: Plus,
  /** Details button on the right of the agent chat header. */
  details: SLEEP_ICON,
  /** Clock button: the routines bound to this agent (Phase 10). */
  routine: CalendarClock,
} as const;

/** Misc screen icons. */
export const SCREEN_ICONS = {
  back: ChevronLeft,
  search: Search,
  create: Plus,
  close: X,
  more: MoreHorizontal,
  info: Info,
  sliders: SlidersHorizontal,
  wrench: Wrench,
} as const;

/** Icons used in the Grok-style capsule composer. */
export const COMPOSER_ICONS = {
  send: ArrowUp,
  attach: Plus,
  paperclip: Paperclip,
  deepSearch: Globe,
  think: Brain,
  sparkles: Sparkles,
  stop: Square,
} as const;

/** Icons used in the Grok-style message bubble and tools. */
export const MESSAGE_ICONS = {
  copy: Copy,
  check: Check,
  retry: RotateCcw,
  chevronDown: ChevronDown,
  chevronUp: ChevronUp,
  deepSearch: Globe,
  sparkles: Sparkles,
  brain: Brain,
} as const;

/** Tile size in the pinned quick-access row (pt). */
export const AGENT_TILE_SIZE = 76;
/** Circular avatar size in list rows (pt). */
export const AGENT_LIST_AVATAR_SIZE = 44;