import { useCallback, useMemo, useState } from 'react';
import { Spinner } from 'heroui-native';
import { Pressable, RefreshControl, ScrollView, StyleSheet, Text, TextInput, View } from 'react-native';
import { useFocusEffect, useRouter } from 'expo-router';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { ChevronLeft, ChevronRight, LayoutDashboard, Plus, Search } from 'lucide-react-native';
import { SymbolIcon } from '@/components/symbol-icon';
import type { CanvasSummary } from '@agent/shared';

import { AppHeader, useHeaderInset } from '@/components/app-header';
import { InlineError, PillButton, RoundButton } from '@/components/design-system';
import { colors, radius, shadow, space } from '@/theme';
import { fetchCanvases } from '@/lib/canvases';

export default function CanvasListScreen() {
  const router = useRouter();
  const insets = useSafeAreaInsets();
  const [canvases, setCanvases] = useState<CanvasSummary[] | null>(null);
  const [searchQuery, setSearchQuery] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [refreshing, setRefreshing] = useState(false);

  const handleBack = useCallback(() => {
    if (router.canGoBack()) {
      router.back();
    } else {
      router.replace('/more');
    }
  }, [router]);

  const load = useCallback(async () => {
    try {
      setCanvases(await fetchCanvases());
      setError(null);
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setRefreshing(false);
    }
  }, []);

  useFocusEffect(
    useCallback(() => {
      void load();
    }, [load]),
  );

  const filteredCanvases = useMemo(() => {
    if (!canvases) return [];
    const query = searchQuery.trim().toLowerCase();
    if (!query) return canvases;
    return canvases.filter((c) => c.title.toLowerCase().includes(query));
  }, [canvases, searchQuery]);

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
          <Text style={styles.headerTitle}>Canvases</Text>
        }
      />

      <ScrollView
        contentContainerStyle={{ padding: space.lg, paddingTop: headerInset, paddingBottom: insets.bottom + space.xxl, gap: space.md }}
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
        {/* Search Bar */}
        {canvases && canvases.length > 0 ? (
          <View style={styles.searchBar}>
            <SymbolIcon icon={Search} size={18} color={colors.textSecondary} />
            <TextInput
              value={searchQuery}
              onChangeText={setSearchQuery}
              placeholder="Search canvases…"
              placeholderTextColor={colors.textSecondary}
              style={styles.searchInput}
            />
          </View>
        ) : null}

        {canvases === null && !error ? (
          <View style={styles.center}>
            <Spinner size="lg" color="default" />
          </View>
        ) : null}

        {canvases?.length === 0 ? (
          <View style={styles.emptyContainer}>
            <View style={styles.emptyIconBox}>
              <SymbolIcon icon={LayoutDashboard} size={32} color={colors.textSecondary} strokeWidth={1.5} />
            </View>
            <Text style={styles.emptyTitle}>No canvases yet</Text>
            <Text style={styles.emptySubtitle}>
              Ask an agent in chat to build a dashboard or visualization for your tasks or notes.
            </Text>
            <PillButton
              label="Create canvas in chat"
              onPress={() => router.push('/chat?prompt=Create%20a%20dashboard%20canvas%20for%20my%20weekly%20priorities')}
              variant="primary"
              style={{ marginTop: space.md }}
            />
          </View>
        ) : null}

        {filteredCanvases.map((canvas) => (
          <Pressable
            key={canvas.id}
            onPress={() => router.push(`/canvas/${canvas.id}`)}
            accessibilityRole="button"
            accessibilityLabel={canvas.title}
            style={({ pressed }) => [
              styles.canvasCard,
              { opacity: pressed ? 0.6 : 1 },
            ]}
          >
            <View style={styles.iconBox}>
              <SymbolIcon icon={LayoutDashboard} size={22} color={colors.textPrimary} strokeWidth={1.75} />
            </View>
            <View style={{ flex: 1, minWidth: 0 }}>
              <Text numberOfLines={1} style={styles.cardTitle}>
                {canvas.title}
              </Text>
              <View style={styles.cardMetaRow}>
                <View style={styles.versionBadge}>
                  <Text style={styles.versionText}>
                    v{canvas.version}
                  </Text>
                </View>
                <Text style={styles.cardMetaText}>
                  {new Date(canvas.updated_at).toLocaleDateString(undefined, {
                    month: 'short',
                    day: 'numeric',
                  })}
                </Text>
              </View>
            </View>
            <SymbolIcon icon={ChevronRight} size={18} color={colors.textSecondary} strokeWidth={2} />
          </Pressable>
        ))}

        {canvases && canvases.length > 0 && filteredCanvases.length === 0 ? (
          <View style={styles.center}>
            <Text style={styles.emptySubtitle}>
              No canvases matching &quot;{searchQuery}&quot;
            </Text>
          </View>
        ) : null}

        {error ? <InlineError message={error} onRetry={() => void load()} /> : null}
      </ScrollView>
    </View>
  );
}

const styles = StyleSheet.create({
  screen: {
    flex: 1,
    backgroundColor: colors.background,
  },
  center: {
    alignItems: 'center',
    justifyContent: 'center',
    paddingVertical: 48,
  },
  headerTitle: {
    fontSize: 20,
    lineHeight: 26,
    fontWeight: '600',
    color: colors.textPrimary,
  },
  searchBar: {
    flexDirection: 'row',
    alignItems: 'center',
    borderRadius: radius.pill,
    backgroundColor: colors.surface,
    paddingHorizontal: 14,
    height: 44,
    gap: space.sm,
  },
  searchInput: {
    flex: 1,
    fontSize: 17,
    lineHeight: 22,
    color: colors.textPrimary,
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
  canvasCard: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: space.md,
    borderRadius: radius.card,
    backgroundColor: colors.surface,
    padding: space.md,
  },
  iconBox: {
    width: 44,
    height: 44,
    borderRadius: radius.tile,
    backgroundColor: colors.surfaceRaised,
    alignItems: 'center',
    justifyContent: 'center',
  },
  cardTitle: {
    fontSize: 17,
    lineHeight: 22,
    fontWeight: '500',
    color: colors.textPrimary,
  },
  cardMetaRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: space.sm,
    marginTop: 4,
  },
  versionBadge: {
    borderRadius: radius.pill,
    backgroundColor: colors.surfaceRaised,
    paddingHorizontal: 8,
    paddingVertical: 2,
  },
  versionText: {
    fontSize: 12,
    fontWeight: '500',
    color: colors.textSecondary,
    fontVariant: ['tabular-nums'],
  },
  cardMetaText: {
    fontSize: 13,
    color: colors.textSecondary,
  },
});
