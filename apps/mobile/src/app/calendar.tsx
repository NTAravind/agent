import { useCallback, useMemo, useState } from 'react';
import {
  Alert,
  Modal,
  Pressable,
  RefreshControl,
  ScrollView,
  Switch,
  Text,
  TextInput,
  View,
} from 'react-native';
import { Spinner, Typography } from 'heroui-native';
import { useFocusEffect, useRouter } from 'expo-router';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { CalendarDays, ChevronLeft, ChevronRight, MapPin, Plus, Trash2, X } from 'lucide-react-native';
import type { CalendarEvent } from '@agent/shared';

import { AppHeader } from '@/components/app-header';
import { DEFAULT_TIMEZONE, dayKey, formatDayLabel, formatTime } from '@/lib/dates';
import { createEvent, deleteEvent, fetchEvents, updateEvent } from '@/lib/productivity';

type ViewMode = 'month' | 'week' | 'agenda';

const WEEKDAYS = ['S', 'M', 'T', 'W', 'T', 'F', 'S'];

/** Builds an ISO instant (IST) from `YYYY-MM-DD` + `HH:MM`. */
function buildIso(date: string, time: string): string {
  const safeTime = /^\d{2}:\d{2}$/.test(time) ? time : '09:00';
  return `${date}T${safeTime}:00+05:30`;
}

function todayKey(): string {
  return dayKey(new Date(), DEFAULT_TIMEZONE);
}

export default function CalendarScreen() {
  const router = useRouter();
  const insets = useSafeAreaInsets();

  const [events, setEvents] = useState<CalendarEvent[]>([]);
  const [now, setNow] = useState<number | null>(null);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [notice, setNotice] = useState<string | null>(null);
  const [mode, setMode] = useState<ViewMode>('month');
  const [cursor, setCursor] = useState<Date>(new Date());
  const [selectedDay, setSelectedDay] = useState<string>(todayKey());

  const [editorOpen, setEditorOpen] = useState(false);
  const [editing, setEditing] = useState<CalendarEvent | null>(null);
  const [title, setTitle] = useState('');
  const [dateText, setDateText] = useState(todayKey());
  const [startText, setStartText] = useState('09:00');
  const [endText, setEndText] = useState('10:00');
  const [location, setLocation] = useState('');
  const [allDay, setAllDay] = useState(false);
  const [weekly, setWeekly] = useState(false);
  const [remindMinutes, setRemindMinutes] = useState('15');
  const [saving, setSaving] = useState(false);

  const load = useCallback(async () => {
    try {
      const from = new Date();
      from.setDate(from.getDate() - 31);
      const to = new Date();
      to.setDate(to.getDate() + 180);
      const loaded = await fetchEvents(from.toISOString(), to.toISOString());
      setEvents(loaded);
      setNow(Date.now());
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

  const byDay = useMemo(() => {
    const map = new Map<string, CalendarEvent[]>();
    for (const event of events) {
      const key = dayKey(event.startsAt, DEFAULT_TIMEZONE);
      const list = map.get(key) ?? [];
      list.push(event);
      map.set(key, list);
    }
    for (const list of map.values()) {
      list.sort((a, b) => a.startsAt.localeCompare(b.startsAt));
    }
    return map;
  }, [events]);

  const monthGrid = useMemo(() => {
    const year = cursor.getFullYear();
    const month = cursor.getMonth();
    const first = new Date(year, month, 1);
    const startOffset = first.getDay();
    const daysInMonth = new Date(year, month + 1, 0).getDate();
    const cells: { key: string; day: number; inMonth: boolean }[] = [];
    for (let i = 0; i < startOffset; i += 1) {
      cells.push({ key: `pad-${i}`, day: 0, inMonth: false });
    }
    for (let day = 1; day <= daysInMonth; day += 1) {
      const date = new Date(year, month, day);
      cells.push({
        key: dayKey(date, DEFAULT_TIMEZONE),
        day,
        inMonth: true,
      });
    }
    while (cells.length % 7 !== 0) {
      cells.push({ key: `tail-${cells.length}`, day: 0, inMonth: false });
    }
    return cells;
  }, [cursor]);

  const weekDays = useMemo(() => {    const start = new Date(cursor);
    start.setDate(cursor.getDate() - cursor.getDay());
    return Array.from({ length: 7 }, (_, index) => {
      const date = new Date(start);
      date.setDate(start.getDate() + index);
      return date;
    });
  }, [cursor]);

  const agenda = useMemo(
    () =>
      [...events]
        .filter((event) => new Date(event.startsAt).getTime() >= (now ?? 0) - 86_400_000)
        .sort((a, b) => a.startsAt.localeCompare(b.startsAt)),
    [events, now],
  );

  const openEditor = useCallback((event?: CalendarEvent) => {
    if (event) {
      setEditing(event);
      setTitle(event.title);
      setDateText(dayKey(event.startsAt, DEFAULT_TIMEZONE));
      const start = new Date(event.startsAt);
      const end = new Date(event.endsAt);
      const pad = (n: number) => String(n).padStart(2, '0');
      setStartText(`${pad(start.getHours())}:${pad(start.getMinutes())}`);
      setEndText(`${pad(end.getHours())}:${pad(end.getMinutes())}`);
      setLocation(event.location ?? '');
      setAllDay(event.allDay);
      setWeekly(Boolean(event.rrule));
      setRemindMinutes(String(event.reminders?.[0]?.minutesBefore ?? 15));
    } else {
      setEditing(null);
      setTitle('');
      setDateText(selectedDay);
      setStartText('09:00');
      setEndText('10:00');
      setLocation('');
      setAllDay(false);
      setWeekly(false);
      setRemindMinutes('15');
    }
    setEditorOpen(true);
  }, [selectedDay]);

  const handleSave = useCallback(async () => {
    const trimmed = title.trim();
    if (!trimmed || saving) return;
    setSaving(true);
    try {
      const startsAt = buildIso(dateText, startText);
      const endsAt = buildIso(dateText, endText);
      const payload = {
        title: trimmed,
        startsAt,
        endsAt,
        allDay,
        location: location.trim() || undefined,
        ...(weekly ? { rrule: 'FREQ=WEEKLY' } : {}),
        ...(allDay
          ? {}
          : { reminders: [{ minutesBefore: Number(remindMinutes) || 0, method: 'push' as const }] }),
      };
      if (editing) {
        await updateEvent(editing.id, payload);
      } else {
        await createEvent(payload);
      }
      setEditorOpen(false);
      await load();
    } catch (error) {
      setNotice(error instanceof Error ? error.message : String(error));
    } finally {
      setSaving(false);
    }
  }, [allDay, dateText, editing, endText, location, remindMinutes, saving, startText, title, weekly, load]);

  const handleDelete = useCallback(
    (event: CalendarEvent) => {
      Alert.alert('Delete event', `Remove “${event.title}”?`, [
        { text: 'Cancel', style: 'cancel' },
        {
          text: 'Delete',
          style: 'destructive',
          onPress: () => {
            void deleteEvent(event.id)
              .then(() => {
                setEditorOpen(false);
                return load();
              })
              .catch((error) =>
                setNotice(error instanceof Error ? error.message : String(error)),
              );
          },
        },
      ]);
    },
    [load],
  );

  const renderEvent = (event: CalendarEvent) => (
    <Pressable
      key={`${event.id}-${event.startsAt}`}
      onPress={() => openEditor(event)}
      className="flex-row items-center gap-3 px-4 py-3 active:bg-zinc-100 dark:active:bg-[#18181e]"
    >
      <View className="w-14">
        <Text className="text-xs font-bold text-zinc-900 dark:text-white">
          {event.allDay ? 'All day' : formatTime(event.startsAt)}
        </Text>
        {!event.allDay ? (
          <Text className="text-[10px] text-zinc-400">{formatTime(event.endsAt)}</Text>
        ) : null}
      </View>
      <View className="flex-1 min-w-0">
        <View className="flex-row items-center gap-1.5">
          <Text className="text-sm font-semibold text-zinc-900 dark:text-white">{event.title}</Text>
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
  );

  return (
    <View className="flex-1 bg-white dark:bg-[#09090b]">
      <AppHeader
        left={
          <Pressable
            onPress={() => router.back()}
            accessibilityRole="button"
            className="px-2 py-1 active:opacity-60"
          >
            <Typography type="body" className="text-zinc-500 dark:text-zinc-400">
              Back
            </Typography>
          </Pressable>
        }
        center={
          <Typography type="body-sm" weight="semibold" className="text-zinc-900 dark:text-white">
            Calendar
          </Typography>
        }
        right={
          <Pressable
            onPress={() => openEditor()}
            accessibilityRole="button"
            accessibilityLabel="New event"
            className="h-8.5 w-8.5 items-center justify-center rounded-full border border-zinc-200 dark:border-white/10 bg-zinc-50 dark:bg-white/5 active:opacity-75"
          >
            <Plus size={15} color="#71717a" />
          </Pressable>
        }
      />

      <ScrollView
        contentContainerStyle={{ padding: 16, paddingBottom: insets.bottom + 32, gap: 14 }}
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
        {/* Mode switch */}
        <View className="flex-row rounded-2xl border border-zinc-200 dark:border-white/10 bg-zinc-50 dark:bg-[#121215] p-1">
          {(['month', 'week', 'agenda'] as ViewMode[]).map((value) => (
            <Pressable
              key={value}
              onPress={() => setMode(value)}
              className={`flex-1 items-center rounded-xl py-1.5 ${
                mode === value ? 'bg-white dark:bg-white/10' : ''
              }`}
            >
              <Text
                className={`text-xs font-semibold capitalize ${
                  mode === value ? 'text-zinc-900 dark:text-white' : 'text-zinc-500'
                }`}
              >
                {value}
              </Text>
            </Pressable>
          ))}
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
        ) : mode === 'month' ? (
          <View className="gap-3">
            <View className="flex-row items-center justify-between">
              <Pressable
                onPress={() =>
                  setCursor((current) => new Date(current.getFullYear(), current.getMonth() - 1, 1))
                }
                accessibilityRole="button"
                accessibilityLabel="Previous month"
                className="h-8 w-8 items-center justify-center rounded-full active:opacity-60"
              >
                <ChevronLeft size={18} color="#71717a" />
              </Pressable>
              <Text className="text-sm font-bold text-zinc-900 dark:text-white">
                {new Intl.DateTimeFormat('en-IN', {
                  month: 'long',
                  year: 'numeric',
                }).format(cursor)}
              </Text>
              <Pressable
                onPress={() =>
                  setCursor((current) => new Date(current.getFullYear(), current.getMonth() + 1, 1))
                }
                accessibilityRole="button"
                accessibilityLabel="Next month"
                className="h-8 w-8 items-center justify-center rounded-full active:opacity-60"
              >
                <ChevronRight size={18} color="#71717a" />
              </Pressable>
            </View>

            <View className="rounded-2xl border border-zinc-200 dark:border-white/10 bg-zinc-50 dark:bg-[#121215] p-3 gap-2">
              <View className="flex-row">
                {WEEKDAYS.map((label, index) => (
                  <View key={`${label}-${index}`} className="flex-1 items-center">
                    <Text className="text-[10px] font-semibold text-zinc-400">{label}</Text>
                  </View>
                ))}
              </View>
              <View className="flex-row flex-wrap">
                {monthGrid.map((cell) => {
                  const dayEvents = cell.inMonth ? byDay.get(cell.key) ?? [] : [];
                  const isSelected = cell.key === selectedDay;
                  const isToday = cell.key === todayKey();
                  return (
                    <Pressable
                      key={cell.key}
                      disabled={!cell.inMonth}
                      onPress={() => setSelectedDay(cell.key)}
                      className="w-[14.28%] h-11 items-center justify-center"
                    >
                      <View
                        className={`h-7 w-7 items-center justify-center rounded-full ${
                          isSelected
                            ? 'bg-zinc-900 dark:bg-white'
                            : isToday
                              ? 'border border-zinc-900 dark:border-white'
                              : ''
                        }`}
                      >
                        <Text
                          className={`text-xs font-semibold ${
                            !cell.inMonth
                              ? 'text-zinc-300 dark:text-zinc-700'
                              : isSelected
                                ? 'text-white dark:text-zinc-900'
                                : 'text-zinc-700 dark:text-zinc-200'
                          }`}
                        >
                          {cell.inMonth ? cell.day : ''}
                        </Text>
                      </View>
                      {dayEvents.length > 0 ? (
                        <View className="flex-row gap-0.5 mt-0.5">
                          {dayEvents.slice(0, 3).map((event) => (
                            <View
                              key={`${event.id}-${event.startsAt}`}
                              className="h-1 w-1 rounded-full bg-violet-500"
                            />
                          ))}
                        </View>
                      ) : null}
                    </Pressable>
                  );
                })}
              </View>
            </View>

            <View className="gap-2">
              <Text className="text-xs font-semibold uppercase tracking-wider text-zinc-400 dark:text-zinc-500 px-1">
                {formatDayLabel(`${selectedDay}T12:00:00+05:30`, DEFAULT_TIMEZONE)}
              </Text>
              <View className="rounded-2xl border border-zinc-200 dark:border-white/10 bg-zinc-50 dark:bg-[#121215] overflow-hidden">
                {(byDay.get(selectedDay) ?? []).length === 0 ? (
                  <Text className="px-4 py-5 text-center text-xs text-zinc-500">
                    No events on this day.
                  </Text>
                ) : (
                  (byDay.get(selectedDay) ?? []).map((event) => renderEvent(event))
                )}
              </View>
            </View>
          </View>
        ) : mode === 'week' ? (
          <View className="gap-3">
            <View className="flex-row items-center justify-between">
              <Pressable
                onPress={() =>
                  setCursor((current) => new Date(current.getTime() - 7 * 86_400_000))
                }
                accessibilityRole="button"
                accessibilityLabel="Previous week"
                className="h-8 w-8 items-center justify-center rounded-full active:opacity-60"
              >
                <ChevronLeft size={18} color="#71717a" />
              </Pressable>
              <Text className="text-sm font-bold text-zinc-900 dark:text-white">
                {new Intl.DateTimeFormat('en-IN', { month: 'long', year: 'numeric' }).format(cursor)}
              </Text>
              <Pressable
                onPress={() =>
                  setCursor((current) => new Date(current.getTime() + 7 * 86_400_000))
                }
                accessibilityRole="button"
                accessibilityLabel="Next week"
                className="h-8 w-8 items-center justify-center rounded-full active:opacity-60"
              >
                <ChevronRight size={18} color="#71717a" />
              </Pressable>
            </View>

            {weekDays.map((date) => {
              const key = dayKey(date, DEFAULT_TIMEZONE);
              const dayEvents = byDay.get(key) ?? [];
              return (
                <View key={key} className="gap-1.5">
                  <View className="flex-row items-center gap-2 px-1">
                    <Text className="text-xs font-semibold uppercase tracking-wider text-zinc-400 dark:text-zinc-500">
                      {formatDayLabel(date, DEFAULT_TIMEZONE)}
                    </Text>
                    <Text className="text-[10px] text-zinc-400">
                      {new Intl.DateTimeFormat('en-IN', {
                        day: 'numeric',
                        month: 'short',
                      }).format(date)}
                    </Text>
                  </View>
                  <View className="rounded-2xl border border-zinc-200 dark:border-white/10 bg-zinc-50 dark:bg-[#121215] overflow-hidden">
                    {dayEvents.length === 0 ? (
                      <Text className="px-4 py-3 text-xs text-zinc-400">Free</Text>
                    ) : (
                      dayEvents.map((event) => renderEvent(event))
                    )}
                  </View>
                </View>
              );
            })}
          </View>
        ) : (
          <View className="gap-2">
            {agenda.length === 0 ? (
              <View className="mt-16 items-center justify-center px-6 gap-3">
                <View className="h-16 w-16 items-center justify-center rounded-3xl border border-zinc-200 dark:border-white/10 bg-zinc-50 dark:bg-white/5">
                  <CalendarDays size={28} color="#71717a" />
                </View>
                <Text className="text-base font-semibold text-zinc-900 dark:text-white">
                  Nothing on the calendar
                </Text>
                <Text className="text-xs text-zinc-500 text-center max-w-xs">
                  Tap + to schedule something, or ask an agent to add an event.
                </Text>
              </View>
            ) : (
              <View className="rounded-2xl border border-zinc-200 dark:border-white/10 bg-zinc-50 dark:bg-[#121215] overflow-hidden">
                {agenda.map((event) => renderEvent(event))}
              </View>
            )}
          </View>
        )}
      </ScrollView>

      {/* Event editor */}
      <Modal visible={editorOpen} transparent animationType="slide" onRequestClose={() => setEditorOpen(false)}>
        <View className="flex-1 justify-end bg-black/40">
          <View className="rounded-t-3xl border-t border-zinc-200 dark:border-white/10 bg-white dark:bg-[#121215] p-5 gap-3 max-h-[90%]">
            <ScrollView keyboardShouldPersistTaps="handled">
              <View className="flex-row items-center justify-between mb-1">
                <Text className="text-base font-bold text-zinc-900 dark:text-white">
                  {editing ? 'Edit event' : 'New event'}
                </Text>
                <Pressable onPress={() => setEditorOpen(false)} accessibilityRole="button">
                  <X size={18} color="#71717a" />
                </Pressable>
              </View>

              <TextInput
                className="rounded-2xl border border-zinc-200 dark:border-white/10 bg-zinc-50 dark:bg-white/5 px-3.5 py-3 text-sm text-zinc-900 dark:text-white"
                placeholder="Event title"
                placeholderTextColor="#71717a"
                value={title}
                onChangeText={setTitle}
              />

              <View className="flex-row items-center gap-2 mt-2">
                <TextInput
                  className="flex-1 rounded-2xl border border-zinc-200 dark:border-white/10 bg-zinc-50 dark:bg-white/5 px-3.5 py-2.5 text-sm text-zinc-900 dark:text-white"
                  placeholder="YYYY-MM-DD"
                  placeholderTextColor="#71717a"
                  value={dateText}
                  onChangeText={setDateText}
                  autoCapitalize="none"
                />
                <TextInput
                  className="w-24 rounded-2xl border border-zinc-200 dark:border-white/10 bg-zinc-50 dark:bg-white/5 px-3.5 py-2.5 text-sm text-zinc-900 dark:text-white"
                  placeholder="09:00"
                  placeholderTextColor="#71717a"
                  value={startText}
                  onChangeText={setStartText}
                  autoCapitalize="none"
                />
                <TextInput
                  className="w-24 rounded-2xl border border-zinc-200 dark:border-white/10 bg-zinc-50 dark:bg-white/5 px-3.5 py-2.5 text-sm text-zinc-900 dark:text-white"
                  placeholder="10:00"
                  placeholderTextColor="#71717a"
                  value={endText}
                  onChangeText={setEndText}
                  autoCapitalize="none"
                />
              </View>

              <TextInput
                className="rounded-2xl border border-zinc-200 dark:border-white/10 bg-zinc-50 dark:bg-white/5 px-3.5 py-2.5 text-sm text-zinc-900 dark:text-white mt-2"
                placeholder="Location (optional)"
                placeholderTextColor="#71717a"
                value={location}
                onChangeText={setLocation}
              />

              <View className="flex-row items-center justify-between mt-3">
                <Text className="text-sm text-zinc-600 dark:text-zinc-300">All day</Text>
                <Switch value={allDay} onValueChange={setAllDay} />
              </View>
              <View className="flex-row items-center justify-between mt-2">
                <Text className="text-sm text-zinc-600 dark:text-zinc-300">Repeat weekly</Text>
                <Switch value={weekly} onValueChange={setWeekly} />
              </View>
              {!allDay ? (
                <View className="flex-row items-center gap-2 mt-3">
                  <Text className="text-sm text-zinc-600 dark:text-zinc-300">Remind</Text>
                  <TextInput
                    className="w-20 rounded-2xl border border-zinc-200 dark:border-white/10 bg-zinc-50 dark:bg-white/5 px-3.5 py-2 text-sm text-zinc-900 dark:text-white"
                    keyboardType="number-pad"
                    value={remindMinutes}
                    onChangeText={setRemindMinutes}
                  />
                  <Text className="text-sm text-zinc-500">minutes before</Text>
                </View>
              ) : null}

              <View className="flex-row items-center gap-2 mt-5">
                {editing ? (
                  <Pressable
                    onPress={() => handleDelete(editing)}
                    accessibilityRole="button"
                    className="h-11 w-11 items-center justify-center rounded-2xl border border-red-500/30 bg-red-500/10 active:opacity-70"
                  >
                    <Trash2 size={16} color="#ef4444" />
                  </Pressable>
                ) : null}
                <Pressable
                  onPress={() => void handleSave()}
                  disabled={saving || !title.trim()}
                  className="flex-1 h-11 items-center justify-center rounded-2xl bg-zinc-900 dark:bg-white active:opacity-80 disabled:opacity-40"
                >
                  {saving ? (
                    <Spinner size="sm" color="default" />
                  ) : (
                    <Text className="text-sm font-bold text-white dark:text-zinc-900">
                      {editing ? 'Save changes' : 'Create event'}
                    </Text>
                  )}
                </Pressable>
              </View>
            </ScrollView>
          </View>
        </View>
      </Modal>
    </View>
  );
}
