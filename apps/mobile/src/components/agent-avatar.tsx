import { useState } from 'react';
import type { AgentAvatar as AgentAvatarValue } from '@agent/shared';
import { DEFAULT_AGENT_AVATAR } from '@agent/shared';
import { Image } from 'expo-image';
import { View } from 'react-native';
import Svg, { Circle, Ellipse, G, Path, Rect } from 'react-native-svg';
import {
  Bot,
  Brain,
  Briefcase,
  Code,
  Compass,
  Globe,
  Lightbulb,
  Mail,
  MessageSquare,
  Rocket,
  Search,
  Shield,
  Sparkles,
  Target,
  TrendingUp,
  Users,
  Wrench,
  Zap,
} from 'lucide-react-native';

export type CreatureShape =
  | 'circle'
  | 'droplet'
  | 'cloud'
  | 'squircle'
  | 'egg'
  | 'pill'
  | 'triangle';

export type CreatureConfig = {
  shape: CreatureShape;
  color: string;
  badge?: 'droplet' | 'dot' | null;
  eyeOffset?: { x: number; y: number };
};

export const AVATAR_ICONS: Record<string, typeof Bot> = {
  bot: Bot,
  brain: Brain,
  sparkles: Sparkles,
  zap: Zap,
  shield: Shield,
  search: Search,
  compass: Compass,
  target: Target,
  code: Code,
  'trending-up': TrendingUp,
  globe: Globe,
  mail: Mail,
  rocket: Rocket,
  lightbulb: Lightbulb,
  users: Users,
  briefcase: Briefcase,
  wrench: Wrench,
  'message-square': MessageSquare,
};

export const CREATURE_SHAPES: CreatureShape[] = [
  'circle',
  'droplet',
  'cloud',
  'squircle',
  'egg',
  'pill',
  'triangle',
];

export const CREATURE_PRESETS: Record<string, CreatureConfig> = {
  'chief of staff': { shape: 'circle', color: '#8B5CF6', eyeOffset: { x: 58, y: 44 } },
  'ea': { shape: 'droplet', color: '#3B82F6', eyeOffset: { x: 48, y: 62 } },
  'inbox manager': { shape: 'cloud', color: '#22C55E', eyeOffset: { x: 50, y: 50 } },
  'sales outbound': { shape: 'squircle', color: '#14B8A6', badge: 'droplet', eyeOffset: { x: 44, y: 44 } },
  'talent scout': { shape: 'circle', color: '#92400E', badge: 'dot', eyeOffset: { x: 50, y: 48 } },
  'growth marketer': { shape: 'egg', color: '#F97316', eyeOffset: { x: 48, y: 46 } },
  'customer support': { shape: 'pill', color: '#EF4444', eyeOffset: { x: 58, y: 50 } },
  'expense manager': { shape: 'triangle', color: '#EC4899', eyeOffset: { x: 46, y: 58 } },
  'invoice collector': { shape: 'squircle', color: '#6366F1', eyeOffset: { x: 48, y: 48 } },
  'apartment hunter': { shape: 'circle', color: '#10B981', eyeOffset: { x: 50, y: 50 } },
};

export const PALETTE_COLORS = [
  '#8B5CF6',
  '#3B82F6',
  '#22C55E',
  '#14B8A6',
  '#F97316',
  '#EF4444',
  '#EC4899',
  '#6366F1',
  '#10B981',
  '#F59E0B',
];

function deriveCreatureConfig(
  identifier?: string | null,
  customColor?: string,
): CreatureConfig {
  const normalized = (identifier ?? '').trim().toLowerCase();
  if (CREATURE_PRESETS[normalized]) {
    const preset = CREATURE_PRESETS[normalized];
    return {
      ...preset,
      color: customColor ?? preset.color,
    };
  }

  // If identifier is directly a shape name
  if (CREATURE_SHAPES.includes(normalized as CreatureShape)) {
    return {
      shape: normalized as CreatureShape,
      color: customColor ?? '#8B5CF6',
    };
  }

  let hash = 0;
  for (let i = 0; i < normalized.length; i++) {
    hash = (hash << 5) - hash + normalized.charCodeAt(i);
    hash |= 0;
  }
  const positive = Math.abs(hash);
  const shape = CREATURE_SHAPES[positive % CREATURE_SHAPES.length];
  const color = customColor ?? PALETTE_COLORS[positive % PALETTE_COLORS.length];

  return { shape, color };
}

type Props = {
  avatar?: AgentAvatarValue | null;
  /** Diameter in points. */
  size?: number;
  /** Optional container style: 'circle' | 'rounded' | 'creature'. */
  shape?: 'circle' | 'rounded' | 'creature';
  /** Agent name — used to derive creature shape and colors when applicable. */
  name?: string | null;
};

/**
 * Modern Agent Avatar Renderer.
 * Supports:
 *  - Uploaded photo images
 *  - Sleek vector Lucide icons (Bot, Brain, Sparkles, etc.)
 *  - Stylized organic creature shapes with eye-slits inspired by the reference design
 */
export function AgentAvatar({ avatar, size = 32, shape = 'circle', name }: Props) {
  const [failedKey, setFailedKey] = useState<string | null>(null);
  const value = avatar ?? DEFAULT_AGENT_AVATAR;

  const uri =
    value.type === 'image'
      ? (value.url ?? (value.value.startsWith('http') ? value.value : null))
      : null;
  const uriKey = uri ?? value.value;
  const showImage = uri !== null && failedKey !== uriKey;

  // 1. Image Avatar
  if (showImage && uri) {
    const borderRadius = shape === 'circle' ? size / 2 : size * 0.28;
    return (
      <View
        style={{
          width: size,
          height: size,
          borderRadius,
          overflow: 'hidden',
          backgroundColor: value.color ?? '#8B5CF6',
        }}
      >
        <Image
          source={{ uri }}
          style={{ width: size, height: size }}
          contentFit="cover"
          transition={150}
          onError={() => setFailedKey(uriKey)}
        />
      </View>
    );
  }

  // 2. Lucide Vector Icon Avatar
  const iconKey = value.value.toLowerCase().trim();
  const IconComponent = AVATAR_ICONS[iconKey];
  if (value.type === 'icon' && IconComponent) {
    const borderRadius = shape === 'circle' ? size / 2 : size * 0.28;
    const iconSize = Math.round(size * 0.52);
    return (
      <View
        style={{
          width: size,
          height: size,
          borderRadius,
          backgroundColor: value.color ?? '#8B5CF6',
          alignItems: 'center',
          justifyContent: 'center',
          overflow: 'hidden',
        }}
      >
        <IconComponent size={iconSize} color="#FFFFFF" strokeWidth={2.2} />
      </View>
    );
  }

  // 3. Creature Avatar (SVG organic shapes with cute character eyes)
  const creatureIdentifier =
    CREATURE_SHAPES.includes(value.value as CreatureShape)
      ? value.value
      : name ?? value.value;

  const creature = deriveCreatureConfig(creatureIdentifier, value.color);
  const { shape: creatureShape, color, badge, eyeOffset } = creature;

  let defaultEyeX = 50;
  let defaultEyeY = 50;

  if (creatureShape === 'droplet') {
    defaultEyeX = 48;
    defaultEyeY = 62;
  } else if (creatureShape === 'cloud') {
    defaultEyeX = 50;
    defaultEyeY = 50;
  } else if (creatureShape === 'triangle') {
    defaultEyeX = 46;
    defaultEyeY = 58;
  } else if (creatureShape === 'pill') {
    defaultEyeX = 56;
    defaultEyeY = 50;
  } else if (creatureShape === 'egg') {
    defaultEyeX = 48;
    defaultEyeY = 46;
  } else if (creatureShape === 'circle') {
    defaultEyeX = 52;
    defaultEyeY = 46;
  }

  const eyeX = eyeOffset?.x ?? defaultEyeX;
  const eyeY = eyeOffset?.y ?? defaultEyeY;

  return (
    <View
      style={{
        width: size,
        height: size,
        alignItems: 'center',
        justifyContent: 'center',
      }}
    >
      <Svg width={size} height={size} viewBox="0 0 100 100">
        {/* Base Creature Body */}
        {creatureShape === 'circle' && (
          <Circle cx="50" cy="50" r="44" fill={color} />
        )}

        {creatureShape === 'droplet' && (
          <Path
            d="M 50 12 C 50 12 86 50 86 68 A 36 36 0 1 1 14 68 C 14 50 50 12 50 12 Z"
            fill={color}
          />
        )}

        {creatureShape === 'cloud' && (
          <Path
            d="M 28 72 A 20 20 0 0 1 16 46 A 22 22 0 0 1 42 28 A 24 24 0 0 1 76 34 A 20 20 0 0 1 84 56 A 18 18 0 0 1 74 72 Z"
            fill={color}
          />
        )}

        {creatureShape === 'squircle' && (
          <Rect x="10" y="10" width="80" height="80" rx="26" ry="26" fill={color} />
        )}

        {creatureShape === 'egg' && (
          <Ellipse cx="50" cy="52" rx="36" ry="44" fill={color} />
        )}

        {creatureShape === 'pill' && (
          <Rect x="6" y="24" width="88" height="52" rx="26" fill={color} />
        )}

        {creatureShape === 'triangle' && (
          <Path
            d="M 50 14 C 55 14 58 19 86 68 C 89 74 86 82 78 82 L 22 82 C 14 82 11 74 14 68 C 42 19 45 14 50 14 Z"
            fill={color}
          />
        )}

        {/* Character Eyes (two cute tilted white tick-marks) */}
        <G transform={`translate(${eyeX}, ${eyeY}) rotate(-14)`}>
          <Rect x="-8" y="-7" width="5.5" height="15" rx="2.75" fill="#FFFFFF" />
          <Rect x="4" y="-7" width="5.5" height="15" rx="2.75" fill="#FFFFFF" />
        </G>

        {/* Optional Secondary Badges */}
        {badge === 'droplet' && (
          <G transform="translate(62, 58) scale(0.42)">
            <Path
              d="M 50 12 C 50 12 86 50 86 68 A 36 36 0 1 1 14 68 C 14 50 50 12 50 12 Z"
              fill="#3B82F6"
              stroke="#FFFFFF"
              strokeWidth="7"
            />
          </G>
        )}

        {badge === 'dot' && (
          <Circle cx="80" cy="76" r="11" fill="#3B82F6" stroke="#FFFFFF" strokeWidth="4" />
        )}
      </Svg>
    </View>
  );
}
