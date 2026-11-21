import { useCallback, useMemo, useState } from 'react';
import { Pressable, RefreshControl, ScrollView, Text, TextInput, View } from 'react-native';
import { Spinner, Typography } from 'heroui-native';
import { useFocusEffect, useRouter } from 'expo-router';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { CalendarDays, Check, Clock, ListTodo, MapPin, Plus, Sparkles } from 'lucide-react-native';
import type { CalendarEvent, Task, TaskList } from '@agent/shared';

import { AppHeader } from '@/components/app-header';
import { TaskRow } from '@/components/task-row';
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
      setTasks((current) =>
        current.map((item) =>
          item.id === task.id
            ? { ...item, status: task.status === 'done' ? 'open' : 'done' }
            : item,
        ),
      );
      try {
        await updateTask(task.id, { status: task.status === 'done' ? 'open' : 'done' });
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
    <View className="flex-1 bg-white dark:bg-[#09090b]">
      <AppHeader
        center={
          <View className="items-center">
            <Typography type="body-sm" weight="semibold" className="text-zinc-900 dark:text-white">
              Today
            </Typography>
            <Text className="text-[10px] text-zinc-400">{formatHeaderDate()}</Text>
          </View>
        }
        right={
          <Pressable
            onPress={() => router.push('/tasks')}
            accessibilityRole="button"
            accessibilityLabel="Open tasks"
            className="h-8.5 px-3 flex-row items-center gap-1.5 rounded-full border border-zinc-200 dark:border-white/10 bg-zinc-50 dark:bg-white/5 active:opacity-75"
          >
            <ListTodo size={13} color="#71717a" />
            <Text className="text-xs font-medium text-zinc-600 dark:text-zinc-400">Tasks</Text>
          </Pressable>
        }
      />

      <ScrollView
        contentContainerStyle={{ padding: 16, paddingBottom: insets.bottom + 32, gap: 18 }}
        keyboardShouldPersistTaps="handled"
        refreshControl={
          <RefreshControl
            refreshing={refreshing}
            onRefresh={() => {
              setRefreshing(true);
              void load();
            }}
            tintColor="#8b5cf6"
          />
        }
      >
        {/* Quick add */}
        <View className="flex-row items-center gap-2 rounded-2xl border border-zinc-200 dark:border-white/10 bg-zinc-50 dark:bg-[#121215] px-3.5 py-2.5">
          <Plus size={16} color="#71717a" />
          <TextInput
            className="flex-1 text-sm text-zinc-900 dark:text-white"
            placeholder="Add a task for today…"
            placeholderTextColor="#71717a"
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
            className="h-7 w-7 items-center justify-center rounded-full bg-zinc-900 dark:bg-white active:opacity-70 disabled:opacity-30"
          >
            {saving ? (
              <Spinner size="sm" color="default" />
            ) : (
              <Check size={14} color="#ffffff" />
            )}
          </Pressable>
        </View>

        {notice ? (
          <View className="rounded-2xl border border-sky-500/20 bg-sky-500/10 px-3.5 py-2.5">
            <Text className="text-xs text-sky-500 dark:text-sky-400">{notice}</Text>
          </View>
        ) : null}

        {loading ? (
          <View className="py-16 items-center justify-center">
            <Spinner size="lg" color="default" />
          </View>
        ) : (
          <>
            {/* Events today */}
            <View className="gap-2">
              <View className="flex-row items-center gap-1.5 px-1">
                <CalendarDays size={14} color="#71717a" />
                <Text className="text-xs font-semibold uppercase tracking-wider text-zinc-400 dark:text-zinc-500">
                  Schedule
                </Text>
              </View>
              {events.length === 0 ? (
                <View className="rounded-2xl border border-dashed border-zinc-200 dark:border-white/10 px-4 py-5 items-center">
                  <Text className="text-xs text-zinc-500">Nothing scheduled today.</Text>
                  <Pressable
                    onPress={() => router.push('/calendar')}
                    className="mt-2 rounded-full border border-zinc-200 dark:border-white/10 px-3 py-1 active:opacity-70"
                  >
                    <Text className="text-[11px] font-semibold text-zinc-600 dark:text-zinc-400">
                      Open calendar
                    </Text>
                  </Pressable>
                </View>
              ) : (
                <View className="rounded-2xl border border-zinc-200 dark:border-white/10 bg-zinc-50 dark:bg-[#121215] overflow-hidden">
                  {events.map((event, index) => (
                    <Pressable
                      key={`${event.id}-${event.startsAt}`}
                      onPress={() => router.push('/calendar')}
                      className={`flex-row items-center gap-3 px-4 py-3 active:bg-zinc-100 dark:active:bg-[#18181e] ${
                        index > 0 ? 'border-t border-zinc-100 dark:border-white/5' : ''
                      }`}
                    >
                      <View className="w-14">
                        <Text className="text-xs font-bold text-zinc-900 dark:text-white">
                          {formatTime(event.startsAt)}
                        </Text>
                        <Text className="text-[10px] text-zinc-400">
                          {formatTime(event.endsAt)}
                        </Text>
                      </View>
                      <View className="flex-1 min-w-0">
                        <View className="flex-row items-center gap-1.5">
                          <Text className="text-sm font-semibold text-zinc-900 dark:text-white">
                            {event.title}
                          </Text>
                          {event.createdBy === 'agent' ? (
                            <View className="rounded-full bg-violet-500/15 px-1.5 py-0.5">
                              <Text className="text-[9px] font-bold text-violet-500">AI</Text>
                            </View>
                          ) : null}
                          {event.rrule ? (
                            <Text className="text-[10px] font-semibold text-zinc-400">↻</Text>
                          ) : null}
                        </View>
                        {event.location ? (
                          <View className="flex-row items-center gap-1 mt-0.5">
                            <MapPin size={11} color="#71717a" />
                            <Text className="text-[11px] text-zinc-500">{event.location}</Text>
                          </View>
                        ) : null}
                      </View>
                    </Pressable>
                  ))}
                </View>
              )}
            </View>

            {/* Overdue */}
            {overdue.length > 0 ? (
              <View className="gap-2">
                <View className="flex-row items-center gap-1.5 px-1">
                  <Clock size={14} color="#ef4444" />
                  <Text className="text-xs font-semibold uppercase tracking-wider text-red-500">
                    Overdue
                  </Text>
                </View>
                <View className="rounded-2xl border border-red-500/20 bg-red-500/5 overflow-hidden">
                  {overdue.map((task, index) => (
                    <View
                      key={task.id}
                      className={index > 0 ? 'border-t border-red-500/10' : ''}
                    >
                      <TaskRow
                        task={task}
                        onToggle={(t) => void handleToggle(t)}
                        listName={listNames.get(task.listId)}
                      />
                    </View>
                  ))}
                </View>
              </View>
            ) : null}

            {/* Due today */}
            <View className="gap-2">
              <View className="flex-row items-center gap-1.5 px-1">
                <ListTodo size={14} color="#71717a" />
                <Text className="text-xs font-semibold uppercase tracking-wider text-zinc-400 dark:text-zinc-500">
                  Due today
                </Text>
              </View>
              {dueToday.length === 0 ? (
                <View className="rounded-2xl border border-dashed border-zinc-200 dark:border-white/10 px-4 py-5 items-center">
                  <Text className="text-xs text-zinc-500">No tasks due today.</Text>
                </View>
              ) : (
                <View className="rounded-2xl border border-zinc-200 dark:border-white/10 bg-zinc-50 dark:bg-[#121215] overflow-hidden">
                  {dueToday.map((task, index) => (
                    <View
                      key={task.id}
                      className={
                        index > 0 ? 'border-t border-zinc-100 dark:border-white/5' : ''
                      }
                    >
                      <TaskRow
                        task={task}
                        onToggle={(t) => void handleToggle(t)}
                        listName={listNames.get(task.listId)}
                      />
                    </View>
                  ))}
                </View>
              )}
            </View>

            {/* Suggestions from memory extraction */}
            {suggestions.length > 0 ? (
              <View className="gap-2">
                <View className="flex-row items-center gap-1.5 px-1">
                  <Sparkles size={14} color="#a855f7" />
                  <Text className="text-xs font-semibold uppercase tracking-wider text-fuchsia-500">
                    Suggested
                  </Text>
                </View>
                <View className="rounded-2xl border border-fuchsia-500/20 bg-fuchsia-500/5 overflow-hidden">
                  {suggestions.map((task, index) => (
                    <View
                      key={task.id}
                      className={index > 0 ? 'border-t border-fuchsia-500/10' : ''}
                    >
                      <TaskRow
                        task={task}
                        onToggle={(t) => void handleToggle(t)}
                        onAccept={(t) => void handleAccept(t)}
                        onDismiss={(t) => void handleDismiss(t)}
                        listName={listNames.get(task.listId)}
                      />
                    </View>
                  ))}
                </View>
              </View>
            ) : null}

            {/* Upcoming */}
            {upcoming.length > 0 ? (
              <View className="gap-2">
                <View className="flex-row items-center gap-1.5 px-1">
                  <Clock size={14} color="#71717a" />
                  <Text className="text-xs font-semibold uppercase tracking-wider text-zinc-400 dark:text-zinc-500">
                    Upcoming
                  </Text>
                </View>
                <View className="rounded-2xl border border-zinc-200 dark:border-white/10 bg-zinc-50 dark:bg-[#121215] overflow-hidden">
                  {upcoming.map((task, index) => (
                    <View
                      key={task.id}
                      className={
                        index > 0 ? 'border-t border-zinc-100 dark:border-white/5' : ''
                      }
                    >
                      <TaskRow
                        task={task}
                        onToggle={(t) => void handleToggle(t)}
                        listName={listNames.get(task.listId)}
                      />
                    </View>
                  ))}
                </View>
              </View>
            ) : null}
          </>
        )}
      </ScrollView>
    </View>
  );
}
