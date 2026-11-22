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
  | 'teardrop';

export const CREATURE_SHAPES: CreatureShape[] = [
  'circle',
  'blob',
  'squircle',
  'pill',
  'triangle',
  'hexagon',
  'cloud',
  'drop',
];

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

        {/* Highlights: two short, rounded, white strokes tilted ~20 deg at upper right */}
        <G transform={`translate(${eyeX}, ${eyeY}) rotate(-20)`}>
          <Rect x="-8" y="-7" width="5.5" height="15" rx="2.75" fill="#FFFFFF" />
          <Rect x="4" y="-7" width="5.5" height="15" rx="2.75" fill="#FFFFFF" />
        </G>
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
        borderWidth: 2.5,
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
