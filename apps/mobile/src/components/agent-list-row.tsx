import type { Agent } from '@agent/shared';
import { Gesture, GestureDetector } from 'react-native-gesture-handler';
import { Pressable, Text, View } from 'react-native';
import { runOnJS } from 'react-native-reanimated';

import { AgentAvatar } from '@/components/agent-avatar';
import type { RunListItem } from '@/lib/agents';
import { AgentRowActions } from './agent-row-actions';

type Props = {
  agent: Agent;
  /** The agent's active run, when it has one — drives the subtitle. */
  activeRun: RunListItem | null;
  /** Optimistic pause state — flips the pill's pause icon to play. */
  isPaused?: boolean;
  /** Optimistic notification state — flips the pill's bell icon. */
  notificationsEnabled?: boolean;
  onPress: () => void;
  onActionPress: (action: 'pause' | 'skip' | 'notify', agentId: string) => void;
  /** Whether this row's action pill is open (only one row at a time). */
  isActionsOpen: boolean;
  onActionsToggle: (open: boolean) => void;
};

function formatTimestamp(dateStr?: string | null): string {
  if (!dateStr) return '';
  const date = new Date(dateStr);
  if (isNaN(date.getTime())) return '';

  const now = new Date();
  const isToday =
    date.getDate() === now.getDate() &&
    date.getMonth() === now.getMonth() &&
    date.getFullYear() === now.getFullYear();

  if (isToday) {
    return date.toLocaleTimeString([], { hour: 'numeric', minute: '2-digit' });
  }

  const yesterday = new Date(now);
  yesterday.setDate(yesterday.getDate() - 1);
  const isYesterday =
    date.getDate() === yesterday.getDate() &&
    date.getMonth() === yesterday.getMonth() &&
    date.getFullYear() === yesterday.getFullYear();

  if (isYesterday) return 'Yesterday';

  const diffDays = Math.floor((now.getTime() - date.getTime()) / (1000 * 60 * 60 * 24));
  if (diffDays < 7) {
    return date.toLocaleDateString([], { weekday: 'long' });
  }

  return date.toLocaleDateString([], { month: 'short', day: 'numeric' });
}

/**
 * Clean contact list row inspired by the reference design:
 * Creature avatar on the left, agent name over real activity subtitle in the middle,
 * and real timestamp on the right.
 */
export function AgentListRow({
  agent,
  activeRun,
  isPaused = false,
  notificationsEnabled = true,
  onPress,
  onActionPress,
  isActionsOpen,
  onActionsToggle,
}: Props) {
  // Real dynamic activity / preview text
  let subtitle = 'Ready for tasks';
  if (activeRun) {
    if (activeRun.status === 'running') {
      subtitle = `⚡ ${activeRun.goal}`;
    } else if (activeRun.status === 'awaiting_approval') {
      subtitle = `⚠️ Approval: ${activeRun.goal}`;
    } else if (activeRun.status === 'paused') {
      subtitle = `⏸ Paused: ${activeRun.goal}`;
    } else if (activeRun.status === 'succeeded') {
      subtitle = `✓ ${activeRun.goal}`;
    } else {
      subtitle = activeRun.goal;
    }
  } else if (agent.role) {
    subtitle = agent.role;
  } else if (agent.instructions) {
    subtitle = agent.instructions.slice(0, 60);
  }

  const timeDisplay = formatTimestamp(activeRun?.created_at ?? agent.createdAt);

  const swipeGesture = Gesture.Pan()
    .activeOffsetX([-1000, -20])
    .onEnd((event) => {
      if (event.translationX < -40) {
        runOnJS(onActionsToggle)(true);
      }
    });

  return (
    <View className="relative">
      {/* Action pill docked on the right */}
      <View
        className="absolute right-3 top-0 bottom-px justify-center"
        style={{ zIndex: 20 }}
      >
        <AgentRowActions
          isOpen={isActionsOpen}
          onClose={() => onActionsToggle(false)}
          onActionPress={(action) => onActionPress(action, agent.id)}
          isPaused={isPaused}
          notificationsEnabled={notificationsEnabled}
          runActionsDisabled={
            !activeRun ||
            ['succeeded', 'failed', 'cancelled'].includes(activeRun.status)
          }
        />
      </View>

      <GestureDetector gesture={swipeGesture}>
        <Pressable
          onPress={onPress}
          onLongPress={() => onActionsToggle(!isActionsOpen)}
          accessibilityRole="button"
          accessibilityLabel={`${agent.name}, ${subtitle}`}
          accessibilityHint="Double tap to open chat. Long press or swipe left for actions."
          className="flex-row items-center px-4 py-3.5 active:opacity-60"
          style={{ zIndex: 1 }}
        >
          {/* Left Creature Avatar */}
          <View className="mr-3.5">
            <AgentAvatar
              avatar={agent.avatar}
              name={agent.name}
              size={48}
            />
          </View>

          {/* Middle Info */}
          <View className="flex-1 min-w-0 pr-2">
            <Text numberOfLines={1} className="text-[16px] font-semibold text-zinc-900 dark:text-white">
              {agent.name}
            </Text>
            <Text
              numberOfLines={1}
              className="mt-0.5 text-[14px] text-zinc-500 dark:text-zinc-400"
            >
              {subtitle}
            </Text>
          </View>

          {/* Right Timestamp */}
          {timeDisplay ? (
            <View className="items-end justify-center">
              <Text className="text-xs font-medium text-zinc-400 dark:text-zinc-500">
                {timeDisplay}
              </Text>
            </View>
          ) : null}
        </Pressable>
      </GestureDetector>
    </View>
  );
}
