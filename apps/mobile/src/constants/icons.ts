import {
  ArrowUp,
  Bed,
  Bell,
  BellOff,
  Bot,
  CalendarClock,
  Check,
  ChevronDown,
  ChevronLeft,
  ChevronUp,
  Copy,
  Database,
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
  Square,
  Wrench,
  X,
} from 'lucide-react-native';

/**
 * Centralised icon constants conforming to design.md:
 * All icons are clean outline SF Symbols / Lucide style.
 * No sparkles, no robot/brain "AI" badges.
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
  memory: Database,
  brain: Database,
  brainOff: Database,
} as const;

/** Icons used in the per-agent chat header. */
export const CHAT_HEADER_ICONS = {
  back: ChevronLeft,
  search: Search,
  menu: Menu,
  create: Plus,
  details: SLEEP_ICON,
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

/** Icons used in composer. */
export const COMPOSER_ICONS = {
  send: ArrowUp,
  attach: Plus,
  paperclip: Paperclip,
  deepSearch: Globe,
  think: Database,
  sparkles: Bot,
  stop: Square,
} as const;

/** Icons used in message bubble and tools. */
export const MESSAGE_ICONS = {
  copy: Copy,
  check: Check,
  retry: RotateCcw,
  chevronDown: ChevronDown,
  chevronUp: ChevronUp,
  deepSearch: Globe,
  sparkles: Bot,
  brain: Database,
} as const;

/** Tile size in the pinned quick-access row (pt). */
export const AGENT_TILE_SIZE = 76;
/** Circular avatar size in list rows (pt). */
export const AGENT_LIST_AVATAR_SIZE = 44;
