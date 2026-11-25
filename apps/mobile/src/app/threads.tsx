import { useCallback, useMemo, useState } from 'react';
import { Alert as RNAlert, FlatList, Pressable, RefreshControl, StyleSheet, Text, TextInput, View } from 'react-native';
import { Spinner } from 'heroui-native';
import { useFocusEffect, useRouter } from 'expo-router';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { ChevronLeft, MessageSquare, Plus, Search, Trash2, Users, X } from 'lucide-react-native';
import { SymbolIcon } from '@/components/symbol-icon';
import type { Thread } from '@agent/shared';

import { AppHeader, useHeaderInset } from '@/components/app-header';
import { reportAppError } from '@/components/error-dialog-provider';
import { AgentAvatar } from '@/components/agent-avatar';
import { InlineError, PillButton, RoundButton } from '@/components/design-system';
import { colors, radius, shadow, space } from '@/theme';
import { deleteThread, fetchThreads } from '@/lib/models';

function formatThreadDate(dateStr?: string | null): string {
  if (!dateStr) return '';
  const date = new Date(dateStr);
  if (isNaN(date.getTime())) return '';

  const now = new Date();
  const diffDays = Math.floor((now.getTime() - date.getTime()) / (1000 * 60 * 60 * 24));

  if (diffDays === 0) {
    return date.toLocaleTimeString([], { hour: 'numeric', minute: '2-digit' });
  }
  if (diffDays === 1) return 'Yesterday';
  if (diffDays < 7) {
    return date.toLocaleDateString([], { weekday: 'short' });
  }
  return date.toLocaleDateString([], { month: 'short', day: 'numeric' });
}

export default function ThreadsScreen() {
  const router = useRouter();
  const insets = useSafeAreaInsets();

  const [threads, setThreads] = useState<Thread[]>([]);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [query, setQuery] = useState('');

  const handleBack = useCallback(() => {
    if (router.canGoBack()) {
      router.back();
    } else {
      router.replace('/chat' as never);
    }
  }, [router]);

  const load = useCallback(async (type?: 'refresh') => {
    if (type === 'refresh') setRefreshing(true);
    else setLoading(true);
    try {
      const data = await fetchThreads();
      setThreads(data);
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

  const filteredThreads = useMemo(() => {
    if (!query.trim()) return threads;
    const lower = query.toLowerCase();
    return threads.filter(
      (t) =>
        t.title?.toLowerCase().includes(lower) ||
        t.agent?.name.toLowerCase().includes(lower) ||
        t.group?.name.toLowerCase().includes(lower),
    );
  }, [query, threads]);

  const openThread = (thread: Thread) => {
    if (thread.group_id) {
      router.push({
        pathname: '/groups/[id]',
        params: { id: thread.group_id, threadId: thread.id },
      });
      return;
    }
    router.push({
      pathname: '/chat',
      params: { threadId: thread.id, agentId: thread.agent_id ?? undefined },
    });
  };

  const handleDelete = useCallback((thread: Thread) => {
    RNAlert.alert(
      'Delete conversation',
      `Delete “${thread.title ?? 'Untitled'}”? Messages cannot be recovered.`,
      [
        { text: 'Cancel', style: 'cancel' },
        {
          text: 'Delete',
          style: 'destructive',
          onPress: () => {
            void deleteThread(thread.id)
              .then(() => load())
              .catch((err) => reportAppError(err, { title: 'Could not delete conversation' }));
          },
        },
      ],
    );
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
          <Text style={styles.headerTitle}>Conversations</Text>
        }
        right={
          <RoundButton
            icon={Plus}
            onPress={() => router.push('/chat')}
            accessibilityLabel="New chat"
          />
        }
      />

      {/* Pill Search Bar */}
      <View style={{ paddingHorizontal: space.lg, paddingVertical: space.xs, marginTop: headerInset }}>
        <View style={styles.searchBar}>
          <SymbolIcon icon={Search} size={18} color={colors.textSecondary} />
          <TextInput
            value={query}
            onChangeText={setQuery}
            placeholder="Search conversations…"
            placeholderTextColor={colors.textSecondary}
            style={styles.searchInput}
          />
          {query ? (
            <Pressable
              onPress={() => setQuery('')}
              accessibilityRole="button"
              accessibilityLabel="Clear search"
              hitSlop={10}
            >
              <SymbolIcon icon={X} size={16} color={colors.textSecondary} />
            </Pressable>
          ) : null}
        </View>
      </View>

      {loading ? (
        <View style={styles.center}>
          <Spinner size="lg" color="default" />
        </View>
      ) : (
        <FlatList
          data={filteredThreads}
          keyExtractor={(thread) => thread.id}
          renderItem={({ item: thread }) => (
            <Pressable
              onPress={() => openThread(thread)}
              accessibilityRole="button"
              accessibilityLabel={thread.title ?? 'Untitled thread'}
              style={({ pressed }) => [
                styles.threadCard,
                { opacity: pressed ? 0.6 : 1 },
              ]}
            >
              <View style={{ marginRight: space.md }}>
                {thread.group ? (
                  <View style={styles.groupIconBox}>
                    <SymbolIcon icon={Users} size={20} color={colors.textPrimary} />
                  </View>
                ) : thread.agent ? (
                  <AgentAvatar
                    avatar={thread.agent.avatar}
                    name={thread.agent.name}
                    size={40}
                  />
                ) : (
                  <View style={styles.defaultAvatarBox}>
                    <SymbolIcon icon={MessageSquare} size={18} color={colors.textSecondary} />
                  </View>
                )}
              </View>

              <View style={{ flex: 1, minWidth: 0, paddingRight: space.sm }}>
                <Text numberOfLines={1} style={styles.threadTitle}>
                  {thread.title ?? 'Untitled conversation'}
                </Text>
                <View style={styles.threadMetaRow}>
                  <Text style={styles.threadMetaText}>
                    {formatThreadDate(thread.updated_at)}
                  </Text>
                  {thread.group ? (
                    <Text numberOfLines={1} style={styles.threadEntity}>
                      · {thread.group.name}
                    </Text>
                  ) : thread.agent ? (
                    <Text numberOfLines={1} style={styles.threadEntity}>
                      · {thread.agent.name}
                    </Text>
                  ) : null}
                </View>
              </View>

              <Pressable
                onPress={() => handleDelete(thread)}
                accessibilityRole="button"
                accessibilityLabel="Delete thread"
                hitSlop={6}
                style={styles.deleteButton}
              >
                <SymbolIcon icon={Trash2} size={16} color={colors.danger} />
              </Pressable>
            </Pressable>
          )}
          ListHeaderComponent={
            error ? <InlineError message={error} onRetry={() => void load()} /> : undefined
          }
          ListEmptyComponent={
            filteredThreads.length === 0 && !error ? (
              <View style={styles.emptyContainer}>
                <View style={styles.emptyIconBox}>
                  <SymbolIcon icon={MessageSquare} size={32} color={colors.textSecondary} strokeWidth={1.5} />
                </View>
                <Text style={styles.emptyTitle}>No conversations found</Text>
                <Text style={styles.emptySubtitle}>
                  {query ? 'Try a different search term.' : 'Start a new chat to explore ideas and run agent tasks.'}
                </Text>
                <PillButton
                  label="Start a conversation"
                  onPress={() => router.push('/chat')}
                  variant="primary"
                  style={{ marginTop: space.md }}
                />
              </View>
            ) : undefined
          }
          contentContainerStyle={{
            paddingTop: space.xs,
            paddingHorizontal: space.lg,
            paddingBottom: insets.bottom + space.xxl,
            gap: space.sm,
          }}
          refreshControl={
            <RefreshControl
              refreshing={refreshing}
              onRefresh={() => void load('refresh')}
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
    maxWidth: 260,
  },
  threadCard: {
    flexDirection: 'row',
    alignItems: 'center',
    borderRadius: radius.card,
    backgroundColor: colors.surface,
    padding: space.md,
  },
  groupIconBox: {
    width: 40,
    height: 40,
    borderRadius: radius.pill,
    backgroundColor: colors.surfaceRaised,
    alignItems: 'center',
    justifyContent: 'center',
  },
  defaultAvatarBox: {
    width: 40,
    height: 40,
    borderRadius: radius.pill,
    backgroundColor: colors.surfaceRaised,
    alignItems: 'center',
    justifyContent: 'center',
  },
  threadTitle: {
    fontSize: 17,
    lineHeight: 22,
    fontWeight: '500',
    color: colors.textPrimary,
  },
  threadMetaRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: space.xs,
    marginTop: 4,
  },
  threadMetaText: {
    fontSize: 15,
    lineHeight: 20,
    color: colors.textSecondary,
    fontVariant: ['tabular-nums'],
  },
  threadEntity: {
    fontSize: 15,
    lineHeight: 20,
    color: colors.textPrimary,
  },
  deleteButton: {
    width: 36,
    height: 36,
    borderRadius: radius.pill,
    backgroundColor: colors.surface,
    alignItems: 'center',
    justifyContent: 'center',
  },
});
