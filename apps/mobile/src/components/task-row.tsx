import type { Task } from '@agent/shared';
import { Check, Circle, Sparkles, X } from 'lucide-react-native';
import { Pressable, Text, View } from 'react-native';

import { formatDayLabel, formatTime } from '@/lib/dates';

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

const PRIORITY_COLORS: Record<number, string> = {
  1: '#3b82f6',
  2: '#f59e0b',
  3: '#ef4444',
};

/**
 * One task in a list. Tapping the circle completes the task; the row shows
 * an "AI" badge for agent-created items and accept/dismiss for suggestions.
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
  const agent = task.createdBy === 'agent';

  const dueLabel = task.dueAt
    ? `${formatDayLabel(task.dueAt)} · ${formatTime(task.dueAt)}`
    : null;

  return (
    <View className="flex-row items-start gap-3 px-4 py-3">
      <Pressable
        onPress={() => onToggle?.(task)}
        accessibilityRole="checkbox"
        accessibilityState={{ checked: done }}
        accessibilityLabel={done ? `Reopen ${task.title}` : `Complete ${task.title}`}
        className="mt-0.5 active:opacity-60"
        hitSlop={8}
      >
        {done ? (
          <View className="h-5 w-5 items-center justify-center rounded-full bg-emerald-500">
            <Check size={13} color="#ffffff" strokeWidth={3} />
          </View>
        ) : (
          <Circle size={20} color={suggested ? '#a855f7' : '#a1a1aa'} />
        )}
      </Pressable>

      <Pressable onPress={() => onPress?.(task)} className="flex-1 min-w-0 gap-1">
        <View className="flex-row items-center gap-1.5 flex-wrap">
          <Text
            className={`text-sm font-medium ${
              done ? 'text-zinc-400 line-through' : 'text-zinc-900 dark:text-white'
            }`}
          >
            {task.title}
          </Text>
          {agent ? (
            <View className="rounded-full bg-violet-500/15 px-1.5 py-0.5">
              <Text className="text-[9px] font-bold text-violet-500">AI</Text>
            </View>
          ) : null}
          {suggested ? (
            <View className="rounded-full bg-fuchsia-500/15 px-1.5 py-0.5">
              <Text className="text-[9px] font-bold text-fuchsia-500">SUGGESTED</Text>
            </View>
          ) : null}
          {task.priority > 0 ? (
            <View
              style={{ backgroundColor: PRIORITY_COLORS[task.priority] ?? '#71717a' }}
              className="h-1.5 w-1.5 rounded-full"
            />
          ) : null}
          {task.rrule ? (
            <Text className="text-[10px] font-semibold text-zinc-400">↻</Text>
          ) : null}
        </View>

        {dueLabel || listName ? (
          <Text className="text-xs text-zinc-500 dark:text-zinc-400">
            {dueLabel ?? ''}
            {dueLabel && listName ? ' · ' : ''}
            {listName ?? ''}
          </Text>
        ) : null}
      </Pressable>

      {suggested ? (
        <View className="flex-row items-center gap-1">
          <Pressable
            onPress={() => onAccept?.(task)}
            accessibilityRole="button"
            accessibilityLabel={`Accept ${task.title}`}
            className="h-7 w-7 items-center justify-center rounded-full border border-emerald-500/30 bg-emerald-500/10 active:opacity-70"
          >
            <Check size={14} color="#10b981" />
          </Pressable>
          <Pressable
            onPress={() => onDismiss?.(task)}
            accessibilityRole="button"
            accessibilityLabel={`Dismiss ${task.title}`}
            className="h-7 w-7 items-center justify-center rounded-full border border-zinc-300 dark:border-white/15 active:opacity-70"
          >
            <X size={14} color="#71717a" />
          </Pressable>
        </View>
      ) : (
        <Sparkles size={13} color="transparent" />
      )}
    </View>
  );
}
