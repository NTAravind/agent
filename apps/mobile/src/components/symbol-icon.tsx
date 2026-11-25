import { SymbolView, type SFSymbol } from 'expo-symbols';
import { Platform, type StyleProp, type ViewStyle } from 'react-native';
import type { LucideIcon } from 'lucide-react-native';

/**
 * DESIGN.md §8 — Iconography:
 * "Use SF Symbols on iOS through `expo-symbols` (`SymbolView`) with the
 * `regular` weight, and a fallback of `lucide-react-native` at
 * `strokeWidth={1.75}` for Android and web."
 *
 * `SymbolIcon` is the single place that decides which of the two an icon
 * renders as, so every call site keeps one visual style.
 */

/**
 * Lucide icon name to SF Symbol name. Icons that are not listed here always
 * render as Lucide — on iOS as well — so an unfamiliar mark never turns into
 * a blank space.
 *
 * The keys are lucide's **canonical** `displayName` values, not the export
 * aliases. Several aliases were renamed upstream (`AlertTriangle` →
 * `TriangleExclamationPoint`, `Trash2` → `Trash`, `MoreHorizontal` →
 * `Ellipsis`, …), and `displayName` is what the lookup below actually sees.
 */
const SF_SYMBOLS: Record<string, SFSymbol> = {
  Activity: 'waveform.path.ecg',
  ArrowUp: 'arrow.up',
  ArrowUpRight: 'arrow.up.right',
  BookBookmark: 'bookmark',
  Bookmark: 'bookmark',
  Blocks: 'square.stack.3d.up',
  Bot: 'cpu',
  Calendar: 'calendar',
  CalendarClock: 'calendar.badge.clock',
  CalendarDays: 'calendar',
  Camera: 'camera',
  Check: 'checkmark',
  ChevronDown: 'chevron.down',
  ChevronLeft: 'chevron.left',
  ChevronRight: 'chevron.right',
  ChevronUp: 'chevron.up',
  Circle: 'circle',
  CircleCheck: 'checkmark.circle',
  CircleExclamationPoint: 'exclamationmark.circle',
  CircleX: 'xmark.circle',
  Clock: 'clock',
  Cloud: 'cloud',
  Code: 'chevron.left.forwardslash.chevron.right',
  Compass: 'safari',
  CornerDownLeft: 'arrow.turn.down.left',
  Database: 'cylinder',
  Ellipsis: 'ellipsis',
  ExternalLink: 'arrow.up.right.square',
  FileText: 'doc.text',
  Folder: 'folder',
  FolderPlus: 'folder.badge.plus',
  GitBranch: 'arrow.triangle.branch',
  Globe: 'globe',
  Heading2: 'textformat.size',
  Image: 'photo',
  Info: 'info.circle',
  Italic: 'italic',
  KeyRound: 'key',
  Layers: 'square.3.layers.3d',
  LayoutDashboard: 'square.grid.2x2',
  LetterB: 'bold',
  Lightbulb: 'lightbulb',
  Link2: 'link',
  List: 'list.bullet',
  ListChecks: 'checklist',
  ListTodo: 'list.bullet.rectangle',
  Lock: 'lock',
  LogOut: 'rectangle.portrait.and.arrow.right',
  Mail: 'envelope',
  MapPin: 'mappin',
  Menu: 'line.3.horizontal',
  MessageSquare: 'message',
  Mic: 'mic',
  Minus: 'minus',
  Paperclip: 'paperclip',
  Pause: 'pause',
  PenLine: 'pencil.line',
  Pencil: 'pencil',
  Pin: 'pin',
  Play: 'play',
  Plus: 'plus',
  Redo2: 'arrow.clockwise',
  RefreshCw: 'arrow.clockwise',
  RotateCw: 'arrow.clockwise',
  Search: 'magnifyingglass',
  Share2: 'square.and.arrow.up',
  ShieldCheck: 'checkmark.shield',
  ShieldExclamationPoint: 'exclamationmark.shield',
  SlidersHorizontal: 'slider.horizontal.3',
  Square: 'stop.fill',
  SquareCheckBig: 'checkmark.square',
  Sun: 'sun.max',
  Tag: 'tag',
  Terminal: 'terminal',
  Trash: 'trash',
  TriangleExclamationPoint: 'exclamationmark.triangle',
  Undo2: 'arrow.counterclockwise',
  Upload: 'arrow.up.doc',
  User: 'person',
  UserCheck: 'person.crop.circle.badge.checkmark',
  UserPlus: 'person.badge.plus',
  Users: 'person.2',
  Wrench: 'wrench.and.screwdriver',
  X: 'xmark',
  Zap: 'bolt',
};

export function SymbolIcon({
  icon: Icon,
  size = 24,
  color,
  strokeWidth = 1.75,
  style,
}: {
  icon: LucideIcon;
  size?: number;
  color: string;
  strokeWidth?: number;
  style?: StyleProp<ViewStyle>;
}) {
  const symbol = Icon.displayName ? SF_SYMBOLS[Icon.displayName] : undefined;

  if (Platform.OS !== 'ios' || !symbol) {
    return <Icon size={size} color={color} strokeWidth={strokeWidth} style={style} />;
  }

  return (
    <SymbolView
      name={symbol}
      size={size}
      tintColor={color}
      weight="regular"
      type="monochrome"
      style={[{ width: size, height: size }, style]}
      fallback={<Icon size={size} color={color} strokeWidth={strokeWidth} style={style} />}
    />
  );
}
