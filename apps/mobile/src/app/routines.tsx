import { useCallback, useState } from 'react';
import { Pressable, RefreshControl, ScrollView, Text, View } from 'react-native';
import { Spinner } from 'heroui-native';
import { useFocusEffect, useRouter } from 'expo-router';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { CalendarClock } from 'lucide-react-native';
import type { RoutineWithPreview } from '@agent/shared';

import { AppHeader } from '@/components/app-header';
import { RoutineDetailSheet, ROUTINE_STATUS_STYLES } from '@/components/routine-sheet';
import { formatDateTime } from '@/lib/dates';
import { fetchRoutines } from '@/lib/routines';

/**
 * The Routines screen (Phase 10).
 *
 * Lists every routine with its schedule and next run. Tapping one opens the
 * routine sheet: schedule, next run, pause/resume, edit, run now and the
 * past runs.
 */
export default function RoutinesScreen() {
  const router = useRouter();
  const insets = useSafeAreaInsets();

  const [routines, setRoutines] = useState<RoutineWithPreview[]>([]);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [notice, setNotice] = useState<string | null>(null);
  const [openId, setOpenId] = useState<string | null>(null);

  const load = useCallback(async () => {
    try {
      setRoutines(await fetchRoutines());
      setNotice(null);
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

  const open = routines.find((routine) => routine.id === openId) ?? null;

  return (
    <View className="flex-1 bg-white dark:bg-[#09090b]">
      <AppHeader
        left={
          <Pressable
            onPress={() => router.back()}
            accessibilityRole="button"
            accessibilityLabel="Go back"
            className="px-2 py-1 active:opacity-60"
          >
            <Text className="text-base text-zinc-500 dark:text-zinc-400">Back</Text>
          </Pressable>
        }
        center={
          <Text className="text-sm font-semibold text-zinc-900 dark:text-white">Routines</Text>
        }
      />

      <ScrollView
        contentContainerStyle={{ padding: 16, paddingBottom: insets.bottom + 32, gap: 14 }}
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
        {notice ? (
          <View className="rounded-2xl border border-sky-500/20 bg-sky-500/10 px-3.5 py-2.5">
            <Text className="text-xs text-sky-500 dark:text-sky-400">{notice}</Text>
          </View>
        ) : null}

        {loading ? (
          <View className="py-16 items-center justify-center">
            <Spinner size="lg" color="default" />
          </View>
        ) : routines.length === 0 ? (
          <View className="mt-16 items-center justify-center px-6 gap-3">
            <View className="h-16 w-16 items-center justify-center rounded-3xl border border-zinc-200 dark:border-white/10 bg-zinc-50 dark:bg-white/5">
              <CalendarClock size={28} color="#71717a" />
            </View>
            <Text className="text-base font-semibold text-zinc-900 dark:text-white">
              No routines yet
            </Text>
            <Text className="text-xs text-zinc-500 text-center max-w-xs">
              Ask an agent in its chat — “every Monday at 9 summarize my open tasks” — and confirm the
              proposal it makes.
            </Text>
          </View>
        ) : (
          <View className="rounded-2xl border border-zinc-200 dark:border-white/10 bg-zinc-50 dark:bg-[#121215] overflow-hidden">
            {routines.map((routine, index) => (
              <Pressable
                key={routine.id}
                onPress={() => setOpenId(routine.id)}
                accessibilityRole="button"
                accessibilityLabel={`Open ${routine.name}`}
                className={`gap-1.5 p-4 active:bg-zinc-100 dark:active:bg-white/5 ${
                  index > 0 ? 'border-t border-zinc-100 dark:border-white/5' : ''
                }`}
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
          </View>
        )}
      </ScrollView>

      <RoutineDetailSheet
        key={open?.id ?? 'none'}
        routine={open}
        onClose={() => setOpenId(null)}
        onChanged={() => void load()}
        onRunNow={(runId) => router.push({ pathname: '/run', params: { id: runId } })}
      />
    </View>
  );
}
