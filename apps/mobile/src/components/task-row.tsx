import React from 'react';
import type { Task } from '@agent/shared';
import { Check, Circle, X } from 'lucide-react-native';
import { SymbolIcon } from '@/components/symbol-icon';
import { Pressable, StyleSheet, Text, View } from 'react-native';

import { colors, radius, space } from '@/theme';
import { formatDayLabel, formatTime } from '@/lib/dates';
import { hapticTap } from '@/lib/haptics';

export type TaskRowProps = {
  task: Task;
  /** Toggle completion (done / open). */
  onToggle?: (task: Task) => void;
  /** Open the task (e.g. to edit it). */
  onPress?: (task: Task) => void;
  /** Accept a suggested task (suggested → open). */
  onAccept?: (task: Task) => void;
  /** Dismiss a suggested task. */
  onDismiss?: (task: Task) => void;
  /** Show the list name under the title. */
  listName?: string;
};

/**
 * One task in a list conforming to design.md:
 * - Monochrome surfaces and text
 * - Clean 17/22 body text with line-through when done
 * - Clean circular checkbox
 */
export function TaskRow({
  task,
  onToggle,
  onPress,
  onAccept,
  onDismiss,
  listName,
}: TaskRowProps) {
  const done = task.status === 'done';
  const suggested = task.createdBy === 'suggested';

  const dueLabel = task.dueAt
    ? `${formatDayLabel(task.dueAt)} · ${formatTime(task.dueAt)}`
    : null;

  return (
    <View style={styles.container}>
      <Pressable
        onPress={() => {
          // DESIGN.md §9: a light haptic on option selection — ticking a
          // task off is a committed change.
          hapticTap();
          onToggle?.(task);
        }}
        accessibilityRole="checkbox"
        accessibilityState={{ checked: done }}
        accessibilityLabel={done ? `Reopen ${task.title}` : `Complete ${task.title}`}
        style={styles.checkboxTouch}
        hitSlop={8}
      >
        {done ? (
          <View style={styles.checkboxDone}>
            <SymbolIcon icon={Check} size={12} color={colors.onPrimary} strokeWidth={3} />
          </View>
        ) : (
          <SymbolIcon icon={Circle} size={20} color={colors.textSecondary} strokeWidth={1.75} />
        )}
      </Pressable>

      <Pressable onPress={() => onPress?.(task)} style={styles.content}>
        <View style={styles.titleRow}>
          <Text
            style={[
              styles.title,
              done && styles.titleDone,
            ]}
          >
            {task.title}
          </Text>
          {suggested ? (
            <View style={styles.suggestedBadge}>
              <Text style={styles.suggestedText}>Suggested</Text>
            </View>
          ) : null}
        </View>

        {dueLabel || listName ? (
          <Text style={styles.subtitle}>
            {dueLabel ?? ''}
            {dueLabel && listName ? ' · ' : ''}
            {listName ?? ''}
          </Text>
        ) : null}
      </Pressable>

      {suggested ? (
        <View style={styles.actions}>
          <Pressable
            onPress={() => onAccept?.(task)}
            accessibilityRole="button"
            accessibilityLabel={`Accept ${task.title}`}
            style={({ pressed }) => [styles.actionButton, { opacity: pressed ? 0.6 : 1 }]}
            hitSlop={6}
          >
            <SymbolIcon icon={Check} size={14} color={colors.success} strokeWidth={2.5} />
          </Pressable>
          <Pressable
            onPress={() => onDismiss?.(task)}
            accessibilityRole="button"
            accessibilityLabel={`Dismiss ${task.title}`}
            style={({ pressed }) => [styles.actionButton, { opacity: pressed ? 0.6 : 1 }]}
            hitSlop={6}
          >
            <SymbolIcon icon={X} size={14} color={colors.textSecondary} strokeWidth={2} />
          </Pressable>
        </View>
      ) : null}
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    flexDirection: 'row',
    alignItems: 'flex-start',
    gap: space.md,
    paddingHorizontal: space.lg,
    paddingVertical: space.md,
  },
  checkboxTouch: {
    marginTop: 2,
    alignItems: 'center',
    justifyContent: 'center',
  },
  checkboxDone: {
    width: 20,
    height: 20,
    borderRadius: radius.pill,
    backgroundColor: colors.primary,
    alignItems: 'center',
    justifyContent: 'center',
  },
  content: {
    flex: 1,
    minWidth: 0,
    gap: 3,
  },
  titleRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
    flexWrap: 'wrap',
  },
  title: {
    fontSize: 17,
    lineHeight: 22,
    fontWeight: '400',
    color: colors.textPrimary,
  },
  titleDone: {
    color: colors.textSecondary,
    textDecorationLine: 'line-through',
  },
  suggestedBadge: {
    borderRadius: radius.pill,
    backgroundColor: colors.surface,
    paddingHorizontal: 8,
    paddingVertical: 2,
  },
  suggestedText: {
    fontSize: 13,
    lineHeight: 18,
    color: colors.textSecondary,
    fontWeight: '400',
  },
  subtitle: {
    fontSize: 15,
    lineHeight: 20,
    color: colors.textSecondary,
    fontVariant: ['tabular-nums'],
  },
  actions: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: space.xs,
  },
  actionButton: {
    width: 32,
    height: 32,
    borderRadius: radius.pill,
    backgroundColor: colors.surface,
    alignItems: 'center',
    justifyContent: 'center',
  },
});
