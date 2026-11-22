
import type { Agent } from '@agent/shared';
import { Pressable, Text, View } from 'react-native';
import { AgentAvatar } from '@/components/agent-avatar';
import { colors, radius } from '@/theme';

type Props = {
  agent: Agent;
  onPress: () => void;
  isPersonal?: boolean;
};

export function AgentTile({ agent, onPress, isPersonal }: Props) {
  return (
    <Pressable
      onPress={onPress}
      accessibilityRole="button"
      accessibilityLabel={
        isPersonal ? `Personal agent: ${agent.name}` : agent.name
      }
      accessibilityHint="Opens chat with this agent"
      style={{ width: 88, alignItems: 'center' }}
    >
      {/* Square avatar */}
      <View
        style={{
          width: 88,
          height: 88,
          borderRadius: radius.card,
          backgroundColor: colors.surface,
          alignItems: 'center',
          justifyContent: 'center',
          overflow: 'hidden',
        }}
      >
        <AgentAvatar
          avatar={agent.avatar}
          name={agent.name}
          size={72}
        />
      </View>

      {/* Agent name */}
      <Text
        numberOfLines={1}
        style={{
          marginTop: 6,
          fontSize: 12,
          fontWeight: '500',
          color: colors.textPrimary,
          textAlign: 'center',
          width: 84,
        }}
      >
        {isPersonal ? 'personal' : agent.name}
      </Text>
    </Pressable>
  );
}
