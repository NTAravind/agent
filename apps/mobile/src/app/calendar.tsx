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
import { reportAppError } from '@/components/error-dialog-provider';
import {
  GroupedCard,
  HairlineDivider,
  PillButton,
  RoundButton,
  SectionLabel,
} from '@/components/design-system';
import { colors, radius, shadow, space } from '@/theme';
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
      reportAppError(error, { title: editing ? 'Could not update event' : 'Could not create event' });
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
              .catch((error) => reportAppError(error, { title: 'Could not delete event' }));
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
      style={{
        flexDirection: 'row',
        alignItems: 'center',
        gap: space.md,
        paddingHorizontal: space.lg,
        paddingVertical: space.md,
      }}
    >
      <View style={{ width: 56 }}>
        <Text style={{ fontSize: 13, fontWeight: '600', color: colors.textPrimary }}>
          {event.allDay ? 'All day' : formatTime(event.startsAt)}
        </Text>
        {!event.allDay ? (
          <Text style={{ fontSize: 11, color: colors.textSecondary, marginTop: 1 }}>{formatTime(event.endsAt)}</Text>
        ) : null}
      </View>
      <View style={{ flex: 1, minWidth: 0 }}>
        <View style={{ flexDirection: 'row', alignItems: 'center', gap: 6 }}>
          <Text style={{ fontSize: 15, fontWeight: '500', color: colors.textPrimary }}>{event.title}</Text>
          {event.rrule ? (
            <Text style={{ fontSize: 11, color: colors.textSecondary }}>↻</Text>
          ) : null}
        </View>
        {event.location ? (
          <View style={{ flexDirection: 'row', alignItems: 'center', gap: 4, marginTop: 2 }}>
            <MapPin size={11} color={colors.textSecondary} />
            <Text style={{ fontSize: 12, color: colors.textSecondary }}>{event.location}</Text>
          </View>
        ) : null}
      </View>
    </Pressable>
  );

  const handleBack = useCallback(() => {
    if (router.canGoBack()) {
      router.back();
    } else {
      router.replace('/' as never);
    }
  }, [router]);

  return (
    <View style={{ flex: 1, backgroundColor: colors.background }}>
      <AppHeader
        left={
          <RoundButton
            icon={ChevronLeft}
            onPress={handleBack}
            accessibilityLabel="Go back"
          />
        }
        center={
          <Text style={{ fontSize: 17, lineHeight: 22, fontWeight: '600', color: colors.textPrimary }}>
            Calendar
          </Text>
        }
        right={
          <RoundButton
            icon={Plus}
            onPress={() => openEditor()}
            accessibilityLabel="New event"
          />
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
            tintColor={colors.textPrimary}
          />
        }
      >
        {/* Mode switch */}
        <View style={{ flexDirection: 'row', borderRadius: radius.pill, backgroundColor: colors.surface, padding: 4 }}>
          {(['month', 'week', 'agenda'] as ViewMode[]).map((value) => (
            <Pressable
              key={value}
              onPress={() => setMode(value)}
              style={[
                {
                  flex: 1,
                  alignItems: 'center',
                  borderRadius: radius.pill,
                  paddingVertical: 8,
                },
                mode === value && {
                  backgroundColor: colors.surfaceRaised,
                  ...shadow.floating,
                },
              ]}
            >
              <Text
                style={{
                  fontSize: 13,
                  fontWeight: mode === value ? '600' : '400',
                  color: mode === value ? colors.textPrimary : colors.textSecondary,
                  textTransform: 'capitalize',
                }}
              >
                {value}
              </Text>
            </Pressable>
          ))}
        </View>

        {notice ? (
          <View style={{ backgroundColor: colors.surface, borderRadius: radius.card, paddingHorizontal: 14, paddingVertical: 10 }}>
            <Text style={{ fontSize: 13, color: colors.textSecondary }}>{notice}</Text>
          </View>
        ) : null}

        {loading ? (
          <View style={{ paddingVertical: 64, alignItems: 'center', justifyContent: 'center' }}>
            <Spinner size="lg" color="default" />
          </View>
        ) : mode === 'month' ? (
          <View style={{ gap: space.md }}>
            <View style={{ flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', paddingHorizontal: space.xs }}>
              <Pressable
                onPress={() =>
                  setCursor((current) => new Date(current.getFullYear(), current.getMonth() - 1, 1))
                }
                accessibilityRole="button"
                accessibilityLabel="Previous month"
                style={{ width: 36, height: 36, alignItems: 'center', justifyContent: 'center' }}
              >
                <ChevronLeft size={20} color={colors.textSecondary} />
              </Pressable>
              <Text style={{ fontSize: 17, fontWeight: '600', color: colors.textPrimary }}>
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
                style={{ width: 36, height: 36, alignItems: 'center', justifyContent: 'center' }}
              >
                <ChevronRight size={20} color={colors.textSecondary} />
              </Pressable>
            </View>

            <GroupedCard style={{ padding: space.md, gap: space.sm }}>
              <View style={{ flexDirection: 'row' }}>
                {WEEKDAYS.map((label, index) => (
                  <View key={`${label}-${index}`} style={{ flex: 1, alignItems: 'center' }}>
                    <Text style={{ fontSize: 11, fontWeight: '600', color: colors.textSecondary }}>{label}</Text>
                  </View>
                ))}
              </View>
              <View style={{ flexDirection: 'row', flexWrap: 'wrap' }}>
                {monthGrid.map((cell) => {
                  const dayEvents = cell.inMonth ? byDay.get(cell.key) ?? [] : [];
                  const isSelected = cell.key === selectedDay;
                  const isToday = cell.key === todayKey();
                  return (
                    <Pressable
                      key={cell.key}
                      disabled={!cell.inMonth}
                      onPress={() => setSelectedDay(cell.key)}
                      style={{ width: '14.28%', height: 44, alignItems: 'center', justifyContent: 'center' }}
                    >
                      <View
                        style={[
                          { width: 28, height: 28, alignItems: 'center', justifyContent: 'center', borderRadius: radius.pill },
                          isSelected && { backgroundColor: colors.primary },
                          !isSelected && isToday && { borderWidth: 1, borderColor: colors.primary },
                        ]}
                      >
                        <Text
                          style={[
                            { fontSize: 13, fontWeight: '500' },
                            !cell.inMonth
                              ? { color: colors.textTertiary }
                              : isSelected
                                ? { color: colors.onPrimary, fontWeight: '600' }
                                : { color: colors.textPrimary },
                          ]}
                        >
                          {cell.inMonth ? cell.day : ''}
                        </Text>
                      </View>
                      {dayEvents.length > 0 ? (
                        <View style={{ flexDirection: 'row', gap: 2, marginTop: 2 }}>
                          {dayEvents.slice(0, 3).map((event) => (
                            <View
                              key={`${event.id}-${event.startsAt}`}
                              style={{ width: 4, height: 4, borderRadius: 2, backgroundColor: isSelected ? colors.onPrimary : colors.primary }}
                            />
                          ))}
                        </View>
                      ) : null}
                    </Pressable>
                  );
                })}
              </View>
            </GroupedCard>

            <View style={{ gap: space.xs }}>
              <SectionLabel text={formatDayLabel(`${selectedDay}T12:00:00+05:30`, DEFAULT_TIMEZONE)} />
              <GroupedCard>
                {(byDay.get(selectedDay) ?? []).length === 0 ? (
                  <Text style={{ paddingHorizontal: space.lg, paddingVertical: space.xl, textAlign: 'center', fontSize: 15, color: colors.textSecondary }}>
                    No events on this day.
                  </Text>
                ) : (
                  (byDay.get(selectedDay) ?? []).map((event, index) => (
                    <View key={`${event.id}-${event.startsAt}`}>
                      {index > 0 && <HairlineDivider inset={72} />}
                      {renderEvent(event)}
                    </View>
                  ))
                )}
              </GroupedCard>
            </View>
          </View>
        ) : mode === 'week' ? (
          <View style={{ gap: space.md }}>
            <View style={{ flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', paddingHorizontal: space.xs }}>
              <Pressable
                onPress={() =>
                  setCursor((current) => new Date(current.getTime() - 7 * 86_400_000))
                }
                accessibilityRole="button"
                accessibilityLabel="Previous week"
                style={{ width: 36, height: 36, alignItems: 'center', justifyContent: 'center' }}
              >
                <ChevronLeft size={20} color={colors.textSecondary} />
              </Pressable>
              <Text style={{ fontSize: 17, fontWeight: '600', color: colors.textPrimary }}>
                {new Intl.DateTimeFormat('en-IN', { month: 'long', year: 'numeric' }).format(cursor)}
              </Text>
              <Pressable
                onPress={() =>
                  setCursor((current) => new Date(current.getTime() + 7 * 86_400_000))
                }
                accessibilityRole="button"
                accessibilityLabel="Next week"
                style={{ width: 36, height: 36, alignItems: 'center', justifyContent: 'center' }}
              >
                <ChevronRight size={20} color={colors.textSecondary} />
              </Pressable>
            </View>

            {weekDays.map((date) => {
              const key = dayKey(date, DEFAULT_TIMEZONE);
              const dayEvents = byDay.get(key) ?? [];
              return (
                <View key={key} style={{ gap: space.xs }}>
                  <SectionLabel text={`${formatDayLabel(date, DEFAULT_TIMEZONE)} · ${new Intl.DateTimeFormat('en-IN', { day: 'numeric', month: 'short' }).format(date)}`} />
                  <GroupedCard>
                    {dayEvents.length === 0 ? (
                      <Text style={{ paddingHorizontal: space.lg, paddingVertical: space.md, fontSize: 15, color: colors.textTertiary }}>Free</Text>
                    ) : (
                      dayEvents.map((event, index) => (
                        <View key={`${event.id}-${event.startsAt}`}>
                          {index > 0 && <HairlineDivider inset={72} />}
                          {renderEvent(event)}
                        </View>
                      ))
                    )}
                  </GroupedCard>
                </View>
              );
            })}
          </View>
        ) : (
          <View style={{ gap: space.md }}>
            {agenda.length === 0 ? (
              <View style={{ marginTop: 64, alignItems: 'center', justifyContent: 'center', paddingHorizontal: space.xl, gap: space.md }}>
                <View style={{ width: 64, height: 64, alignItems: 'center', justifyContent: 'center', borderRadius: radius.card, backgroundColor: colors.surface }}>
                  <CalendarDays size={28} color={colors.textSecondary} />
                </View>
                <Text style={{ fontSize: 17, fontWeight: '600', color: colors.textPrimary }}>
                  Nothing on the calendar
                </Text>
                <Text style={{ fontSize: 14, color: colors.textSecondary, textAlign: 'center', maxWidth: 260 }}>
                  Tap + to schedule something, or ask an agent to add an event.
                </Text>
              </View>
            ) : (
              <GroupedCard>
                {agenda.map((event, index) => (
                  <View key={`${event.id}-${event.startsAt}`}>
                    {index > 0 && <HairlineDivider inset={72} />}
                    {renderEvent(event)}
                  </View>
                ))}
              </GroupedCard>
            )}
          </View>
        )}
      </ScrollView>

      {/* Event editor modal */}
      <Modal visible={editorOpen} transparent animationType="slide" onRequestClose={() => setEditorOpen(false)}>
        <View style={{ flex: 1, justifyContent: 'flex-end', backgroundColor: colors.overlay }}>
          <View
            style={{
              borderTopLeftRadius: radius.sheet,
              borderTopRightRadius: radius.sheet,
              backgroundColor: colors.surfaceRaised,
              padding: space.xl,
              paddingBottom: Math.max(insets.bottom + space.lg, space.xl),
              gap: space.md,
              maxHeight: '90%',
            }}
          >
            <ScrollView keyboardShouldPersistTaps="handled">
              <View style={{ flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', marginBottom: space.sm }}>
                <Text style={{ fontSize: 20, fontWeight: '600', color: colors.textPrimary }}>
                  {editing ? 'Edit event' : 'New event'}
                </Text>
                <RoundButton
                  icon={X}
                  onPress={() => setEditorOpen(false)}
                  accessibilityLabel="Close editor"
                />
              </View>

              <TextInput
                style={{
                  backgroundColor: colors.surface,
                  borderRadius: radius.card,
                  paddingHorizontal: space.lg,
                  paddingVertical: space.md,
                  fontSize: 16,
                  color: colors.textPrimary,
                }}
                placeholder="Event title"
                placeholderTextColor={colors.textSecondary}
                value={title}
                onChangeText={setTitle}
              />

              <View style={{ flexDirection: 'row', alignItems: 'center', gap: space.sm, marginTop: space.sm }}>
                <TextInput
                  style={{
                    flex: 1,
                    backgroundColor: colors.surface,
                    borderRadius: radius.card,
                    paddingHorizontal: space.md,
                    paddingVertical: space.sm,
                    fontSize: 15,
                    color: colors.textPrimary,
                  }}
                  placeholder="YYYY-MM-DD"
                  placeholderTextColor={colors.textSecondary}
                  value={dateText}
                  onChangeText={setDateText}
                  autoCapitalize="none"
                />
                <TextInput
                  style={{
                    width: 90,
                    backgroundColor: colors.surface,
                    borderRadius: radius.card,
                    paddingHorizontal: space.md,
                    paddingVertical: space.sm,
                    fontSize: 15,
                    color: colors.textPrimary,
                  }}
                  placeholder="09:00"
                  placeholderTextColor={colors.textSecondary}
                  value={startText}
                  onChangeText={setStartText}
                  autoCapitalize="none"
                />
                <TextInput
                  style={{
                    width: 90,
                    backgroundColor: colors.surface,
                    borderRadius: radius.card,
                    paddingHorizontal: space.md,
                    paddingVertical: space.sm,
                    fontSize: 15,
                    color: colors.textPrimary,
                  }}
                  placeholder="10:00"
                  placeholderTextColor={colors.textSecondary}
                  value={endText}
                  onChangeText={setEndText}
                  autoCapitalize="none"
                />
              </View>

              <TextInput
                style={{
                  backgroundColor: colors.surface,
                  borderRadius: radius.card,
                  paddingHorizontal: space.lg,
                  paddingVertical: space.sm,
                  fontSize: 15,
                  color: colors.textPrimary,
                  marginTop: space.sm,
                }}
                placeholder="Location (optional)"
                placeholderTextColor={colors.textSecondary}
                value={location}
                onChangeText={setLocation}
              />

              <View style={{ flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', marginTop: space.md, paddingHorizontal: space.xs }}>
                <Text style={{ fontSize: 16, color: colors.textPrimary }}>All day</Text>
                <Switch value={allDay} onValueChange={setAllDay} />
              </View>
              <View style={{ flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', marginTop: space.sm, paddingHorizontal: space.xs }}>
                <Text style={{ fontSize: 16, color: colors.textPrimary }}>Repeat weekly</Text>
                <Switch value={weekly} onValueChange={setWeekly} />
              </View>
              {!allDay ? (
                <View style={{ flexDirection: 'row', alignItems: 'center', gap: space.sm, marginTop: space.sm, paddingHorizontal: space.xs }}>
                  <Text style={{ fontSize: 15, color: colors.textPrimary }}>Remind</Text>
                  <TextInput
                    style={{
                      width: 70,
                      backgroundColor: colors.surface,
                      borderRadius: radius.tile,
                      paddingHorizontal: space.sm,
                      paddingVertical: 6,
                      fontSize: 14,
                      color: colors.textPrimary,
                      textAlign: 'center',
                    }}
                    keyboardType="number-pad"
                    value={remindMinutes}
                    onChangeText={setRemindMinutes}
                  />
                  <Text style={{ fontSize: 15, color: colors.textSecondary }}>minutes before</Text>
                </View>
              ) : null}

              <View style={{ flexDirection: 'row', alignItems: 'center', gap: space.sm, marginTop: space.xl }}>
                {editing ? (
                  <Pressable
                    onPress={() => handleDelete(editing)}
                    accessibilityRole="button"
                    accessibilityLabel="Delete event"
                    style={{
                      width: 44,
                      height: 44,
                      alignItems: 'center',
                      justifyContent: 'center',
                      borderRadius: radius.pill,
                      backgroundColor: colors.recordingBg,
                    }}
                  >
                    <Trash2 size={16} color={colors.recording} />
                  </Pressable>
                ) : null}
                <View style={{ flex: 1 }}>
                  <PillButton
                    label={editing ? 'Save changes' : 'Create event'}
                    onPress={() => void handleSave()}
                    disabled={saving || !title.trim()}
                    variant="primary"
                  />
                </View>
              </View>
            </ScrollView>
          </View>
        </View>
      </Modal>
    </View>
  );
}
