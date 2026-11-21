import type { Agent } from '@agent/shared';
import { Pressable, ScrollView, Text } from 'react-native';

import { AgentAvatar } from '@/components/agent-avatar';

type Props = {
  agents: Agent[];
  selectedId: string | null;
  onSelect: (id: string) => void;
};

/**
 * Grok-inspired horizontal capsule row for picking the conversation agent.
 */
export function AgentPicker({ agents, selectedId, onSelect }: Props) {
  if (agents.length === 0) return null;

  return (
    <ScrollView
      horizontal
      showsHorizontalScrollIndicator={false}
      keyboardShouldPersistTaps="handled"
      contentContainerStyle={{ gap: 8, paddingHorizontal: 4, paddingVertical: 6 }}
    >
      {agents.map((agent) => {
        const selected = agent.id === selectedId;
        return (
          <Pressable
            key={agent.id}
            accessibilityRole="button"
            accessibilityState={{ selected }}
            accessibilityLabel={`Chat as ${agent.name}`}
            onPress={() => onSelect(agent.id)}
            className={`flex-row items-center gap-2 rounded-full border px-3 py-1.5 active:opacity-75 ${
              selected
                ? 'border-white/30 bg-white/15 shadow-sm'
                : 'border-white/10 bg-white/5'
            }`}
          >
            <AgentAvatar avatar={agent.avatar} size={20} />
            <Text
              numberOfLines={1}
              className={`max-w-32 text-xs ${selected ? 'font-semibold text-white' : 'text-zinc-400'}`}
            >
              {agent.name}
            </Text>
          </Pressable>
        );
      })}
    </ScrollView>
  );
}
