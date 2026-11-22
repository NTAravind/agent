import { useCallback, useEffect, useMemo, useState } from 'react';
import {
  Alert,
  Modal,
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  TextInput,
  View,
} from 'react-native';
import { Spinner } from 'heroui-native';
import { CalendarClock, Pause, Play, Trash2, X } from 'lucide-react-native';
import type { RoutineSchedule, RoutineWithPreview, Weekday } from '@agent/shared';

import {
  GroupedCard,
  HairlineDivider,
  PillButton,
  RoundButton,
  SectionLabel,
} from '@/components/design-system';
import { colors, radius, space } from '@/theme';
import { formatDateTime } from '@/lib/dates';
import {
  deleteRoutine,
  fetchRoutineRuns,
  fetchRoutines,
  pauseRoutine,
  resumeRoutine,
  runRoutineNow,
  updateRoutine,
} from '@/lib/routines';

const WEEKDAY_CHIPS: { code: Weekday; label: string }[] = [
  { code: 'MO', label: 'M' },
  { code: 'TU', label: 'T' },
  { code: 'WE', label: 'W' },
  { code: 'TH', label: 'T' },
  { code: 'FR', label: 'F' },
  { code: 'SA', label: 'S' },
  { code: 'SU', label: 'S' },
];

type Props = {
  agentId?: string | null;
  visible: boolean;
  onClose: () => void;
  onChanged?: () => void;
};

/**
 * Routine list sheet: shows routines configured for this agent.
 */
export function RoutineListSheet({ agentId, visible, onClose, onChanged }: Props) {
  const [routines, setRoutines] = useState<RoutineWithPreview[]>([]);
  const [loading, setLoading] = useState(false);
  const [notice, setNotice] = useState<string | null>(null);
  const [openId, setOpenId] = useState<string | null>(null);

  const load = useCallback(async () => {
    setLoading(true);
    setNotice(null);
    try {
      const items = await fetchRoutines();
      setRoutines(agentId ? items.filter((r) => r.agentId === agentId) : items);
    } catch (err) {
      setNotice(err instanceof Error ? err.message : String(err));
    } finally {
      setLoading(false);
    }
  }, [agentId]);

  useEffect(() => {
    if (!visible) return;
    let active = true;
    void (async () => {
      setLoading(true);
      setNotice(null);
      try {
        const items = await fetchRoutines();
        if (active) setRoutines(agentId ? items.filter((r) => r.agentId === agentId) : items);
      } catch (err) {
        if (active) setNotice(err instanceof Error ? err.message : String(err));
      } finally {
        if (active) setLoading(false);
      }
    })();
    return () => {
      active = false;
    };
  }, [agentId, visible]);

  const selected = routines.find((routine) => routine.id === openId) ?? null;

  return (
    <Modal visible={visible} transparent animationType="fade" onRequestClose={onClose}>
      <View style={styles.overlay}>
        <View style={styles.sheetContainer}>
          <View style={styles.sheetHeader}>
            <Text style={styles.sheetTitle}>Routines</Text>
            <RoundButton
              icon={X}
              onPress={onClose}
              accessibilityLabel="Close"
              style={styles.sheetCloseButton}
            />
          </View>

          {notice ? (
            <Text style={styles.errorNotice}>{notice}</Text>
          ) : null}

          {loading ? (
            <View style={{ paddingVertical: 40, alignItems: 'center', justifyContent: 'center' }}>
              <Spinner size="lg" color="default" />
            </View>
          ) : routines.length === 0 ? (
            <View style={{ paddingVertical: 32, alignItems: 'center', gap: space.sm }}>
              <CalendarClock size={24} color={colors.textSecondary} />
              <Text style={{ fontSize: 13, color: colors.textSecondary, textAlign: 'center', maxWidth: 260 }}>
                No routines yet. Ask in the chat — “every Monday at 9 summarize my open tasks”.
              </Text>
            </View>
          ) : (
            <ScrollView showsVerticalScrollIndicator={false}>
              <GroupedCard>
                {routines.map((routine, index) => (
                  <View key={routine.id}>
                    {index > 0 && <HairlineDivider inset={space.lg} />}
                    <Pressable
                      onPress={() => setOpenId(routine.id)}
                      accessibilityRole="button"
                      accessibilityLabel={`Open ${routine.name}`}
                      style={{ padding: space.lg, gap: 4 }}
                    >
                      <View style={{ flexDirection: 'row', alignItems: 'center', gap: space.sm }}>
                        <Text style={{ flex: 1, fontSize: 16, fontWeight: '600', color: colors.textPrimary }}>
                          {routine.name}
                        </Text>
                        <View style={{ borderRadius: radius.pill, backgroundColor: colors.surfaceRaised, paddingHorizontal: 8, paddingVertical: 2 }}>
                          <Text style={{ fontSize: 11, fontWeight: '500', color: colors.textSecondary, textTransform: 'uppercase' }}>
                            {routine.status}
                          </Text>
                        </View>
                      </View>
                      <Text style={{ fontSize: 13, color: colors.textSecondary }}>{routine.scheduleLabel}</Text>
                      {routine.nextRuns[0] ? (
                        <Text style={{ fontSize: 12, color: colors.textTertiary }}>
                          {`Next: ${formatDateTime(routine.nextRuns[0], routine.tz)}`}
                        </Text>
                      ) : null}
                    </Pressable>
                  </View>
                ))}
              </GroupedCard>
            </ScrollView>
          )}

          <RoutineDetailSheet
            key={selected?.id ?? 'none'}
            routine={selected}
            onClose={() => setOpenId(null)}
            onChanged={() => {
              void load();
              onChanged?.();
            }}
          />
        </View>
      </View>
    </Modal>
  );
}

type DetailProps = {
  /** The routine to show. The sheet is mounted per routine (see `key`). */
  routine: RoutineWithPreview | null;
  onClose: () => void;
  onChanged?: () => void;
  /** Called when "Run now" queues a run (the chat can follow it). */
  onRunNow?: (runId: string) => void;
};

/** The routine drill-down: schedule, next run, pause/resume, edit, runs. */
export function RoutineDetailSheet({ routine, onClose, onChanged, onRunNow }: DetailProps) {
  const [runs, setRuns] = useState<Awaited<ReturnType<typeof fetchRoutineRuns>>>([]);
  const [busy, setBusy] = useState(false);
  const [notice, setNotice] = useState<string | null>(null);

  const [editing, setEditing] = useState(false);
  const [draftName, setDraftName] = useState(routine?.name ?? '');
  const [draftPrompt, setDraftPrompt] = useState(routine?.prompt ?? '');
  const [draftFrequency, setDraftFrequency] = useState<RoutineSchedule['frequency']>(
    routine?.schedule.frequency ?? 'weekly',
  );
  const [draftDays, setDraftDays] = useState<Weekday[]>(
    routine?.schedule.days_of_week ?? ['MO'],
  );
  const [draftTime, setDraftTime] = useState(routine?.schedule.time ?? '09:00');

  useEffect(() => {
    if (!routine) return;
    let active = true;
    void fetchRoutineRuns(routine.id)
      .then((result) => {
        if (active) setRuns(result);
      })
      .catch(() => {
        if (active) setRuns([]);
      });
    return () => {
      active = false;
    };
  }, [routine]);

  const withBusy = useCallback(
    async (action: () => Promise<void>) => {
      setBusy(true);
      setNotice(null);
      try {
        await action();
        onChanged?.();
      } catch (error) {
        setNotice(error instanceof Error ? error.message : String(error));
      } finally {
        setBusy(false);
      }
    },
    [onChanged],
  );

  const handleSave = useCallback(() => {
    if (!routine) return;
    const schedule: RoutineSchedule =
      draftFrequency === 'once'
        ? {
            frequency: 'once',
            time: draftTime,
            ...(routine.schedule.run_at ? { run_at: routine.schedule.run_at } : {}),
          }
        : {
            frequency: draftFrequency,
            time: draftTime,
            ...(draftFrequency === 'weekly' ? { days_of_week: draftDays } : {}),
            ...(draftFrequency === 'monthly'
              ? { day_of_month: routine.schedule.day_of_month ?? 1 }
              : {}),
          };
    void withBusy(async () => {
      await updateRoutine(routine.id, {
        name: draftName.trim() || routine.name,
        prompt: draftPrompt.trim() || routine.prompt,
        schedule,
      });
      setEditing(false);
    });
  }, [draftDays, draftFrequency, draftName, draftPrompt, draftTime, routine, withBusy]);

  const handleDelete = useCallback(() => {
    if (!routine) return;
    Alert.alert('Delete routine?', `“${routine.name}” will stop running automatically.`, [
      { text: 'Cancel', style: 'cancel' },
      {
        text: 'Delete',
        style: 'destructive',
        onPress: () => {
          void withBusy(async () => {
            await deleteRoutine(routine.id);
            onClose();
          });
        },
      },
    ]);
  }, [onClose, routine, withBusy]);

  const nextRunLabel = useMemo(() => {
    if (!routine?.nextRuns[0]) return null;
    return formatDateTime(routine.nextRuns[0], routine.tz);
  }, [routine]);

  if (!routine) return null;

  return (
    <Modal
      visible
      transparent
      animationType="fade"
      onRequestClose={onClose}
    >
      <View style={styles.overlay}>
        <View style={styles.sheetContainer}>
          <View style={styles.sheetHeader}>
            <Text style={styles.sheetTitle}>{routine.name}</Text>
            <RoundButton
              icon={X}
              onPress={onClose}
              accessibilityLabel="Close"
              style={styles.sheetCloseButton}
            />
          </View>

          {notice ? <Text style={styles.errorNotice}>{notice}</Text> : null}

          {editing ? (
            <ScrollView showsVerticalScrollIndicator={false} contentContainerStyle={{ gap: space.md }}>
              <TextInput
                style={styles.input}
                placeholder="Name"
                placeholderTextColor={colors.textSecondary}
                value={draftName}
                onChangeText={setDraftName}
              />
              <TextInput
                style={[styles.input, { minHeight: 70, textAlignVertical: 'top' }]}
                placeholder="What should the agent do?"
                placeholderTextColor={colors.textSecondary}
                value={draftPrompt}
                onChangeText={setDraftPrompt}
                multiline
              />
              <View style={{ flexDirection: 'row', gap: space.sm }}>
                {(['daily', 'weekly', 'monthly'] as const).map((frequency) => (
                  <Pressable
                    key={frequency}
                    onPress={() => setDraftFrequency(frequency)}
                    accessibilityRole="button"
                    style={[
                      styles.frequencyChip,
                      draftFrequency === frequency && styles.frequencyChipActive,
                    ]}
                  >
                    <Text
                      style={[
                        styles.frequencyChipText,
                        draftFrequency === frequency && styles.frequencyChipTextActive,
                      ]}
                    >
                      {frequency}
                    </Text>
                  </Pressable>
                ))}
              </View>
              {draftFrequency === 'weekly' ? (
                <View style={{ flexDirection: 'row', gap: space.sm }}>
                  {WEEKDAY_CHIPS.map((chip, index) => {
                    const active = draftDays.includes(chip.code);
                    return (
                      <Pressable
                        key={`${chip.code}-${index}`}
                        onPress={() =>
                          setDraftDays((current) =>
                            current.includes(chip.code)
                              ? current.filter((day) => day !== chip.code)
                              : [...current, chip.code],
                          )
                        }
                        accessibilityRole="button"
                        accessibilityLabel={`Toggle ${chip.code}`}
                        style={[
                          styles.weekdayCircle,
                          active && styles.weekdayCircleActive,
                        ]}
                      >
                        <Text
                          style={[
                            styles.weekdayCircleText,
                            active && styles.weekdayCircleTextActive,
                          ]}
                        >
                          {chip.label}
                        </Text>
                      </Pressable>
                    );
                  })}
                </View>
              ) : null}
              <TextInput
                style={styles.input}
                placeholder="HH:mm (24h)"
                placeholderTextColor={colors.textSecondary}
                value={draftTime}
                onChangeText={setDraftTime}
                autoCapitalize="none"
              />
              <View style={{ flexDirection: 'row', gap: space.sm, marginTop: space.xs }}>
                <View style={{ flex: 1 }}>
                  <PillButton
                    label={busy ? 'Saving…' : 'Save'}
                    onPress={handleSave}
                    disabled={busy}
                    variant="primary"
                  />
                </View>
                <PillButton
                  label="Cancel"
                  onPress={() => setEditing(false)}
                  variant="secondary"
                />
              </View>
            </ScrollView>
          ) : (
            <ScrollView showsVerticalScrollIndicator={false} contentContainerStyle={{ gap: space.lg }}>
              <View style={{ gap: space.xs }}>
                <Text style={{ fontSize: 15, fontWeight: '600', color: colors.textPrimary }}>
                  {routine.scheduleLabel}
                </Text>
                <Text style={{ fontSize: 14, color: colors.textSecondary, lineHeight: 20 }}>{routine.prompt}</Text>
                {nextRunLabel ? (
                  <Text style={{ fontSize: 13, color: colors.textSecondary }}>{`Next run: ${nextRunLabel}`}</Text>
                ) : null}
                {routine.nextRuns.length > 1 ? (
                  <Text style={{ fontSize: 12, color: colors.textTertiary }}>
                    {`Then: ${routine.nextRuns
                      .slice(1)
                      .map((run) => formatDateTime(run, routine.tz))
                      .join(' · ')}`}
                  </Text>
                ) : null}
              </View>

              <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: space.sm }}>
                {routine.status === 'active' ? (
                  <Pressable
                    onPress={() =>
                      void withBusy(async () => {
                        await pauseRoutine(routine.id);
                      })
                    }
                    disabled={busy}
                    style={styles.actionChip}
                  >
                    <Pause size={13} color={colors.textPrimary} />
                    <Text style={styles.actionChipText}>Pause</Text>
                  </Pressable>
                ) : routine.status !== 'completed' ? (
                  <Pressable
                    onPress={() =>
                      void withBusy(async () => {
                        await resumeRoutine(routine.id);
                      })
                    }
                    disabled={busy}
                    style={styles.actionChip}
                  >
                    <Play size={13} color={colors.textPrimary} />
                    <Text style={styles.actionChipText}>Resume</Text>
                  </Pressable>
                ) : null}

                <Pressable
                  onPress={() =>
                    void withBusy(async () => {
                      const result = await runRoutineNow(routine.id);
                      if (result.runId) onRunNow?.(result.runId);
                    })
                  }
                  disabled={busy || routine.status === 'completed'}
                  style={styles.actionChip}
                >
                  <CalendarClock size={13} color={colors.textPrimary} />
                  <Text style={styles.actionChipText}>Run now</Text>
                </Pressable>

                <Pressable
                  onPress={() => setEditing(true)}
                  style={styles.actionChip}
                >
                  <Text style={styles.actionChipText}>Edit</Text>
                </Pressable>

                <Pressable
                  onPress={handleDelete}
                  style={[styles.actionChip, { backgroundColor: colors.recordingBg }]}
                >
                  <Trash2 size={13} color={colors.recording} />
                  <Text style={[styles.actionChipText, { color: colors.recording }]}>Delete</Text>
                </Pressable>
              </View>

              <View style={{ gap: space.xs }}>
                <SectionLabel text="Past runs" />
                {runs.length === 0 ? (
                  <Text style={{ fontSize: 13, color: colors.textSecondary, paddingHorizontal: space.xs }}>No runs yet.</Text>
                ) : (
                  <GroupedCard>
                    {runs.slice(0, 8).map((run, index) => (
                      <View key={run.id}>
                        {index > 0 && <HairlineDivider inset={space.md} />}
                        <View style={{ flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', paddingHorizontal: space.lg, paddingVertical: space.sm }}>
                          <Text style={{ flex: 1, fontSize: 13, color: colors.textPrimary }} numberOfLines={1}>
                            {run.scheduledFor
                              ? formatDateTime(run.scheduledFor, routine.tz)
                              : formatDateTime(run.createdAt, routine.tz)}
                          </Text>
                          <Text style={{ fontSize: 11, fontWeight: '500', color: colors.textSecondary, textTransform: 'uppercase' }}>
                            {run.status}
                          </Text>
                        </View>
                      </View>
                    ))}
                  </GroupedCard>
                )}
              </View>
            </ScrollView>
          )}
        </View>
      </View>
    </Modal>
  );
}

const styles = StyleSheet.create({
  overlay: {
    flex: 1,
    justifyContent: 'flex-end',
    backgroundColor: colors.overlay,
  },
  sheetContainer: {
    maxHeight: '85%',
    borderTopLeftRadius: radius.sheet,
    borderTopRightRadius: radius.sheet,
    backgroundColor: colors.surfaceRaised,
    paddingHorizontal: space.lg,
    paddingTop: space.lg,
    paddingBottom: space.xxl,
    gap: space.md,
  },
  sheetHeader: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
  },
  sheetTitle: {
    fontSize: 20,
    lineHeight: 26,
    fontWeight: '600',
    color: colors.textPrimary,
  },
  sheetCloseButton: {
    backgroundColor: colors.surface,
    shadowColor: 'transparent',
    shadowOpacity: 0,
    elevation: 0,
  },
  errorNotice: {
    fontSize: 13,
    color: colors.recording,
  },
  input: {
    backgroundColor: colors.surface,
    borderRadius: radius.card,
    paddingHorizontal: space.lg,
    paddingVertical: space.md,
    fontSize: 15,
    color: colors.textPrimary,
  },
  frequencyChip: {
    borderRadius: radius.pill,
    backgroundColor: colors.surface,
    paddingHorizontal: space.md,
    paddingVertical: space.xs,
  },
  frequencyChipActive: {
    backgroundColor: colors.primary,
  },
  frequencyChipText: {
    fontSize: 13,
    fontWeight: '500',
    color: colors.textSecondary,
    textTransform: 'capitalize',
  },
  frequencyChipTextActive: {
    color: colors.onPrimary,
  },
  weekdayCircle: {
    width: 32,
    height: 32,
    alignItems: 'center',
    justifyContent: 'center',
    borderRadius: radius.pill,
    backgroundColor: colors.surface,
  },
  weekdayCircleActive: {
    backgroundColor: colors.primary,
  },
  weekdayCircleText: {
    fontSize: 12,
    fontWeight: '600',
    color: colors.textSecondary,
  },
  weekdayCircleTextActive: {
    color: colors.onPrimary,
  },
  actionChip: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
    borderRadius: radius.pill,
    backgroundColor: colors.surface,
    paddingHorizontal: 12,
    paddingVertical: 8,
  },
  actionChipText: {
    fontSize: 13,
    fontWeight: '500',
    color: colors.textPrimary,
  },
});
