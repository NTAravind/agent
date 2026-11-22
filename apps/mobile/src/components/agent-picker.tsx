import React from 'react';
import type { Agent } from '@agent/shared';
import { Pressable, ScrollView, StyleSheet, Text, View } from 'react-native';

import { AgentAvatar } from '@/components/agent-avatar';
import { colors, radius, shadow, space } from '@/theme';

type Props = {
  agents: Agent[];
  selectedId: string | null;
  onSelect: (id: string) => void;
};

/**
 * Clean monochrome horizontal capsule row for picking the conversation agent.
 * Conforms to design.md (monochrome, fill only, no dark gradients or borders).
 */
export function AgentPicker({ agents, selectedId, onSelect }: Props) {
  if (agents.length === 0) return null;

  return (
    <ScrollView
      horizontal
      showsHorizontalScrollIndicator={false}
      keyboardShouldPersistTaps="handled"
      contentContainerStyle={styles.container}
    >
      {agents.map((agent) => {
        const selected = agent.id === selectedId;
        return (
          <Pressable
            key={agent.id}
            accessibilityRole="button"
            accessibilityState={{ selected }}
            accessibilityLabel={`Chat with ${agent.name}`}
            onPress={() => onSelect(agent.id)}
            style={({ pressed }) => [
              styles.capsule,
              selected ? styles.capsuleSelected : styles.capsuleUnselected,
              selected && shadow.floating,
              { opacity: pressed ? 0.6 : 1 },
            ]}
          >
            <View style={{ width: 20, height: 20 }}>
              <AgentAvatar avatar={agent.avatar} size={20} />
            </View>
            <Text
              numberOfLines={1}
              style={[
                styles.label,
                selected ? styles.labelSelected : styles.labelUnselected,
              ]}
            >
              {agent.name}
            </Text>
          </Pressable>
        );
      })}
    </ScrollView>
  );
}

const styles = StyleSheet.create({
  container: {
    gap: space.xs,
    paddingHorizontal: space.xs,
    paddingVertical: space.xs,
  },
  capsule: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
    borderRadius: radius.pill,
    paddingHorizontal: 12,
    paddingVertical: 7,
  },
  capsuleSelected: {
    backgroundColor: colors.primary,
  },
  capsuleUnselected: {
    backgroundColor: colors.surface,
  },
  label: {
    fontSize: 13,
    lineHeight: 16,
    maxWidth: 120,
  },
  labelSelected: {
    fontWeight: '600',
    color: colors.onPrimary,
  },
  labelUnselected: {
    fontWeight: '500',
    color: colors.textSecondary,
  },
});
