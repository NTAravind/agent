import type { Agent } from '@agent/shared';
import { Pressable, ScrollView, Text } from 'react-native';

import { AgentAvatar } from '@/components/agent-avatar';

type Props = {
  agents: Agent[];
  selectedId: string | null;
  onSelect: (id: string) => void;
};

/**
 * Horizontal chip row for picking the agent a conversation or task belongs
 * to (the composer's agent selector). Renders nothing until agents load.
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
            className={`flex-row items-center gap-2 rounded-full border border-border px-3 py-1.5 active:opacity-60 ${
              selected ? 'bg-surface' : 'bg-background'
            }`}
          >
            <AgentAvatar avatar={agent.avatar} size={20} />
            <Text
              numberOfLines={1}
              className={`max-w-32 text-sm ${selected ? 'font-semibold text-foreground' : 'text-muted'}`}
            >
              {agent.name}
            </Text>
          </Pressable>
        );
      })}
    </ScrollView>
  );
}
