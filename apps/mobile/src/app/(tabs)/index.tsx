import { useCallback, useMemo, useState } from 'react';
import {
  FlatList,
  Pressable,
  RefreshControl,
  StyleSheet,
  Text,
  TextInput,
  View,
} from 'react-native';
import { Spinner } from 'heroui-native';
import { useFocusEffect, useRouter } from 'expo-router';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { CalendarDays, Check, Clock, ListTodo, MapPin, Plus } from 'lucide-react-native';
import { SymbolIcon } from '@/components/symbol-icon';
import type { CalendarEvent, Task, TaskList } from '@agent/shared';

import { AppHeader, HeaderAvatar, useHeaderInset } from '@/components/app-header';
import { reportAppError } from '@/components/error-dialog-provider';
import { HairlineDivider, InlineError, RoundButton, SectionLabel } from '@/components/design-system';
import { TaskRow } from '@/components/task-row';
import { colors, radius, shadow, space } from '@/theme';
import { useSession } from '@/lib/session';
import {
  endOfDayIso,
  formatHeaderDate,
  formatTime,
  isPast,
  isToday,
  startOfDayIso,
} from '@/lib/dates';
import {
  createTask,
  createTaskList,
  deleteTask,
  fetchEvents,
  fetchTaskLists,
  fetchTasks,
  updateTask,
} from '@/lib/productivity';

/**
 * One row of the virtualized dashboard. Each task/event cell carries
 * first/last flags so it renders only its slice of the grouped card — the
 * geometry is identical to wrapping rows in `GroupedCard`, but the list
 * stays bounded however long the backlog grows.
 */
type DashboardCell =
  | { key: string; type: 'label'; text: string }
  | { key: string; type: 'empty'; text: string; calendar?: boolean }
  | {
      key: string;
      type: 'event';
      event: CalendarEvent;
      first: boolean;
      last: boolean;
    }
  | {
      key: string;
      type: 'task';
      task: Task;
      variant: 'plain' | 'suggested';
      first: boolean;
      last: boolean;
    };

export default function TodayScreen() {
  const router = useRouter();
  const insets = useSafeAreaInsets();
  const { session } = useSession();
  const userInitial = session?.user.email ? session.user.email.slice(0, 2).toUpperCase() : 'FL';

  const [lists, setLists] = useState<TaskList[]>([]);
  const [tasks, setTasks] = useState<Task[]>([]);
  const [events, setEvents] = useState<CalendarEvent[]>([]);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [draft, setDraft] = useState('');
  const [saving, setSaving] = useState(false);
  const [notice, setNotice] = useState<string | null>(null);

  const load = useCallback(async () => {
    try {
      const [taskLists, openTasks, todayEvents] = await Promise.all([
        fetchTaskLists(),
        fetchTasks({ status: 'open' }),
        fetchEvents(startOfDayIso(), endOfDayIso()),
      ]);
      setLists(taskLists);
      setTasks(openTasks);
      setEvents(todayEvents);
    } catch (error) {
      setNotice(error instanceof Error ? error.message : String(error));
    } finally {
      setLoading(false);
      setRefreshing(false);
    }
  }, []);

  useFocusEffect(
    useCallback(() => {
      void load();
    }, [load]),
  );

  const listNames = useMemo(
    () => new Map(lists.map((list) => [list.id, list.name])),
    [lists],
  );

  const overdue = useMemo(
    () =>
      tasks
        .filter((task) => task.dueAt && isPast(task.dueAt))
        .sort((a, b) => (a.dueAt ?? '').localeCompare(b.dueAt ?? '')),
    [tasks],
  );

  const dueToday = useMemo(
    () =>
      tasks.filter(
        (task) => task.dueAt && isToday(task.dueAt) && !isPast(task.dueAt),
      ),
    [tasks],
  );

  const suggestions = useMemo(
    () => tasks.filter((task) => task.createdBy === 'suggested'),
    [tasks],
  );

  const upcoming = useMemo(
    () =>
      tasks
        .filter((task) => !task.dueAt || !isToday(task.dueAt))
        .filter((task) => !suggestions.some((s) => s.id === task.id))
        .slice(0, 10),
    [tasks, suggestions],
  );

  const handleToggle = useCallback(
    async (task: Task) => {
      const nextStatus = task.status === 'done' ? 'open' : 'done';
      setTasks((current) =>
        current.map((item) =>
          item.id === task.id ? { ...item, status: nextStatus } : item,
        ),
      );
      try {
        await updateTask(task.id, { status: nextStatus });
      } catch (error) {
        reportAppError(error, { title: 'Could not update task' });
        void load();
      }
    },
    [load],
  );

  const handleAccept = useCallback(
    async (task: Task) => {
      try {
        await updateTask(task.id, { status: 'open' });
        setTasks((current) => current.filter((item) => item.id !== task.id));
      } catch (error) {
        reportAppError(error, { title: 'Could not accept task' });
      }
    },
    [],
  );

  const handleDismiss = useCallback(
    async (task: Task) => {
      try {
        await deleteTask(task.id);
        setTasks((current) => current.filter((item) => item.id !== task.id));
      } catch (error) {
        reportAppError(error, { title: 'Could not dismiss task' });
      }
    },
    [],
  );

  const handleQuickAdd = useCallback(async () => {
    const title = draft.trim();
    if (!title || saving) return;
    setSaving(true);
    setNotice(null);
    try {
      let listId = lists[0]?.id;
      if (!listId) {
        const created = await createTaskList({ name: 'Inbox' });
        setLists((current) => [...current, created]);
        listId = created.id;
      }
      const task = await createTask({
        listId,
        title,
        dueAt: new Date().toISOString(),
        createdBy: 'user',
      });
      setTasks((current) => [task, ...current]);
      setDraft('');
    } catch (error) {
      reportAppError(error, { title: 'Could not add task' });
    } finally {
      setSaving(false);
    }
  }, [draft, lists, saving]);

  const headerInset = useHeaderInset();

  // Flatten the dashboard into virtualizable cells: section labels, then
  // individual rows with first/last flags for the card slices. Section
  // spacing lives on the cells themselves (the content container no longer
  // uses `gap`, which would space every row apart).
  const dashboardCells = useMemo(() => {
    const cells: DashboardCell[] = [];
    const label = (text: string) =>
      cells.push({ key: `label-${text}`, type: 'label', text });
    const tasks = (section: string, rows: Task[], variant: 'plain' | 'suggested') =>
      rows.forEach((task, index) =>
        cells.push({
          key: `${section}-${task.id}`,
          type: 'task',
          task,
          variant,
          first: index === 0,
          last: index === rows.length - 1,
        }),
      );

    label('Schedule');
    if (events.length === 0) {
      cells.push({
        key: 'schedule-empty',
        type: 'empty',
        text: 'Nothing scheduled today.',
        calendar: true,
      });
    } else {
      events.forEach((event, index) =>
        cells.push({
          key: `event-${event.id}-${event.startsAt}`,
          type: 'event',
          event,
          first: index === 0,
          last: index === events.length - 1,
        }),
      );
    }

    if (overdue.length > 0) {
      label('Overdue');
      tasks('overdue', overdue, 'plain');
    }

    label('Due today');
    if (dueToday.length === 0) {
      cells.push({ key: 'today-empty', type: 'empty', text: 'No tasks due today.' });
    } else {
      tasks('today', dueToday, 'plain');
    }

    if (suggestions.length > 0) {
      label('Suggested');
      tasks('suggested', suggestions, 'suggested');
    }

    if (upcoming.length > 0) {
      label('Upcoming');
      tasks('upcoming', upcoming, 'plain');
    }

    return cells;
  }, [events, overdue, dueToday, suggestions, upcoming]);

  return (
    <View style={styles.screen}>
      <AppHeader
        left={
          <HeaderAvatar
            initial={userInitial}
            onPress={() => router.push('/more')}
          />
        }
        center={
          <View style={styles.headerCenter}>
            <Text style={styles.headerTitle}>Today</Text>
            <Text style={styles.headerDate}>{formatHeaderDate()}</Text>
          </View>
        }
        right={
          <RoundButton
            size={36}
            icon={ListTodo}
            onPress={() => router.push('/tasks')}
            accessibilityLabel="Open all tasks"
          />
        }
      />

      <FlatList
        data={loading ? [] : dashboardCells}
        keyExtractor={(cell) => cell.key}
        renderItem={({ item: cell }) => {
          if (cell.type === 'label') {
            return (
              <View style={styles.sectionLabelCell}>
                <SectionLabel text={cell.text} />
              </View>
            );
          }

          if (cell.type === 'empty') {
            const EmptyIcon = cell.calendar ? CalendarDays : ListTodo;
            return (
              <View style={styles.emptyCard}>
                <SymbolIcon
                  icon={EmptyIcon}
                  size={18}
                  color={colors.textSecondary}
                  strokeWidth={1.5}
                />
                <Text style={styles.emptyText}>{cell.text}</Text>
                {cell.calendar ? (
                  <Pressable
                    onPress={() => router.push('/calendar')}
                    accessibilityRole="button"
                    accessibilityLabel="Open calendar"
                    style={({ pressed }) => [
                      styles.openCalendarPill,
                      { opacity: pressed ? 0.6 : 1 },
                    ]}
                  >
                    <Text style={styles.openCalendarText}>Open calendar</Text>
                  </Pressable>
                ) : null}
              </View>
            );
          }

          if (cell.type === 'event') {
            return (
              <View
                style={[
                  styles.cardSlice,
                  cell.first && styles.cardSliceTop,
                  cell.last && styles.cardSliceBottom,
                ]}
              >
                {!cell.first ? <HairlineDivider inset={72} /> : null}
                <Pressable
                  onPress={() => router.push('/calendar')}
                  accessibilityRole="button"
                  accessibilityLabel={`${cell.event.title} at ${formatTime(cell.event.startsAt)}`}
                  style={({ pressed }) => [
                    styles.eventRow,
                    { opacity: pressed ? 0.6 : 1 },
                  ]}
                >
                  <View style={styles.timeColumn}>
                    <Text style={styles.eventTimeStart}>
                      {formatTime(cell.event.startsAt)}
                    </Text>
                    <Text style={styles.eventTimeEnd}>
                      {formatTime(cell.event.endsAt)}
                    </Text>
                  </View>
                  <View style={styles.eventContent}>
                    <Text numberOfLines={1} style={styles.eventTitle}>
                      {cell.event.title}
                    </Text>
                    {cell.event.location ? (
                      <View style={styles.locationRow}>
                        <SymbolIcon icon={MapPin} size={14} color={colors.textSecondary} />
                        <Text numberOfLines={1} style={styles.locationText}>
                          {cell.event.location}
                        </Text>
                      </View>
                    ) : null}
                  </View>
                </Pressable>
              </View>
            );
          }

          return (
            <View
              style={[
                styles.cardSlice,
                cell.first && styles.cardSliceTop,
                cell.last && styles.cardSliceBottom,
              ]}
            >
              {!cell.first ? <HairlineDivider inset={48} /> : null}
              {cell.variant === 'suggested' ? (
                <TaskRow
                  task={cell.task}
                  onToggle={(t) => void handleToggle(t)}
                  onAccept={(t) => void handleAccept(t)}
                  onDismiss={(t) => void handleDismiss(t)}
                  listName={listNames.get(cell.task.listId)}
                />
              ) : (
                <TaskRow
                  task={cell.task}
                  onToggle={(t) => void handleToggle(t)}
                  listName={listNames.get(cell.task.listId)}
                />
              )}
            </View>
          );
        }}
        ListHeaderComponent={
          <View style={styles.listHeaderGap}>
            {/* Quick add pill */}
            <View style={styles.quickAddRow}>
              <SymbolIcon icon={Plus} size={18} color={colors.textSecondary} strokeWidth={1.75} />
              <TextInput
                style={styles.quickAddInput}
                placeholder="Add a task for today…"
                placeholderTextColor={colors.textSecondary}
                value={draft}
                onChangeText={setDraft}
                onSubmitEditing={() => void handleQuickAdd()}
                returnKeyType="done"
              />
              <Pressable
                onPress={() => void handleQuickAdd()}
                disabled={saving || !draft.trim()}
                accessibilityRole="button"
                accessibilityLabel="Add task"
                hitSlop={6}
                style={({ pressed }) => [
                  styles.quickAddButton,
                  draft.trim() ? styles.quickAddButtonActive : styles.quickAddButtonDisabled,
                  { opacity: pressed ? 0.6 : 1 },
                ]}
              >
                {saving ? (
                  <Spinner size="sm" color="default" />
                ) : (
                  <SymbolIcon
                    icon={Check}
                    size={16}
                    color={draft.trim() ? colors.onPrimary : colors.textSecondary}
                    strokeWidth={2.2}
                  />
                )}
              </Pressable>
            </View>

            {notice ? <InlineError message={notice} onRetry={() => void load()} /> : null}
          </View>
        }
        ListEmptyComponent={
          loading ? (
            <View style={[styles.center, styles.loadingCell]}>
              <Spinner size="lg" color="default" />
            </View>
          ) : undefined
        }
        contentContainerStyle={{
          paddingTop: headerInset,
          paddingHorizontal: space.lg,
          paddingBottom: insets.bottom + 100, // accommodate pill dock
        }}
        keyboardShouldPersistTaps="handled"
        refreshControl={
          <RefreshControl
            refreshing={refreshing}
            onRefresh={() => {
              setRefreshing(true);
              void load();
            }}
            tintColor={colors.textPrimary}
          />
        }
      />
    </View>
  );
}

const styles = StyleSheet.create({
  screen: {
    flex: 1,
    backgroundColor: colors.background,
  },
  headerCenter: {
    alignItems: 'center',
  },
  headerTitle: {
    fontSize: 17,
    lineHeight: 22,
    fontWeight: '600',
    color: colors.textPrimary,
  },
  headerDate: {
    fontSize: 13,
    lineHeight: 18,
    color: colors.textSecondary,
    marginTop: 1,
    fontVariant: ['tabular-nums'],
  },
  quickAddRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: space.sm,
    backgroundColor: colors.surface,
    borderRadius: radius.pill,
    paddingHorizontal: space.md,
    paddingVertical: 10,
  },
  quickAddInput: {
    flex: 1,
    fontSize: 16,
    color: colors.textPrimary,
  },
  quickAddButton: {
    width: 36,
    height: 36,
    borderRadius: radius.pill,
    alignItems: 'center',
    justifyContent: 'center',
  },
  quickAddButtonActive: {
    backgroundColor: colors.primary,
  },
  quickAddButtonDisabled: {
    backgroundColor: 'rgba(0,0,0,0.06)',
  },
  center: {
    paddingVertical: 64,
    alignItems: 'center',
    justifyContent: 'center',
  },
  loadingCell: {
    // Replaces the content container's old `gap` above the spinner.
    marginTop: space.lg,
  },
  listHeaderGap: {
    gap: space.lg,
  },
  sectionLabelCell: {
    // Section spacing from the section above. SectionLabel already adds its
    // own 8pt marginBottom, so label→card is the 8pt the spec asks for.
    marginTop: space.lg,
  },
  cardSlice: {
    backgroundColor: colors.surface,
    paddingHorizontal: space.lg,
  },
  cardSliceTop: {
    borderTopLeftRadius: radius.card,
    borderTopRightRadius: radius.card,
  },
  cardSliceBottom: {
    borderBottomLeftRadius: radius.card,
    borderBottomRightRadius: radius.card,
  },
  emptyCard: {
    backgroundColor: colors.surface,
    borderRadius: radius.card,
    paddingHorizontal: space.lg,
    paddingVertical: space.lg,
    alignItems: 'center',
    gap: space.sm,
  },
  emptyText: {
    fontSize: 13,
    lineHeight: 18,
    color: colors.textSecondary,
  },
  openCalendarPill: {
    minHeight: 44,
    justifyContent: 'center',
    borderRadius: radius.pill,
    backgroundColor: colors.surface,
    paddingHorizontal: 14,
    paddingVertical: 6,
  },
  openCalendarText: {
    fontSize: 13,
    lineHeight: 18,
    fontWeight: '500',
    color: colors.textPrimary,
  },
  eventRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: space.md,
    paddingHorizontal: space.lg,
    paddingVertical: 12,
  },
  timeColumn: {
    width: 56,
  },
  eventTimeStart: {
    fontSize: 15,
    lineHeight: 20,
    fontWeight: '600',
    color: colors.textPrimary,
    fontVariant: ['tabular-nums'],
  },
  eventTimeEnd: {
    fontSize: 13,
    lineHeight: 18,
    color: colors.textSecondary,
    fontVariant: ['tabular-nums'],
  },
  eventContent: {
    flex: 1,
    minWidth: 0,
    gap: 2,
  },
  eventTitle: {
    fontSize: 17,
    lineHeight: 22,
    fontWeight: '500',
    color: colors.textPrimary,
  },
  locationRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 4,
  },
  locationText: {
    fontSize: 13,
    lineHeight: 18,
    color: colors.textSecondary,
    flex: 1,
  },
});
