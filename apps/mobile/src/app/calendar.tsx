import { useCallback, useMemo, useState } from 'react';
import {
  Alert,
  FlatList,
  Modal,
  Pressable,
  RefreshControl,
  ScrollView,
  StyleSheet,
  Switch,
  Text,
  TextInput,
  View,
} from 'react-native';
import { Spinner, Typography } from 'heroui-native';
import { useFocusEffect, useRouter } from 'expo-router';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { CalendarDays, ChevronLeft, ChevronRight, MapPin, Plus, Trash2, X } from 'lucide-react-native';
import { SymbolIcon } from '@/components/symbol-icon';
import type { CalendarEvent } from '@agent/shared';

import { AppHeader, useHeaderInset } from '@/components/app-header';
import { reportAppError } from '@/components/error-dialog-provider';
import {
  GroupedCard,
  HairlineDivider,
  InlineError,
  PillButton,
  RoundButton,
  SectionLabel,
} from '@/components/design-system';
import { colors, radius, shadow, space } from '@/theme';
import { DEFAULT_TIMEZONE, dayKey, formatDayLabel, formatTime } from '@/lib/dates';
import { createEvent, deleteEvent, fetchEvents, updateEvent } from '@/lib/productivity';

type ViewMode = 'month' | 'week' | 'agenda';

/**
 * One row of the virtualized calendar. Event cells carry first/last flags so
 * each renders only its slice of the grouped card — the agenda can hold
 * hundreds of expanded recurrence rows, which is the whole point.
 */
type CalendarCell =
  | { key: string; type: 'nav' }
  | { key: string; type: 'month-grid' }
  | { key: string; type: 'day-label'; text: string }
  | { key: string; type: 'day-empty'; text: string; variant: 'selected' | 'week' }
  | {
      key: string;
      type: 'event';
      event: CalendarEvent;
      first: boolean;
      last: boolean;
    }
  | { key: string; type: 'agenda-empty' };

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
            <SymbolIcon icon={MapPin} size={11} color={colors.textSecondary} />
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

  const headerInset = useHeaderInset();

  // Mode-dependent flat cell list so event rows virtualize (the agenda spans
  // ~211 days of expanded recurrences). Spacing that used to come from
  // nested `gap`s now lives on the cells and the header.
  const calendarCells = useMemo<CalendarCell[]>(() => {
    if (loading) return [];

    const dayCells = (
      labelKey: string,
      label: string,
      events: CalendarEvent[],
      emptyText: string,
      emptyVariant: 'selected' | 'week',
    ): CalendarCell[] => {
      const out: CalendarCell[] = [
        { key: `label-${labelKey}`, type: 'day-label', text: label },
      ];
      if (events.length === 0) {
        out.push({
          key: `empty-${labelKey}`,
          type: 'day-empty',
          text: emptyText,
          variant: emptyVariant,
        });
      } else {
        events.forEach((event, index) =>
          out.push({
            key: `${event.id}-${event.startsAt}`,
            type: 'event',
            event,
            first: index === 0,
            last: index === events.length - 1,
          }),
        );
      }
      return out;
    };

    if (mode === 'month') {
      return [
        { key: 'nav', type: 'nav' },
        { key: 'month-grid', type: 'month-grid' },
        ...dayCells(
          selectedDay,
          formatDayLabel(`${selectedDay}T12:00:00+05:30`, DEFAULT_TIMEZONE),
          byDay.get(selectedDay) ?? [],
          'No events on this day.',
          'selected',
        ),
      ];
    }

    if (mode === 'week') {
      const cells: CalendarCell[] = [{ key: 'nav', type: 'nav' }];
      weekDays.forEach((date) => {
        const key = dayKey(date, DEFAULT_TIMEZONE);
        cells.push(
          ...dayCells(
            key,
            `${formatDayLabel(date, DEFAULT_TIMEZONE)} · ${new Intl.DateTimeFormat('en-IN', { day: 'numeric', month: 'short' }).format(date)}`,
            byDay.get(key) ?? [],
            'Free',
            'week',
          ),
        );
      });
      return cells;
    }

    if (agenda.length === 0) return [{ key: 'agenda-empty', type: 'agenda-empty' }];
    return agenda.map((event, index) => ({
      key: `${event.id}-${event.startsAt}`,
      type: 'event' as const,
      event,
      first: index === 0,
      last: index === agenda.length - 1,
    }));
  }, [loading, mode, byDay, selectedDay, weekDays, agenda]);

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

      <FlatList
        data={loading ? [] : calendarCells}
        keyExtractor={(cell) => cell.key}
        renderItem={({ item: cell }) => {
          if (cell.type === 'nav') {
            return mode === 'month' ? (
              <View style={styles.navRow}>
                <Pressable
                  onPress={() =>
                    setCursor((current) => new Date(current.getFullYear(), current.getMonth() - 1, 1))
                  }
                  accessibilityRole="button"
                  accessibilityLabel="Previous month"
                  style={styles.navButton}
                >
                  <SymbolIcon icon={ChevronLeft} size={20} color={colors.textSecondary} />
                </Pressable>
                <Text style={styles.navTitle}>
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
                  style={styles.navButton}
                >
                  <SymbolIcon icon={ChevronRight} size={20} color={colors.textSecondary} />
                </Pressable>
              </View>
            ) : (
              <View style={styles.navRow}>
                <Pressable
                  onPress={() =>
                    setCursor((current) => new Date(current.getTime() - 7 * 86_400_000))
                  }
                  accessibilityRole="button"
                  accessibilityLabel="Previous week"
                  style={styles.navButton}
                >
                  <SymbolIcon icon={ChevronLeft} size={20} color={colors.textSecondary} />
                </Pressable>
                <Text style={styles.navTitle}>
                  {new Intl.DateTimeFormat('en-IN', { month: 'long', year: 'numeric' }).format(cursor)}
                </Text>
                <Pressable
                  onPress={() =>
                    setCursor((current) => new Date(current.getTime() + 7 * 86_400_000))
                  }
                  accessibilityRole="button"
                  accessibilityLabel="Next week"
                  style={styles.navButton}
                >
                  <SymbolIcon icon={ChevronRight} size={20} color={colors.textSecondary} />
                </Pressable>
              </View>
            );
          }

          if (cell.type === 'month-grid') {
            return (
              <View style={styles.gridCell}>
                <GroupedCard style={{ padding: space.md, gap: space.sm }}>
                  <View style={{ flexDirection: 'row' }}>
                    {WEEKDAYS.map((label, index) => (
                      <View key={`${label}-${index}`} style={{ flex: 1, alignItems: 'center' }}>
                        <Text style={{ fontSize: 11, fontWeight: '600', color: colors.textSecondary }}>{label}</Text>
                      </View>
                    ))}
                  </View>
                  <View style={{ flexDirection: 'row', flexWrap: 'wrap' }}>
                    {monthGrid.map((gridCell) => {
                      const dayEvents = gridCell.inMonth ? byDay.get(gridCell.key) ?? [] : [];
                      const isSelected = gridCell.key === selectedDay;
                      const isToday = gridCell.key === todayKey();
                      return (
                        <Pressable
                          key={gridCell.key}
                          disabled={!gridCell.inMonth}
                          onPress={() => setSelectedDay(gridCell.key)}
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
                                !gridCell.inMonth
                                  ? { color: colors.textTertiary }
                                  : isSelected
                                    ? { color: colors.onPrimary, fontWeight: '600' }
                                    : { color: colors.textPrimary },
                              ]}
                            >
                              {gridCell.inMonth ? gridCell.day : ''}
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
              </View>
            );
          }

          if (cell.type === 'day-label') {
            return (
              <View style={styles.dayLabelCell}>
                <SectionLabel text={cell.text} />
              </View>
            );
          }

          if (cell.type === 'day-empty') {
            return (
              <GroupedCard>
                <Text
                  style={
                    cell.variant === 'selected'
                      ? styles.dayEmptySelected
                      : styles.dayEmptyWeek
                  }
                >
                  {cell.text}
                </Text>
              </GroupedCard>
            );
          }

          if (cell.type === 'agenda-empty') {
            return (
              <View style={styles.agendaEmpty}>
                <View style={{ width: 64, height: 64, alignItems: 'center', justifyContent: 'center', borderRadius: radius.card, backgroundColor: colors.surface }}>
                  <SymbolIcon icon={CalendarDays} size={28} color={colors.textSecondary} />
                </View>
                <Text style={{ fontSize: 17, fontWeight: '600', color: colors.textPrimary }}>
                  Nothing on the calendar
                </Text>
                <Text style={{ fontSize: 14, color: colors.textSecondary, textAlign: 'center', maxWidth: 260 }}>
                  Tap + to schedule something, or ask an agent to add an event.
                </Text>
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
              {!cell.first ? <HairlineDivider inset={72} /> : null}
              {renderEvent(cell.event)}
            </View>
          );
        }}
        ListHeaderComponent={
          <View style={styles.listHeader}>
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

            {notice ? <InlineError message={notice} onRetry={() => void load()} /> : null}
          </View>
        }
        ListEmptyComponent={
          loading ? (
            <View style={styles.loadingCell}>
              <Spinner size="lg" color="default" />
            </View>
          ) : undefined
        }
        contentContainerStyle={{
          padding: 16,
          paddingTop: headerInset,
          paddingBottom: insets.bottom + 32,
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
                      backgroundColor: colors.surface,
                    }}
                  >
                    <SymbolIcon icon={Trash2} size={16} color={colors.danger} />
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

/**
 * Styles for the virtualized calendar cells. The rest of this screen uses
 * inline styles; these exist because the cell list repeats the same shapes
 * many times.
 */
const styles = StyleSheet.create({
  listHeader: {
    gap: 14,
    // Replaces the content container's old 14pt gap below the header.
    marginBottom: 14,
  },
  navRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingHorizontal: space.xs,
  },
  navButton: {
    width: 44,
    height: 44,
    borderRadius: radius.pill,
    backgroundColor: colors.surface,
    alignItems: 'center',
    justifyContent: 'center',
  },
  navTitle: {
    fontSize: 17,
    fontWeight: '600',
    color: colors.textPrimary,
  },
  gridCell: {
    marginTop: space.md,
  },
  dayLabelCell: {
    marginTop: space.md,
    // SectionLabel already adds its own 8pt marginBottom, so label→card is
    // the 8pt the spec asks for.
  },
  dayEmptySelected: {
    paddingHorizontal: space.lg,
    paddingVertical: space.xl,
    textAlign: 'center',
    fontSize: 15,
    color: colors.textSecondary,
  },
  dayEmptyWeek: {
    paddingHorizontal: space.lg,
    paddingVertical: space.md,
    fontSize: 15,
    color: colors.textTertiary,
  },
  agendaEmpty: {
    marginTop: 64,
    alignItems: 'center',
    justifyContent: 'center',
    paddingHorizontal: space.xl,
    gap: space.md,
  },
  loadingCell: {
    paddingVertical: 64,
    alignItems: 'center',
    justifyContent: 'center',
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
});
