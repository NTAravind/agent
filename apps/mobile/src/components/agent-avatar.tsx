import type { AgentAvatar as AgentAvatarValue } from '@agent/shared';
import { Text, View } from 'react-native';

type Props = {
  avatar: AgentAvatarValue;
  /** Diameter in points — 24 in timelines, 32 in lists/chat, 56 in the editor. */
  size?: number;
};

/**
 * Agent identity badge. Emoji and icon avatars render as a glyph on the
 * avatar's color disc. Image avatars fall back to the default emoji until
 * their Storage path is resolved (see the editor's Upload flow).
 */
export function AgentAvatar({ avatar, size = 32 }: Props) {
  const isImage = avatar.type === 'image';
  const glyph = isImage || !avatar.value ? '🤖' : avatar.value;

  return (
    <View
      accessibilityLabel={isImage ? 'Agent avatar image' : `Agent avatar ${glyph}`}
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
      <Text style={{ fontSize: Math.round(size * 0.55), lineHeight: Math.round(size * 0.66) }}>
        {glyph}
      </Text>
    </View>
  );
}
