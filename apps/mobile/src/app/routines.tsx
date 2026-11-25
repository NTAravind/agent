import { useCallback, useState } from 'react';
import { FlatList, Pressable, RefreshControl, StyleSheet, Text, View } from 'react-native';
import { Spinner } from 'heroui-native';
import { useFocusEffect, useRouter } from 'expo-router';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { CalendarClock, ChevronLeft, ChevronRight } from 'lucide-react-native';
import { SymbolIcon } from '@/components/symbol-icon';
import type { RoutineWithPreview } from '@agent/shared';

import { AppHeader, useHeaderInset } from '@/components/app-header';
import { HairlineDivider, InlineError, RoundButton } from '@/components/design-system';
import { RoutineDetailSheet } from '@/components/routine-sheet';
import { colors, radius, space } from '@/theme';
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

  const handleBack = useCallback(() => {
    if (router.canGoBack()) {
      router.back();
    } else {
      router.replace('/more');
    }
  }, [router]);

  const headerInset = useHeaderInset();

  return (
    <View style={styles.screen}>
      <AppHeader
        left={
          <RoundButton
            icon={ChevronLeft}
            onPress={handleBack}
            accessibilityLabel="Go back"
          />
        }
        center={
          <Text style={styles.headerTitle}>Routines</Text>
        }
      />

      <FlatList
        data={routines}
        keyExtractor={(routine) => routine.id}
        renderItem={({ item: routine, index }) => (
          <View
            style={[
              styles.cardSlice,
              index === 0 && styles.cardSliceTop,
              index === routines.length - 1 && styles.cardSliceBottom,
            ]}
          >
            {index > 0 ? <HairlineDivider inset={56} /> : null}
            <Pressable
              onPress={() => setOpenId(routine.id)}
              accessibilityRole="button"
              accessibilityLabel={`Open ${routine.name}`}
              style={({ pressed }) => [
                styles.routineRow,
                { opacity: pressed ? 0.6 : 1 },
              ]}
            >
              <View style={styles.tileIcon}>
                <SymbolIcon icon={CalendarClock} size={18} color={colors.textSecondary} strokeWidth={1.75} />
              </View>
              <View style={styles.routineContent}>
                <View style={styles.titleRow}>
                  <Text style={styles.routineName}>{routine.name}</Text>
                  <View style={styles.statusPill}>
                    <Text style={styles.statusText}>{routine.status}</Text>
                  </View>
                </View>
                <Text numberOfLines={1} style={styles.scheduleText}>{routine.scheduleLabel}</Text>
                {routine.nextRuns[0] ? (
                  <Text numberOfLines={1} style={styles.nextRunText}>
                    {`Next: ${formatDateTime(routine.nextRuns[0], routine.tz)}`}
                  </Text>
                ) : null}
              </View>
              <SymbolIcon icon={ChevronRight} size={16} color={colors.textTertiary} strokeWidth={1.75} />
            </Pressable>
          </View>
        )}
        ListHeaderComponent={
          notice ? (
            <InlineError message={notice} onRetry={() => void load()} style={styles.headerNotice} />
          ) : undefined
        }
        ListEmptyComponent={
          loading ? (
            <View style={styles.center}>
              <Spinner size="lg" color="default" />
            </View>
          ) : (
            <View style={styles.emptyContainer}>
              <View style={styles.emptyIconBox}>
                <SymbolIcon icon={CalendarClock} size={32} color={colors.textSecondary} strokeWidth={1.5} />
              </View>
              <Text style={styles.emptyTitle}>No routines yet</Text>
              <Text style={styles.emptySubtitle}>
                Ask an agent in its chat — “every Monday at 9 summarize my open tasks” — and confirm the proposal it makes.
              </Text>
            </View>
          )
        }
        contentContainerStyle={{
          paddingTop: headerInset,
          paddingHorizontal: space.lg,
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

      {open ? (
        <RoutineDetailSheet
          routine={open}
          onClose={() => setOpenId(null)}
          onChanged={() => void load()}
        />
      ) : null}
    </View>
  );
}

const styles = StyleSheet.create({
  screen: {
    flex: 1,
    backgroundColor: colors.background,
  },
  headerTitle: {
    fontSize: 20,
    lineHeight: 26,
    fontWeight: '600',
    color: colors.textPrimary,
  },
  center: {
    paddingVertical: 64,
    alignItems: 'center',
    justifyContent: 'center',
  },
  headerNotice: {
    // Replaces the content container's old 12pt gap below the notice.
    marginBottom: space.md,
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
  emptyContainer: {
    marginTop: 64,
    alignItems: 'center',
    justifyContent: 'center',
    paddingHorizontal: space.xl,
    gap: space.xs,
  },
  emptyIconBox: {
    width: 64,
    height: 64,
    borderRadius: radius.card,
    backgroundColor: colors.surface,
    alignItems: 'center',
    justifyContent: 'center',
    marginBottom: space.sm,
  },
  emptyTitle: {
    fontSize: 20,
    lineHeight: 26,
    fontWeight: '600',
    color: colors.textPrimary,
  },
  emptySubtitle: {
    fontSize: 15,
    lineHeight: 20,
    color: colors.textSecondary,
    textAlign: 'center',
    maxWidth: 280,
  },
  routineRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: space.md,
    paddingHorizontal: space.lg,
    paddingVertical: 12,
  },
  tileIcon: {
    width: 36,
    height: 36,
    borderRadius: radius.tile,
    backgroundColor: colors.surfaceRaised,
    alignItems: 'center',
    justifyContent: 'center',
  },
  routineContent: {
    flex: 1,
    minWidth: 0,
    gap: 2,
  },
  titleRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: space.xs,
  },
  routineName: {
    fontSize: 16,
    lineHeight: 22,
    fontWeight: '500',
    color: colors.textPrimary,
  },
  statusPill: {
    borderRadius: radius.pill,
    backgroundColor: colors.surfaceRaised,
    paddingHorizontal: 8,
    paddingVertical: 2,
  },
  statusText: {
    fontSize: 11,
    fontWeight: '500',
    color: colors.textSecondary,
    textTransform: 'capitalize',
  },
  scheduleText: {
    fontSize: 13,
    lineHeight: 16,
    color: colors.textSecondary,
  },
  nextRunText: {
    fontSize: 11,
    lineHeight: 14,
    color: colors.textTertiary,
  },
});
