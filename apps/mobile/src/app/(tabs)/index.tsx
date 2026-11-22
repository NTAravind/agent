import React, { useCallback, useMemo, useState } from 'react';
import {
  Pressable,
  RefreshControl,
  ScrollView,
  StyleSheet,
  Text,
  TextInput,
  View,
} from 'react-native';
import { Spinner } from 'heroui-native';
import { useFocusEffect, useRouter } from 'expo-router';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { CalendarDays, Check, Clock, ListTodo, MapPin, Plus } from 'lucide-react-native';
import type { CalendarEvent, Task, TaskList } from '@agent/shared';

import { AppHeader } from '@/components/app-header';
import { GroupedCard, HairlineDivider, RoundButton, SectionLabel } from '@/components/design-system';
import { TaskRow } from '@/components/task-row';
import { colors, radius, shadow, space } from '@/theme';
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

export default function TodayScreen() {
  const router = useRouter();
  const insets = useSafeAreaInsets();

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
        setNotice(error instanceof Error ? error.message : String(error));
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
        setNotice(error instanceof Error ? error.message : String(error));
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
        setNotice(error instanceof Error ? error.message : String(error));
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
      setNotice(error instanceof Error ? error.message : String(error));
    } finally {
      setSaving(false);
    }
  }, [draft, lists, saving]);

  return (
    <View style={styles.screen}>
      <AppHeader
        center={
          <View style={styles.headerCenter}>
            <Text style={styles.headerTitle}>Today</Text>
            <Text style={styles.headerDate}>{formatHeaderDate()}</Text>
          </View>
        }
        right={
          <RoundButton
            icon={ListTodo}
            onPress={() => router.push('/tasks')}
            accessibilityLabel="Open all tasks"
          />
        }
      />

      <ScrollView
        contentContainerStyle={{
          paddingHorizontal: space.lg,
          paddingTop: space.sm,
          paddingBottom: insets.bottom + 100, // accommodate pill dock
          gap: space.lg,
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
      >
        {/* Quick add pill */}
        <View style={styles.quickAddRow}>
          <Plus size={18} color={colors.textSecondary} strokeWidth={1.75} />
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
            style={({ pressed }) => [
              styles.quickAddButton,
              { opacity: pressed ? 0.6 : draft.trim() ? 1 : 0.4 },
            ]}
          >
            {saving ? (
              <Spinner size="sm" color="default" />
            ) : (
              <Check size={14} color={colors.onPrimary} strokeWidth={2.5} />
            )}
          </Pressable>
        </View>

        {notice ? (
          <View style={styles.noticeBox}>
            <Text style={styles.noticeText}>{notice}</Text>
          </View>
        ) : null}

        {loading ? (
          <View style={styles.center}>
            <Spinner size="lg" color="default" />
          </View>
        ) : (
          <>
            {/* Events today */}
            <View style={{ gap: space.xs }}>
              <SectionLabel text="Schedule" />
              {events.length === 0 ? (
                <View style={styles.emptyCard}>
                  <Text style={styles.emptyText}>Nothing scheduled today.</Text>
                  <Pressable
                    onPress={() => router.push('/calendar')}
                    style={styles.openCalendarPill}
                  >
                    <Text style={styles.openCalendarText}>Open calendar</Text>
                  </Pressable>
                </View>
              ) : (
                <GroupedCard>
                  {events.map((event, index) => (
                    <React.Fragment key={`${event.id}-${event.startsAt}`}>
                      {index > 0 && <HairlineDivider inset={72} />}
                      <Pressable
                        onPress={() => router.push('/calendar')}
                        accessibilityRole="button"
                        accessibilityLabel={`${event.title} at ${formatTime(event.startsAt)}`}
                        style={({ pressed }) => [
                          styles.eventRow,
                          { opacity: pressed ? 0.6 : 1 },
                        ]}
                      >
                        <View style={styles.timeColumn}>
                          <Text style={styles.eventTimeStart}>
                            {formatTime(event.startsAt)}
                          </Text>
                          <Text style={styles.eventTimeEnd}>
                            {formatTime(event.endsAt)}
                          </Text>
                        </View>
                        <View style={styles.eventContent}>
                          <Text numberOfLines={1} style={styles.eventTitle}>
                            {event.title}
                          </Text>
                          {event.location ? (
                            <View style={styles.locationRow}>
                              <MapPin size={12} color={colors.textSecondary} />
                              <Text numberOfLines={1} style={styles.locationText}>
                                {event.location}
                              </Text>
                            </View>
                          ) : null}
                        </View>
                      </Pressable>
                    </React.Fragment>
                  ))}
                </GroupedCard>
              )}
            </View>

            {/* Overdue */}
            {overdue.length > 0 ? (
              <View style={{ gap: space.xs }}>
                <SectionLabel text="Overdue" />
                <GroupedCard>
                  {overdue.map((task, index) => (
                    <React.Fragment key={task.id}>
                      {index > 0 && <HairlineDivider inset={48} />}
                      <TaskRow
                        task={task}
                        onToggle={(t) => void handleToggle(t)}
                        listName={listNames.get(task.listId)}
                      />
                    </React.Fragment>
                  ))}
                </GroupedCard>
              </View>
            ) : null}

            {/* Due today */}
            <View style={{ gap: space.xs }}>
              <SectionLabel text="Due today" />
              {dueToday.length === 0 ? (
                <View style={styles.emptyCard}>
                  <Text style={styles.emptyText}>No tasks due today.</Text>
                </View>
              ) : (
                <GroupedCard>
                  {dueToday.map((task, index) => (
                    <React.Fragment key={task.id}>
                      {index > 0 && <HairlineDivider inset={48} />}
                      <TaskRow
                        task={task}
                        onToggle={(t) => void handleToggle(t)}
                        listName={listNames.get(task.listId)}
                      />
                    </React.Fragment>
                  ))}
                </GroupedCard>
              )}
            </View>

            {/* Suggestions */}
            {suggestions.length > 0 ? (
              <View style={{ gap: space.xs }}>
                <SectionLabel text="Suggested" />
                <GroupedCard>
                  {suggestions.map((task, index) => (
                    <React.Fragment key={task.id}>
                      {index > 0 && <HairlineDivider inset={48} />}
                      <TaskRow
                        task={task}
                        onToggle={(t) => void handleToggle(t)}
                        onAccept={(t) => void handleAccept(t)}
                        onDismiss={(t) => void handleDismiss(t)}
                        listName={listNames.get(task.listId)}
                      />
                    </React.Fragment>
                  ))}
                </GroupedCard>
              </View>
            ) : null}

            {/* Upcoming */}
            {upcoming.length > 0 ? (
              <View style={{ gap: space.xs }}>
                <SectionLabel text="Upcoming" />
                <GroupedCard>
                  {upcoming.map((task, index) => (
                    <React.Fragment key={task.id}>
                      {index > 0 && <HairlineDivider inset={48} />}
                      <TaskRow
                        task={task}
                        onToggle={(t) => void handleToggle(t)}
                        listName={listNames.get(task.listId)}
                      />
                    </React.Fragment>
                  ))}
                </GroupedCard>
              </View>
            ) : null}
          </>
        )}
      </ScrollView>
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
    fontSize: 12,
    lineHeight: 16,
    color: colors.textSecondary,
    marginTop: 1,
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
    width: 28,
    height: 28,
    borderRadius: radius.pill,
    backgroundColor: colors.primary,
    alignItems: 'center',
    justifyContent: 'center',
  },
  noticeBox: {
    backgroundColor: colors.surface,
    borderRadius: radius.card,
    paddingHorizontal: space.md,
    paddingVertical: space.sm,
  },
  noticeText: {
    fontSize: 14,
    color: colors.textSecondary,
  },
  center: {
    paddingVertical: 64,
    alignItems: 'center',
    justifyContent: 'center',
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
    fontSize: 14,
    color: colors.textSecondary,
  },
  openCalendarPill: {
    borderRadius: radius.pill,
    backgroundColor: colors.surfaceRaised,
    paddingHorizontal: 14,
    paddingVertical: 6,
  },
  openCalendarText: {
    fontSize: 13,
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
    fontSize: 14,
    lineHeight: 18,
    fontWeight: '600',
    color: colors.textPrimary,
  },
  eventTimeEnd: {
    fontSize: 11,
    lineHeight: 15,
    color: colors.textSecondary,
  },
  eventContent: {
    flex: 1,
    minWidth: 0,
    gap: 2,
  },
  eventTitle: {
    fontSize: 16,
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
    fontSize: 12,
    color: colors.textSecondary,
  },
});
