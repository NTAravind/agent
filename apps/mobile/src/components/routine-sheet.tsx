import { useCallback, useEffect, useMemo, useState } from 'react';
import {
  Alert,
  Modal,
  Pressable,
  ScrollView,
  Text,
  TextInput,
  View,
} from 'react-native';
import { Spinner } from 'heroui-native';
import { CalendarClock, Pause, Play, Trash2, X } from 'lucide-react-native';
import type { RoutineSchedule, RoutineWithPreview, Weekday } from '@agent/shared';

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

/**
 * Routine sheets (Phase 10).
 *
 * `RoutineListSheet` is the clock icon in an agent's chat header: the
 * routines bound to that agent. `RoutineDetailSheet` is the drill-down —
 * schedule, next run, pause/resume, edit, run now and the past runs.
 */

const WEEKDAY_CHIPS: { code: Weekday; label: string }[] = [
  { code: 'MO', label: 'M' },
  { code: 'TU', label: 'T' },
  { code: 'WE', label: 'W' },
  { code: 'TH', label: 'T' },
  { code: 'FR', label: 'F' },
  { code: 'SA', label: 'S' },
  { code: 'SU', label: 'S' },
];

export const ROUTINE_STATUS_STYLES: Record<string, string> = {
  active: 'bg-emerald-500/15 text-emerald-300',
  draft: 'bg-sky-500/15 text-sky-300',
  paused: 'bg-amber-500/15 text-amber-300',
  completed: 'bg-zinc-500/15 text-zinc-400',
};

type ListProps = {
  visible: boolean;
  onClose: () => void;
  /** Only show the routines bound to this agent. */
  agentId?: string | null;
  /** Called after a routine changed (activate/pause/resume/delete). */
  onChanged?: () => void;
};

/** The routine list inside a sheet (agent chat header / More). */
export function RoutineListSheet({ visible, onClose, agentId, onChanged }: ListProps) {
  const [routines, setRoutines] = useState<RoutineWithPreview[]>([]);
  const [loading, setLoading] = useState(false);
  const [notice, setNotice] = useState<string | null>(null);
  const [openId, setOpenId] = useState<string | null>(null);

  const load = useCallback(async () => {
    try {
      const all = await fetchRoutines();
      setRoutines(agentId ? all.filter((routine) => routine.agentId === agentId) : all);
    } catch (error) {
      setNotice(error instanceof Error ? error.message : String(error));
    } finally {
      setLoading(false);
    }
  }, [agentId]);

  useEffect(() => {
    if (!visible) return;
    let active = true;
    void (async () => {
      try {
        const all = await fetchRoutines();
        if (!active) return;
        setRoutines(agentId ? all.filter((routine) => routine.agentId === agentId) : all);
        setNotice(null);
      } catch (error) {
        if (!active) return;
        setNotice(error instanceof Error ? error.message : String(error));
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
      <View className="flex-1 justify-end bg-black/50">
        <View
          className="max-h-[80%] rounded-t-3xl border-t border-zinc-200 dark:border-white/10 bg-white dark:bg-[#121215] px-5 pt-5 pb-8 gap-3"
        >
          <View className="flex-row items-center justify-between">
            <Text className="text-base font-bold text-zinc-900 dark:text-white">Routines</Text>
            <Pressable onPress={onClose} accessibilityRole="button" accessibilityLabel="Close">
              <X size={18} color="#71717a" />
            </Pressable>
          </View>

          {notice ? (
            <Text className="text-xs text-red-400">{notice}</Text>
          ) : null}

          {loading ? (
            <View className="py-10 items-center justify-center">
              <Spinner size="lg" color="default" />
            </View>
          ) : routines.length === 0 ? (
            <View className="py-8 items-center gap-2">
              <CalendarClock size={24} color="#71717a" />
              <Text className="text-xs text-zinc-500 text-center">
                No routines yet. Ask in the chat — “every Monday at 9 summarize my open tasks”.
              </Text>
            </View>
          ) : (
            <ScrollView className="gap-2" showsVerticalScrollIndicator={false}>
              {routines.map((routine) => (
                <Pressable
                  key={routine.id}
                  onPress={() => setOpenId(routine.id)}
                  accessibilityRole="button"
                  accessibilityLabel={`Open ${routine.name}`}
                  className="gap-1 rounded-2xl border border-zinc-200 dark:border-white/10 px-3.5 py-3 active:opacity-70"
                >
                  <View className="flex-row items-center gap-2">
                    <Text className="flex-1 text-sm font-semibold text-zinc-900 dark:text-white">
                      {routine.name}
                    </Text>
                    <View
                      className={`rounded-full px-2 py-0.5 ${ROUTINE_STATUS_STYLES[routine.status] ?? ROUTINE_STATUS_STYLES.draft}`}
                    >
                      <Text className="text-[10px] font-semibold uppercase">{routine.status}</Text>
                    </View>
                  </View>
                  <Text className="text-xs text-zinc-500 dark:text-zinc-400">{routine.scheduleLabel}</Text>
                  {routine.nextRuns[0] ? (
                    <Text className="text-[11px] text-zinc-400">
                      {`Next: ${formatDateTime(routine.nextRuns[0], routine.tz)}`}
                    </Text>
                  ) : null}
                </Pressable>
              ))}
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
        prompt: draftPrompt,
        schedule,
      });
      setEditing(false);
    });
  }, [draftDays, draftFrequency, draftName, draftPrompt, draftTime, routine, withBusy]);

  const handleDelete = useCallback(() => {
    if (!routine) return;
    Alert.alert('Delete routine', `Delete “${routine.name}”? It will stop running.`, [
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
    if (!routine) return null;
    return routine.nextRuns[0] ? formatDateTime(routine.nextRuns[0], routine.tz) : null;
  }, [routine]);

  if (!routine) return null;

  return (
    <Modal
      visible
      transparent
      animationType="fade"
      onRequestClose={onClose}
    >
      <View className="flex-1 justify-end bg-black/60">
        <View
          className="max-h-[85%] rounded-t-3xl border-t border-zinc-200 dark:border-white/10 bg-white dark:bg-[#121215] px-5 pt-5 pb-8 gap-3"
        >
          <View className="flex-row items-center justify-between">
            <Text className="text-base font-bold text-zinc-900 dark:text-white">{routine.name}</Text>
            <Pressable onPress={onClose} accessibilityRole="button" accessibilityLabel="Close">
              <X size={18} color="#71717a" />
            </Pressable>
          </View>

          {notice ? <Text className="text-xs text-red-400">{notice}</Text> : null}

          {editing ? (
            <View className="gap-3">
              <TextInput
                className="rounded-2xl border border-zinc-200 dark:border-white/10 bg-zinc-50 dark:bg-white/5 px-3.5 py-3 text-sm text-zinc-900 dark:text-white"
                placeholder="Name"
                placeholderTextColor="#71717a"
                value={draftName}
                onChangeText={setDraftName}
              />
              <TextInput
                className="rounded-2xl border border-zinc-200 dark:border-white/10 bg-zinc-50 dark:bg-white/5 px-3.5 py-3 text-sm text-zinc-900 dark:text-white"
                placeholder="What should the agent do?"
                placeholderTextColor="#71717a"
                value={draftPrompt}
                onChangeText={setDraftPrompt}
                multiline
              />
              <View className="flex-row flex-wrap gap-2">
                {(['daily', 'weekly', 'monthly'] as const).map((frequency) => (
                  <Pressable
                    key={frequency}
                    onPress={() => setDraftFrequency(frequency)}
                    accessibilityRole="button"
                    className={`rounded-full border px-3 py-1.5 ${
                      draftFrequency === frequency
                        ? 'border-zinc-900 dark:border-white bg-zinc-900 dark:bg-white'
                        : 'border-zinc-200 dark:border-white/10 bg-zinc-50 dark:bg-white/5'
                    }`}
                  >
                    <Text
                      className={`text-xs font-semibold capitalize ${
                        draftFrequency === frequency
                          ? 'text-white dark:text-zinc-900'
                          : 'text-zinc-600 dark:text-zinc-400'
                      }`}
                    >
                      {frequency}
                    </Text>
                  </Pressable>
                ))}
              </View>
              {draftFrequency === 'weekly' ? (
                <View className="flex-row gap-2">
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
                        className={`h-8 w-8 items-center justify-center rounded-full border ${
                          active
                            ? 'border-zinc-900 dark:border-white bg-zinc-900 dark:bg-white'
                            : 'border-zinc-200 dark:border-white/10'
                        }`}
                      >
                        <Text
                          className={`text-xs font-semibold ${
                            active ? 'text-white dark:text-zinc-900' : 'text-zinc-500'
                          }`}
                        >
                          {chip.label}
                        </Text>
                      </Pressable>
                    );
                  })}
                </View>
              ) : null}
              <TextInput
                className="rounded-2xl border border-zinc-200 dark:border-white/10 bg-zinc-50 dark:bg-white/5 px-3.5 py-3 text-sm text-zinc-900 dark:text-white"
                placeholder="HH:mm (24h)"
                placeholderTextColor="#71717a"
                value={draftTime}
                onChangeText={setDraftTime}
                autoCapitalize="none"
              />
              <View className="flex-row gap-2">
                <Pressable
                  onPress={handleSave}
                  disabled={busy}
                  className="flex-1 items-center rounded-2xl bg-zinc-900 dark:bg-white py-3 active:opacity-80 disabled:opacity-40"
                >
                  <Text className="text-sm font-bold text-white dark:text-zinc-900">Save</Text>
                </Pressable>
                <Pressable
                  onPress={() => setEditing(false)}
                  className="items-center rounded-2xl border border-zinc-200 dark:border-white/10 px-5 py-3 active:opacity-70"
                >
                  <Text className="text-sm font-semibold text-zinc-600 dark:text-zinc-300">Cancel</Text>
                </Pressable>
              </View>
            </View>
          ) : (
            <ScrollView className="gap-4" showsVerticalScrollIndicator={false}>
              <View className="gap-1">
                <Text className="text-sm font-semibold text-zinc-900 dark:text-white">
                  {routine.scheduleLabel}
                </Text>
                <Text className="text-xs text-zinc-500">{routine.prompt}</Text>
                {nextRunLabel ? (
                  <Text className="text-xs text-zinc-400">{`Next run: ${nextRunLabel}`}</Text>
                ) : null}
                {routine.nextRuns.length > 1 ? (
                  <Text className="text-[11px] text-zinc-400">
                    {`Then: ${routine.nextRuns
                      .slice(1)
                      .map((run) => formatDateTime(run, routine.tz))
                      .join(' · ')}`}
                  </Text>
                ) : null}
              </View>

              <View className="flex-row flex-wrap gap-2">
                {routine.status === 'active' ? (
                  <Pressable
                    onPress={() =>
                      void withBusy(async () => {
                        await pauseRoutine(routine.id);
                      })
                    }
                    disabled={busy}
                    className="flex-row items-center gap-1.5 rounded-full border border-amber-500/30 bg-amber-500/10 px-3 py-2 active:opacity-75 disabled:opacity-40"
                  >
                    <Pause size={13} color="#fbbf24" />
                    <Text className="text-xs font-semibold text-amber-300">Pause</Text>
                  </Pressable>
                ) : routine.status !== 'completed' ? (
                  <Pressable
                    onPress={() =>
                      void withBusy(async () => {
                        await resumeRoutine(routine.id);
                      })
                    }
                    disabled={busy}
                    className="flex-row items-center gap-1.5 rounded-full border border-emerald-500/30 bg-emerald-500/10 px-3 py-2 active:opacity-75 disabled:opacity-40"
                  >
                    <Play size={13} color="#4ade80" />
                    <Text className="text-xs font-semibold text-emerald-300">Resume</Text>
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
                  className="flex-row items-center gap-1.5 rounded-full border border-sky-500/30 bg-sky-500/10 px-3 py-2 active:opacity-75 disabled:opacity-40"
                >
                  <CalendarClock size={13} color="#38bdf8" />
                  <Text className="text-xs font-semibold text-sky-300">Run now</Text>
                </Pressable>

                <Pressable
                  onPress={() => setEditing(true)}
                  className="rounded-full border border-zinc-200 dark:border-white/10 px-3 py-2 active:opacity-75"
                >
                  <Text className="text-xs font-semibold text-zinc-600 dark:text-zinc-300">Edit</Text>
                </Pressable>

                <Pressable
                  onPress={handleDelete}
                  className="flex-row items-center gap-1.5 rounded-full border border-red-500/30 bg-red-500/10 px-3 py-2 active:opacity-75"
                >
                  <Trash2 size={13} color="#f87171" />
                  <Text className="text-xs font-semibold text-red-300">Delete</Text>
                </Pressable>
              </View>

              <View className="gap-2">
                <Text className="text-xs font-semibold uppercase tracking-wider text-zinc-400">
                  Past runs
                </Text>
                {runs.length === 0 ? (
                  <Text className="text-xs text-zinc-500">No runs yet.</Text>
                ) : (
                  runs.slice(0, 8).map((run) => (
                    <View
                      key={run.id}
                      className="flex-row items-center justify-between rounded-xl border border-zinc-200 dark:border-white/5 px-3 py-2"
                    >
                      <Text
                        className="flex-1 text-xs text-zinc-600 dark:text-zinc-300"
                        numberOfLines={1}
                      >
                        {run.scheduledFor
                          ? formatDateTime(run.scheduledFor, routine.tz)
                          : formatDateTime(run.createdAt, routine.tz)}
                      </Text>
                      <Text className="text-[10px] font-semibold uppercase text-zinc-400">
                        {run.status}
                      </Text>
                    </View>
                  ))
                )}
              </View>
            </ScrollView>
          )}
        </View>
      </View>
    </Modal>
  );
}
