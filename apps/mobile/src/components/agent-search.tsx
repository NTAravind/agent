import { useState } from 'react';
import { Pressable, Text, View } from 'react-native';
import { BottomSheet, Button, SearchField, Typography } from 'heroui-native';
import type { Agent } from '@agent/shared';

import { AgentAvatar } from '@/components/agent-avatar';
import { AGENT_LIST_AVATAR_SIZE } from '@/constants/icons';
import type { RunListItem } from '@/lib/agents';

type Props = {
  agents: Agent[];
  runs: RunListItem[];
  /** Called with the tapped agent id; the sheet closes itself. */
  onSelect: (agentId: string) => void;
  onClose: () => void;
  isOpen: boolean;
};

/**
 * Agent search: a HeroUI BottomSheet with a SearchField that filters the
 * agent list by name, role or current activity (the active run's goal).
 */
export function AgentSearch({ agents, runs, onSelect, onClose, isOpen }: Props) {
  const [query, setQuery] = useState('');

  /** An agent's current activity: its active run's goal, else the role. */
  const activityFor = (agent: Agent): string => {
    const active = runs.find(
      (run) =>
        run.agent_id === agent.id &&
        !['succeeded', 'failed', 'cancelled'].includes(run.status),
    );
    if (!active) return agent.role ?? 'Idle';
    return active.status === 'paused' ? `⏸ Paused: ${active.goal}` : active.goal;
  };

  const q = query.trim().toLowerCase();
  const filteredAgents = agents.filter((agent) => {
    if (!q) return true;
    return (
      agent.name.toLowerCase().includes(q) ||
      (agent.role ?? '').toLowerCase().includes(q) ||
      activityFor(agent).toLowerCase().includes(q)
    );
  });

  return (
    <BottomSheet
      isOpen={isOpen}
      onOpenChange={(open: boolean) => {
        if (!open) {
          setQuery('');
          onClose();
        }
      }}
    >
      <BottomSheet.Portal>
        <BottomSheet.Overlay />
        <BottomSheet.Content
          snapPoints={['50%', '90%']}
          enableOverDrag={false}
          enableDynamicSizing={false}
          contentContainerClassName="h-full"
        >
          <BottomSheet.Close />
          <BottomSheet.Title>Search agents</BottomSheet.Title>
          <BottomSheet.Description>Find an agent by name, role or current activity.</BottomSheet.Description>

          <View className="gap-3 px-4 pb-4 flex-1">
            <SearchField value={query} onChange={setQuery}>
              <SearchField.Group>
                <SearchField.Input
                  placeholder="e.g. researcher, steak, idle"
                  accessibilityLabel="Search agents"
                  accessibilityHint="Filters the list below by name, role or current activity"
                  autoFocus
                />
                <SearchField.ClearButton accessibilityLabel="Clear search" />
              </SearchField.Group>
            </SearchField>

            <Typography type="body-xs" color="muted">
              {filteredAgents.length} agent{filteredAgents.length === 1 ? '' : 's'}
            </Typography>

            <View className="flex-1 gap-2">
              {filteredAgents.length === 0 ? (
                <View className="flex-1 items-center justify-center">
                  <Typography type="body" color="muted">
                    {q ? 'No agents match your search' : 'No agents yet'}
                  </Typography>
                </View>
              ) : (
                filteredAgents.map((agent) => {
                  const activityText = activityFor(agent);

                  return (
                    <Pressable
                      key={agent.id}
                      onPress={() => {
                        onSelect(agent.id);
                        setQuery('');
                        onClose();
                      }}
                      accessibilityRole="button"
                      accessibilityLabel={`${agent.name}, ${activityText}`}
                      accessibilityHint="Opens a chat with this agent"
                      className="flex-row items-center gap-3 rounded-xl border border-border bg-surface px-3 py-2.5 active:opacity-70"
                    >
                      <AgentAvatar avatar={agent.avatar} size={AGENT_LIST_AVATAR_SIZE} />
                      <View className="flex-1 min-w-0 gap-0.5">
                        <Text className="text-sm font-semibold text-foreground" numberOfLines={1}>
                          {agent.name}
                        </Text>
                        <Text className="text-xs text-muted" numberOfLines={1}>
                          {activityText}
                        </Text>
                      </View>
                    </Pressable>
                  );
                })
              )}
            </View>

            <Button variant="secondary" onPress={() => { setQuery(''); onClose(); }}>
              <Button.Label>Close</Button.Label>
            </Button>
          </View>
        </BottomSheet.Content>
      </BottomSheet.Portal>
    </BottomSheet>
  );
}