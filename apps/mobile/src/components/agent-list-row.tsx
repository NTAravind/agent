import React from 'react';
import type { Agent } from '@agent/shared';
import { Pressable, StyleSheet, Text, View } from 'react-native';
import { Gesture, GestureDetector } from 'react-native-gesture-handler';
import { runOnJS } from 'react-native-reanimated';

import { AgentAvatar, ClusterAvatar, type ClusterAvatarMember } from '@/components/agent-avatar';
import { colors, radius, space, typography } from '@/theme';
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
  /** Group members if this is a group conversation row */
  isGroup?: boolean;
  groupMembers?: ClusterAvatarMember[];
  tag?: string | null;
  lastMessage?: string | null;
  timestamp?: string | null;
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
    return date.toLocaleDateString([], { weekday: 'short' });
  }

  return date.toLocaleDateString([], { month: 'short', day: 'numeric' });
}

/**
 * 6.10 Feed / chat list screen row conforming to design.md:
 * - 64pt avatar (or 2-bubble cluster for groups)
 * - Name 20/500, optional tag pill (surface fill, 15pt textSecondary)
 * - Timestamp in 15pt textSecondary
 * - Single-line preview in 17/400 textSecondary
 * - Calm copy (no emoji badges, no AI decorations)
 * - No card background around rows, no borders
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
  isGroup = false,
  groupMembers,
  tag,
  lastMessage,
  timestamp,
}: Props) {
  // Calm copy preview (no emoji icons per Section 2 & 5)
  let subtitle = lastMessage ?? 'Ready for tasks';
  if (!lastMessage && activeRun) {
    if (activeRun.status === 'running') {
      subtitle = activeRun.goal;
    } else if (activeRun.status === 'awaiting_approval') {
      subtitle = `Approval required: ${activeRun.goal}`;
    } else if (activeRun.status === 'paused') {
      subtitle = `Paused: ${activeRun.goal}`;
    } else if (activeRun.status === 'succeeded') {
      subtitle = activeRun.goal;
    } else {
      subtitle = activeRun.goal;
    }
  } else if (!lastMessage && agent.role) {
    subtitle = agent.role;
  } else if (!lastMessage && agent.instructions) {
    subtitle = agent.instructions.slice(0, 60);
  }

  // Show badge only when it adds information (e.g. Group chat); hide if it duplicates subtitle/role
  const informativeTag = isGroup
    ? 'Group chat'
    : tag && tag !== agent.role && tag !== subtitle
    ? tag
    : null;
  const timeDisplay = formatTimestamp(timestamp ?? activeRun?.created_at ?? agent.createdAt);

  const swipeGesture = Gesture.Pan()
    .activeOffsetX([-1000, -20])
    .onEnd((event) => {
      if (event.translationX < -40) {
        runOnJS(onActionsToggle)(true);
      }
    });

  return (
    <View style={styles.container}>
      {/* Action pill docked on right */}
      <View style={styles.actionsDock}>
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
          accessibilityHint="Tap to open chat. Long press or swipe left for actions."
          style={({ pressed }) => [styles.row, { opacity: pressed ? 0.6 : 1 }]}
        >
          {/* 64pt avatar (or cluster for groups) — DESIGN.md 6.10 */}
          <View style={styles.avatarWrapper}>
            {isGroup ? (
              <ClusterAvatar size={64} members={groupMembers} />
            ) : (
              <AgentAvatar
                avatar={agent.avatar}
                name={agent.name}
                size={64}
                showStatusDot={Boolean(activeRun && activeRun.status === 'running')}
              />
            )}
          </View>

          {/* Middle info */}
          <View style={styles.content}>
            <View style={styles.titleRow}>
              <View style={styles.nameBadgeContainer}>
                <Text numberOfLines={1} style={styles.name}>
                  {agent.name}
                </Text>
                {informativeTag ? (
                  <View style={styles.tagPill}>
                    <Text numberOfLines={1} style={styles.tagText}>
                      {informativeTag}
                    </Text>
                  </View>
                ) : null}
              </View>

              {/* Right timestamp aligned to same baseline as agent name */}
              {timeDisplay ? (
                <Text style={styles.timeText}>{timeDisplay}</Text>
              ) : null}
            </View>

            {/* Single-line preview */}
            <Text numberOfLines={1} style={styles.preview}>
              {subtitle}
            </Text>
          </View>
        </Pressable>
      </GestureDetector>

      <View style={styles.divider} />
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    position: 'relative',
    width: '100%',
  },
  actionsDock: {
    position: 'absolute',
    right: space.md,
    top: 0,
    bottom: StyleSheet.hairlineWidth,
    justifyContent: 'center',
    zIndex: 20,
  },
  row: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingHorizontal: space.lg,
    paddingVertical: 10,
    zIndex: 1,
  },
  avatarWrapper: {
    marginRight: space.md,
    width: 64,
    height: 64,
    alignItems: 'center',
    justifyContent: 'center',
  },
  content: {
    flex: 1,
    minWidth: 0,
    justifyContent: 'center',
  },
  titleRow: {
    flexDirection: 'row',
    alignItems: 'baseline',
    justifyContent: 'space-between',
    gap: space.xs,
  },
  nameBadgeContainer: {
    flex: 1,
    minWidth: 0,
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
    paddingRight: space.xs,
  },
  name: {
    fontSize: 17,
    lineHeight: 22,
    fontWeight: '600',
    color: colors.textPrimary,
    flexShrink: 1,
  },
  tagPill: {
    backgroundColor: colors.surface,
    paddingHorizontal: 8,
    paddingVertical: 2,
    borderRadius: radius.pill,
    flexShrink: 0,
    maxWidth: 120,
  },
  tagText: {
    fontSize: 12,
    lineHeight: 16,
    fontWeight: '500',
    color: colors.textSecondary,
  },
  preview: {
    marginTop: 2,
    fontSize: 15,
    lineHeight: 20,
    fontWeight: '400',
    color: colors.textSecondary,
  },
  timeText: {
    fontSize: 13,
    lineHeight: 18,
    fontWeight: '400',
    color: colors.textSecondary,
    fontVariant: ['tabular-nums'],
    flexShrink: 0,
  },
  divider: {
    height: StyleSheet.hairlineWidth,
    backgroundColor: colors.divider,
    marginLeft: 92,
  },
});
