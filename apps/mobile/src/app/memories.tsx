import { useCallback, useState } from 'react';
import { Alert as RNAlert, FlatList, Pressable, RefreshControl, StyleSheet, Text, View } from 'react-native';
import { Spinner } from 'heroui-native';
import { useFocusEffect, useRouter } from 'expo-router';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { Bookmark, ChevronLeft, Trash2 } from 'lucide-react-native';
import { SymbolIcon } from '@/components/symbol-icon';
import type { Memory } from '@agent/shared';

import { AppHeader, useHeaderInset } from '@/components/app-header';
import { reportAppError } from '@/components/error-dialog-provider';
import { GroupedCard, InlineError, RoundButton } from '@/components/design-system';
import { MarkdownText } from '@/components/markdown-text';
import { colors, radius, shadow, space } from '@/theme';
import { deleteMemory, fetchMemories } from '@/lib/knowledge';

export default function MemoriesScreen() {
  const router = useRouter();
  const insets = useSafeAreaInsets();

  const [memories, setMemories] = useState<Memory[]>([]);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const handleBack = useCallback(() => {
    if (router.canGoBack()) {
      router.back();
    } else {
      router.replace('/more');
    }
  }, [router]);

  const load = useCallback(async () => {
    try {
      setMemories(await fetchMemories());
      setError(null);
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
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

  const handleDelete = useCallback((memory: Memory) => {
    RNAlert.alert('Forget memory?', 'This memory will no longer be recalled by agents.', [
      { text: 'Cancel', style: 'cancel' },
      {
        text: 'Forget',
        style: 'destructive',
        onPress: () => {
          void deleteMemory(memory.id)
            .then(() => load())
            .catch((error) => reportAppError(error, { title: 'Could not forget memory' }));
        },
      },
    ]);
  }, [load]);

  const headerInset = useHeaderInset();

  return (
    <View style={styles.screen}>
      <AppHeader
        left={
          <RoundButton
            icon={ChevronLeft}
            onPress={handleBack}
            accessibilityLabel="Close"
          />
        }
        center={
          <Text style={styles.headerTitle}>Memories</Text>
        }
      />

      {loading ? (
        <View style={styles.center}>
          <Spinner size="lg" color="default" />
        </View>
      ) : (
        <FlatList
          data={memories}
          keyExtractor={(memory) => memory.id}
          renderItem={({ item: memory }) => (
            <View style={styles.memoryCard}>
              <View style={{ flex: 1, minWidth: 0, gap: space.xs }}>
                <View style={styles.metaRow}>
                  <View style={styles.kindBadge}>
                    <Text style={styles.kindText}>
                      {memory.kind}
                    </Text>
                  </View>
                  <Text style={styles.dateText}>
                    {new Date(memory.created_at).toLocaleDateString([], { month: 'short', day: 'numeric' })}
                  </Text>
                </View>
                <MarkdownText markdown={memory.content} fontSize={17} />
              </View>

              <Pressable
                onPress={() => handleDelete(memory)}
                accessibilityRole="button"
                accessibilityLabel="Delete memory"
                hitSlop={4}
                style={styles.deleteBtn}
              >
                <SymbolIcon icon={Trash2} size={16} color={colors.danger} />
              </Pressable>
            </View>
          )}
          ListHeaderComponent={
            error ? <InlineError message={error} onRetry={() => void load()} /> : undefined
          }
          ListEmptyComponent={
            memories.length === 0 && !error ? (
              <View style={styles.emptyContainer}>
                <View style={styles.emptyIconBox}>
                  <SymbolIcon icon={Bookmark} size={32} color={colors.textSecondary} strokeWidth={1.5} />
                </View>
                <Text style={styles.emptyTitle}>Nothing remembered yet</Text>
                <Text style={styles.emptySubtitle}>
                  Key facts, preferences, and decisions are extracted from conversations and used in future tasks.
                </Text>
              </View>
            ) : undefined
          }
          contentContainerStyle={{
            paddingTop: headerInset,
            paddingHorizontal: space.lg,
            paddingBottom: insets.bottom + space.xxl,
            gap: space.md,
          }}
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
      )}
    </View>
  );
}

const styles = StyleSheet.create({
  screen: {
    flex: 1,
    backgroundColor: colors.background,
  },
  center: {
    flex: 1,
    alignItems: 'center',
    justifyContent: 'center',
  },
  headerTitle: {
    fontSize: 20,
    lineHeight: 26,
    fontWeight: '600',
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
  memoryCard: {
    flexDirection: 'row',
    alignItems: 'flex-start',
    justifyContent: 'space-between',
    borderRadius: radius.card,
    backgroundColor: colors.surface,
    padding: space.md,
    gap: space.sm,
  },
  metaRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: space.sm,
  },
  kindBadge: {
    backgroundColor: colors.surfaceRaised,
    borderRadius: radius.pill,
    paddingHorizontal: 8,
    paddingVertical: 2,
  },
  kindText: {
    fontSize: 12,
    fontWeight: '500',
    color: colors.textPrimary,
    textTransform: 'capitalize',
  },
  dateText: {
    fontSize: 13,
    color: colors.textSecondary,
  },
  deleteBtn: {
    width: 36,
    height: 36,
    borderRadius: radius.pill,
    backgroundColor: colors.surface,
    alignItems: 'center',
    justifyContent: 'center',
  },
});
