import type { AgentAvatar as AgentAvatarValue } from '@agent/shared';
import { DEFAULT_AGENT_AVATAR } from '@agent/shared';
import { Image } from 'expo-image';
import { useState } from 'react';
import { Text, View } from 'react-native';

type Props = {
  /**
   * Missing/invalid avatars fall back to the default emoji — an older API
   * response or a row without an avatar must never crash the list.
   */
  avatar?: AgentAvatarValue | null;
  /** Diameter in points — 24 in timelines, 32 in lists/chat, 56 in the editor. */
  size?: number;
};

/**
 * Agent identity badge.
 *  - emoji / icon: the glyph on the avatar's color disc (icons render bold)
 *  - image: the signed Storage URL from the API, falling back to the default
 *    emoji when the image fails to load ("missing avatar → emoji").
 */
export function AgentAvatar({ avatar, size = 32 }: Props) {
  // The key of the image that failed to load; deriving `failed` during render
  // keeps this reactive without a setState-in-effect.
  const [failedKey, setFailedKey] = useState<string | null>(null);
  const value = avatar ?? DEFAULT_AGENT_AVATAR;
  const uri =
    value.type === 'image'
      ? (value.url ?? (value.value.startsWith('http') ? value.value : null))
      : null;
  const uriKey = uri ?? value.value;

  const showImage = uri !== null && failedKey !== uriKey;
  const glyph = value.type === 'image' ? '🤖' : value.value;
  const fontSize = Math.round(size * 0.55);

  return (
    <View
      accessibilityLabel={
        showImage ? 'Agent avatar image' : `Agent avatar ${glyph}`
      }
      style={{
        width: size,
        height: size,
        borderRadius: size / 2,
        backgroundColor: value.color ?? '#7F9DFF',
        alignItems: 'center',
        justifyContent: 'center',
        overflow: 'hidden',
      }}
    >
      {showImage && uri ? (
        <Image
          source={{ uri }}
          style={{ width: size, height: size }}
          contentFit="cover"
          transition={150}
          onError={() => setFailedKey(uriKey)}
        />
      ) : (
        <Text
          style={{
            fontSize,
            lineHeight: Math.round(size * 0.66),
            fontWeight: value.type === 'icon' ? '700' : '400',
          }}
        >
          {glyph}
        </Text>
      )}
    </View>
  );
}
