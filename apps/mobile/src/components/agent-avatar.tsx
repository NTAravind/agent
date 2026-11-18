import type { AgentAvatar as AgentAvatarValue } from '@agent/shared';
import { Image } from 'expo-image';
import { useState } from 'react';
import { Text, View } from 'react-native';

type Props = {
  avatar: AgentAvatarValue;
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
  const uri =
    avatar.type === 'image'
      ? (avatar.url ?? (avatar.value.startsWith('http') ? avatar.value : null))
      : null;
  const uriKey = uri ?? avatar.value;

  const showImage = uri !== null && failedKey !== uriKey;
  const glyph = avatar.type === 'image' ? '🤖' : avatar.value;
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
        backgroundColor: avatar.color ?? '#7F9DFF',
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
            fontWeight: avatar.type === 'icon' ? '700' : '400',
          }}
        >
          {glyph}
        </Text>
      )}
    </View>
  );
}
