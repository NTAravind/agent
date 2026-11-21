
import type { Agent } from '@agent/shared';
import { Pressable, Text, View } from 'react-native';
import { AgentAvatar } from '@/components/agent-avatar';

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
      className="items-center active:opacity-60"
      style={{ width: 100 }}
    >
      {/* Square avatar */}
      <View
        className="items-center justify-center overflow-hidden rounded-xl bg-zinc-200 dark:bg-zinc-800"
        style={{ width: 100, height: 100 }}
      >
        <AgentAvatar
          avatar={agent.avatar}
          name={agent.name}
          size={80}
        />
      </View>

      {/* Agent name */}
      <Text
        numberOfLines={1}
        className="mt-1 text-center text-[9px] font-semibold text-zinc-900 dark:text-zinc-200"
        style={{ width: 70 }}
      >
        {isPersonal ? 'personal' : agent.name}
      </Text>
    </Pressable>
  );
}
