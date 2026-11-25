import React, { useState } from 'react';
import type { AgentAvatar as AgentAvatarValue } from '@agent/shared';
import { DEFAULT_AGENT_AVATAR } from '@agent/shared';
import { Image } from 'expo-image';
import { View } from 'react-native';
import Svg, { Circle, Ellipse, G, Path, Polygon, Rect } from 'react-native-svg';
import { Bot, Code, Compass, FileText, Globe, LayoutDashboard, Search, Terminal, User, Wrench, Zap } from 'lucide-react-native';
import { colors, radius } from '@/theme';

export const AVATAR_ICONS: Record<string, any> = {
  bot: Bot,
  code: Code,
  compass: Compass,
  document: FileText,
  globe: Globe,
  dashboard: LayoutDashboard,
  search: Search,
  terminal: Terminal,
  user: User,
  wrench: Wrench,
  zap: Zap,
};

export type CreatureShape =
  | 'circle'
  | 'blob'
  | 'droplet'
  | 'squircle'
  | 'pill'
  | 'triangle'
  | 'hexagon'
  | 'cloud'
  | 'drop'
  | 'teardrop'
  | 'ghost';

export const CREATURE_SHAPES: CreatureShape[] = [
  'circle',
  'blob',
  'squircle',
  'pill',
  'triangle',
  'hexagon',
  'cloud',
  'drop',
  'ghost',
];

/**
 * Marks offered in the avatar pickers. The lists above still render every
 * mark — existing agents keep theirs and Pacbot keeps its ghost — but the
 * generic bot/zap icons and Pacbot's ghost shape are not offered as choices.
 */
export const PICKABLE_AVATAR_ICONS = Object.keys(AVATAR_ICONS).filter(
  (key) => key !== 'bot' && key !== 'zap',
);

export const PICKABLE_CREATURE_SHAPES = CREATURE_SHAPES.filter(
  (shape) => shape !== 'ghost',
);

export const PALETTE_COLORS: string[] = [
  colors.mark.black,
  colors.mark.brown,
  colors.mark.red,
  colors.mark.orange,
  colors.mark.amber,
  colors.mark.green,
  colors.mark.teal,
  colors.mark.blue,
  colors.mark.purple,
  colors.mark.pink,
  colors.mark.gray,
];

export function deriveCreatureConfig(
  identifier?: string | null,
  customColor?: string,
): { shape: CreatureShape; color: string } {
  const normalized = (identifier ?? '').trim().toLowerCase();

  if (normalized.includes('slmob') || normalized.includes('meal')) {
    return { shape: 'triangle', color: customColor ?? colors.mark.green };
  }
  if (normalized.includes('chief') || normalized.includes('staff')) {
    return { shape: 'drop', color: customColor ?? colors.mark.orange };
  }
  if (normalized.includes('design')) {
    return { shape: 'circle', color: customColor ?? colors.mark.black };
  }
  if (normalized.includes('ux') || normalized.includes('research')) {
    return { shape: 'pill', color: customColor ?? colors.mark.orange };
  }
  if (normalized.includes('inbox') || normalized.includes('triage')) {
    return { shape: 'squircle', color: customColor ?? colors.mark.gray };
  }
  if (normalized.includes('ghost') || normalized.includes('spooky') || normalized.includes('boo')) {
    return { shape: 'ghost', color: customColor ?? colors.mark.purple };
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

/**
 * 7. Agent Marks (the characters)
 * Every agent has a flat-colored shape with two small white slanted highlight marks
 * near the upper right, reading as eyes. Single <AgentMark shape color size /> component.
 */
export function AgentMark({
  shape = 'circle',
  color = colors.mark.green,
  size = 36,
}: {
  shape?: CreatureShape;
  color?: string;
  size?: number;
}) {
  const normShape = shape === 'droplet' || shape === 'teardrop' ? 'drop' : shape;

  let eyeX = 54;
  let eyeY = 44;

  if (normShape === 'drop') {
    eyeX = 46;
    eyeY = 56;
  } else if (normShape === 'triangle') {
    eyeX = 52;
    eyeY = 54;
  } else if (normShape === 'pill') {
    eyeX = 54;
    eyeY = 48;
  } else if (normShape === 'blob') {
    eyeX = 52;
    eyeY = 50;
  } else if (normShape === 'cloud') {
    eyeX = 52;
    eyeY = 48;
  } else if (normShape === 'hexagon') {
    eyeX = 52;
    eyeY = 48;
  } else if (normShape === 'squircle') {
    eyeX = 52;
    eyeY = 46;
  }

  return (
    <View style={{ width: size, height: size, alignItems: 'center', justifyContent: 'center' }}>
      <Svg width={size} height={size} viewBox="0 0 100 100">
        {/* Flat colored body - no gradients, no borders */}
        {normShape === 'circle' && <Circle cx="50" cy="50" r="44" fill={color} />}

        {normShape === 'blob' && <Ellipse cx="50" cy="52" rx="42" ry="38" fill={color} />}

        {normShape === 'drop' && (
          <Path
            d="M 50 12 C 40 26 16 52 16 70 A 34 34 0 0 0 84 70 C 84 52 60 26 50 12 Z"
            fill={color}
          />
        )}

        {normShape === 'cloud' && (
          <Path
            d="M 28 72 A 20 20 0 0 1 16 46 A 22 22 0 0 1 42 28 A 24 24 0 0 1 76 34 A 20 20 0 0 1 84 56 A 18 18 0 0 1 74 72 Z"
            fill={color}
          />
        )}

        {normShape === 'squircle' && (
          <Rect x="12" y="12" width="76" height="76" rx="26" ry="26" fill={color} />
        )}

        {normShape === 'pill' && (
          <Rect x="6" y="24" width="88" height="52" rx="26" fill={color} />
        )}

        {normShape === 'triangle' && (
          <Path
            d="M 50 16 C 54 16 58 22 84 68 C 88 74 84 82 76 82 L 24 82 C 16 82 12 74 16 68 C 42 22 46 16 50 16 Z"
            fill={color}
          />
        )}

        {normShape === 'hexagon' && (
          <Polygon points="50,12 85,30 85,70 50,88 15,70 15,30" fill={color} />
        )}

        {normShape === 'ghost' && (
          <>
            <Path
              d="M 50.11 14.7 C 55.94 14.36 62.81 15.33 68.22 18.88 C 73.63 22.42 79.53 30.08 82.59 35.97 C 85.65 41.85 85.81 49.49 86.55 54.19 C 87.28 58.88 86.92 60.77 87.0 64.14 C 87.08 67.52 88.13 71.48 87.0 74.44 C 85.87 77.4 82.06 80.91 80.21 81.91 C 78.36 82.91 77.36 81.31 75.91 80.44 C 74.46 79.57 72.97 77.57 71.5 76.7 C 70.03 75.83 68.77 75.1 67.09 75.23 C 65.41 75.36 63.32 76.2 61.43 77.5 C 59.54 78.8 57.68 81.74 55.77 83.04 C 53.87 84.34 51.91 85.28 50.0 85.3 C 48.09 85.32 46.11 84.47 44.34 83.15 C 42.57 81.83 41.15 78.7 39.36 77.38 C 37.57 76.06 35.31 75.34 33.59 75.23 C 31.88 75.12 30.6 75.87 29.07 76.7 C 27.54 77.53 25.98 79.34 24.43 80.21 C 22.88 81.08 21.68 82.81 19.79 81.91 C 17.9 81.0 14.09 77.67 13.11 74.78 C 12.13 71.89 13.47 67.96 13.91 64.6 C 14.35 61.24 14.61 59.11 15.72 54.64 C 16.83 50.17 17.66 43.4 20.58 37.78 C 23.5 32.16 28.33 24.77 33.25 20.92 C 38.17 17.07 44.28 15.04 50.11 14.7 Z"
              fill={color}
            />
            {/* White eyeballs */}
            <Ellipse cx="53.3" cy="42.3" rx="9.7" ry="10.7" fill={colors.onPrimary} />
            <Ellipse cx="73.3" cy="42.3" rx="8.2" ry="10.1" fill={colors.onPrimary} />
            {/* Dark pupils looking to the right */}
            <Ellipse cx="59.4" cy="42.0" rx="3.5" ry="4.2" fill={colors.primary} />
            <Ellipse cx="78.2" cy="42.0" rx="3.1" ry="4.1" fill={colors.primary} />
          </>
        )}

        {/* Highlights: two short, rounded, white strokes tilted ~20 deg at upper right (for standard shapes) */}
        {normShape !== 'ghost' && (
          <G transform={`translate(${eyeX}, ${eyeY}) rotate(-20)`}>
            <Rect x="-8" y="-7" width="5.5" height="15" rx="2.75" fill={colors.onPrimary} />
            <Rect x="4" y="-7" width="5.5" height="15" rx="2.75" fill={colors.onPrimary} />
          </G>
        )}
      </Svg>
    </View>
  );
}

type AvatarProps = {
  avatar?: AgentAvatarValue | null;
  size?: number;
  shape?: 'circle' | 'rounded' | 'creature';
  name?: string | null;
  forcedShape?: CreatureShape;
  forcedColor?: string;
  showStatusDot?: boolean;
};

/**
 * Universal Agent Avatar Component conforming to design.md
 */
export function AgentAvatar({
  avatar,
  size = 36,
  shape = 'circle',
  name,
  forcedShape,
  forcedColor,
  showStatusDot = false,
}: AvatarProps) {
  const [failedKey, setFailedKey] = useState<string | null>(null);
  const value = avatar ?? DEFAULT_AGENT_AVATAR;

  const uri =
    value.type === 'image'
      ? (value.url ?? (value.value.startsWith('http') ? value.value : null))
      : null;
  const uriKey = uri ?? value.value;
  const showImage = uri !== null && failedKey !== uriKey && !forcedShape;

  if (showImage && uri) {
    const borderRadius = shape === 'circle' ? size / 2 : radius.card;
    return (
      <View style={{ width: size, height: size }}>
        <View
          style={{
            width: size,
            height: size,
            borderRadius,
            overflow: 'hidden',
            backgroundColor: value.color ?? colors.surface,
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
        {showStatusDot && <StatusDot size={size} />}
      </View>
    );
  }

  const creature = deriveCreatureConfig(name ?? value.value, forcedColor ?? value.color);
  const finalShape = forcedShape ?? (CREATURE_SHAPES.includes(value.value as CreatureShape) ? (value.value as CreatureShape) : creature.shape);
  const finalColor = forcedColor ?? creature.color;

  return (
    <View style={{ width: size, height: size, position: 'relative' }}>
      <AgentMark shape={finalShape} color={finalColor} size={size} />
      {showStatusDot && <StatusDot size={size} />}
    </View>
  );
}

function StatusDot({ size }: { size: number }) {
  const dotSize = Math.max(12, Math.round(size * 0.22));
  return (
    <View
      style={{
        position: 'absolute',
        bottom: 0,
        right: 0,
        width: dotSize,
        height: dotSize,
        borderRadius: radius.pill,
        backgroundColor: colors.success,
        // DESIGN.md 6.10: 3pt white ring at 64pt, scaling down for smaller slots.
        borderWidth: Math.max(2, Math.round(size * 0.047)),
        borderColor: colors.surfaceRaised,
      }}
    />
  );
}

/**
 * A group member as rendered in a group profile collage. Accepts either the
 * raw group-member shape (`{ agentId, agent: { avatar, name } }`) or a flat
 * `{ id, avatar, name }` shape.
 */
export type ClusterAvatarMember = {
  id?: string;
  agentId?: string;
  avatar?: AgentAvatarValue | null;
  name?: string;
  agent?: { avatar?: AgentAvatarValue | null; name?: string } | null;
};

/**
 * 6.10 A group profile is a collage of its members' avatars arranged as a
 * triangle (one on top, two below) inside one avatar slot.
 *
 * A group with fewer members shows only its real avatars — it is never padded
 * with generic marks. With no members at all it falls back to the legacy
 * coloured marks.
 */
export function ClusterAvatar({
  size = 64,
  members = [],
}: {
  size?: number;
  members?: ClusterAvatarMember[];
}) {
  const markSize = Math.round(size * 0.54);

  // Normalise both accepted shapes into one list of { avatar, name }.
  const realAvatars = members.slice(0, 3).map((member, index) => {
    const nested = 'agent' in member ? member.agent : undefined;
    return {
      avatar: member.avatar ?? nested?.avatar ?? null,
      name: member.name ?? nested?.name ?? `Member ${index + 1}`,
    };
  });

  const fallbackMarks: { shape: CreatureShape; color: string }[] = [
    { shape: 'pill', color: colors.mark.orange },
    { shape: 'circle', color: colors.mark.black },
    { shape: 'drop', color: colors.mark.orange },
  ];

  if (realAvatars.length === 0) {
    // No members yet: the legacy three-mark placeholder.
    return (
      <View
        style={{
          width: size,
          height: size,
          position: 'relative',
          alignItems: 'center',
          justifyContent: 'center',
        }}
      >
        <View style={{ position: 'absolute', top: 0, alignSelf: 'center', zIndex: 1 }}>
          <AgentMark shape={fallbackMarks[0].shape} color={fallbackMarks[0].color} size={markSize} />
        </View>
        <View style={{ position: 'absolute', bottom: 0, left: 1, zIndex: 2 }}>
          <AgentMark shape={fallbackMarks[1].shape} color={fallbackMarks[1].color} size={markSize} />
        </View>
        <View style={{ position: 'absolute', bottom: 0, right: 1, zIndex: 3 }}>
          <AgentMark shape={fallbackMarks[2].shape} color={fallbackMarks[2].color} size={markSize} />
        </View>
      </View>
    );
  }

  // One member: a single, full-size avatar.
  if (realAvatars.length === 1) {
    return (
      <View
        style={{
          width: size,
          height: size,
          alignItems: 'center',
          justifyContent: 'center',
        }}
      >
        <AgentAvatar avatar={realAvatars[0].avatar} name={realAvatars[0].name} size={size} />
      </View>
    );
  }

  // Two members: side by side.
  if (realAvatars.length === 2) {
    return (
      <View
        style={{
          width: size,
          height: size,
          flexDirection: 'row',
          alignItems: 'center',
          justifyContent: 'center',
        }}
      >
        <AgentAvatar avatar={realAvatars[0].avatar} name={realAvatars[0].name} size={markSize} />
        <AgentAvatar avatar={realAvatars[1].avatar} name={realAvatars[1].name} size={markSize} />
      </View>
    );
  }

  // Three or more: the triangle collage.
  return (
    <View
      style={{
        width: size,
        height: size,
        position: 'relative',
        alignItems: 'center',
        justifyContent: 'center',
      }}
    >
      {/* Top member */}
      <View style={{ position: 'absolute', top: 0, alignSelf: 'center', zIndex: 1 }}>
        <AgentAvatar avatar={realAvatars[0].avatar} name={realAvatars[0].name} size={markSize} />
      </View>

      {/* Bottom left member */}
      <View style={{ position: 'absolute', bottom: 0, left: 1, zIndex: 2 }}>
        <AgentAvatar avatar={realAvatars[1].avatar} name={realAvatars[1].name} size={markSize} />
      </View>

      {/* Bottom right member */}
      <View style={{ position: 'absolute', bottom: 0, right: 1, zIndex: 3 }}>
        <AgentAvatar avatar={realAvatars[2].avatar} name={realAvatars[2].name} size={markSize} />
      </View>
    </View>
  );
}
