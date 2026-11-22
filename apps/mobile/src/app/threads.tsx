import { useCallback, useMemo, useState } from 'react';
import { Alert as RNAlert, Pressable, RefreshControl, ScrollView, Text, TextInput, View } from 'react-native';
import { Button, Spinner, Typography } from 'heroui-native';
import { useFocusEffect, useRouter } from 'expo-router';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { Plus, Search, Sparkles, Trash2, Users, X } from 'lucide-react-native';
import type { Thread } from '@agent/shared';

import { AppHeader } from '@/components/app-header';
import { AgentAvatar } from '@/components/agent-avatar';
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
  const [query, setQuery] = useState('');
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(async (mode: 'initial' | 'refresh' = 'initial') => {
    if (mode === 'refresh') setRefreshing(true);
    try {
      setThreads(await fetchThreads());
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
    const q = query.trim().toLowerCase();
    if (!q) return threads;
    return threads.filter(
      (t) =>
        (t.title ?? '').toLowerCase().includes(q) ||
        (t.agent?.name ?? '').toLowerCase().includes(q) ||
        (t.group?.name ?? '').toLowerCase().includes(q) ||
        (t.model ?? '').toLowerCase().includes(q),
    );
  }, [threads, query]);

  // A group conversation is not an ordinary chat: it runs through the group
  // pipeline, so it opens the group screen instead of the chat screen.
  const openThread = useCallback(
    (thread: Thread) => {
      const groupId = thread.group_id ?? thread.group?.id;
      if (groupId) {
        router.push({ pathname: '/groups/[id]', params: { id: groupId } } as never);
        return;
      }
      router.push({ pathname: '/chat', params: { threadId: thread.id } });
    },
    [router],
  );

  const handleDelete = useCallback((thread: Thread) => {
    RNAlert.alert(
      'Delete conversation?',
      `Delete "${thread.title ?? 'Untitled'}"? This cannot be undone.`,
      [
        { text: 'Cancel', style: 'cancel' },
        {
          text: 'Delete',
          style: 'destructive',
          onPress: () => {
            void deleteThread(thread.id).then(() => load());
          },
        },
      ],
    );
  }, [load]);

  return (
    <View className="flex-1 bg-white dark:bg-[#09090b]">
      <AppHeader
        left={
          <Pressable
            onPress={() => router.back()}
            accessibilityRole="button"
            accessibilityLabel="Close"
            className="px-2 py-1 active:opacity-60"
          >
            <Typography type="body" className="text-zinc-500 dark:text-zinc-400">
              Close
            </Typography>
          </Pressable>
        }
        center={
          <Typography type="body" weight="semibold" className="text-zinc-900 dark:text-white">
            Conversations
          </Typography>
        }
        right={
          <Pressable
            onPress={() => router.push('/chat')}
            accessibilityRole="button"
            accessibilityLabel="New chat"
            className="h-8.5 w-8.5 items-center justify-center rounded-full border border-zinc-200 dark:border-white/10 bg-zinc-50 dark:bg-white/5 active:bg-zinc-100 dark:active:bg-white/10"
          >
            <Plus size={16} color="#71717a" />
          </Pressable>
        }
      />

      {/* Search Bar */}
      <View className="px-4 py-2">
        <View className="flex-row items-center rounded-2xl border border-zinc-200 dark:border-white/10 bg-zinc-50 dark:bg-[#121215] px-3 py-2 gap-2">
          <Search size={16} color="#71717a" />
          <TextInput
            value={query}
            onChangeText={setQuery}
            placeholder="Search conversations…"
            placeholderTextColor="#71717a"
            className="flex-1 text-sm text-zinc-900 dark:text-white"
          />
          {query ? (
            <Pressable onPress={() => setQuery('')} className="p-1">
              <X size={14} color="#71717a" />
            </Pressable>
          ) : null}
        </View>
      </View>

      {loading ? (
        <View className="flex-1 items-center justify-center">
          <Spinner size="lg" color="default" />
        </View>
      ) : (
        <ScrollView
          contentContainerStyle={{
            paddingHorizontal: 16,
            paddingTop: 4,
            paddingBottom: insets.bottom + 24,
            gap: 8,
          }}
          refreshControl={
            <RefreshControl
              refreshing={refreshing}
              onRefresh={() => void load('refresh')}
              tintColor="#8b5cf6"
            />
          }
        >
          {error ? (
            <View className="rounded-2xl border border-red-500/20 bg-red-500/10 p-4">
              <Typography type="body-sm" className="text-red-500 text-center">
                {error}
              </Typography>
              <Button size="sm" variant="secondary" onPress={() => void load()} className="mt-2">
                <Button.Label>Retry</Button.Label>
              </Button>
            </View>
          ) : null}

          {filteredThreads.length === 0 && !error ? (
            <View className="mt-20 items-center justify-center px-6 gap-3">
              <View className="h-16 w-16 items-center justify-center rounded-3xl border border-zinc-200 dark:border-white/10 bg-zinc-50 dark:bg-white/5">
                <Sparkles size={28} color="#71717a" />
              </View>
              <Text className="text-base font-semibold text-zinc-900 dark:text-white">
                No conversations found
              </Text>
              <Text className="text-xs text-zinc-500 text-center max-w-xs">
                {query ? 'Try a different search term.' : 'Start a new chat to explore ideas and run agent tasks.'}
              </Text>
              <Button
                size="md"
                variant="primary"
                className="rounded-full mt-2"
                onPress={() => router.push('/chat')}
              >
                <Button.Label>Start a conversation</Button.Label>
              </Button>
            </View>
          ) : null}

          {filteredThreads.map((thread) => (
            <Pressable
              key={thread.id}
              onPress={() => openThread(thread)}
              accessibilityRole="button"
              accessibilityLabel={thread.title ?? 'Untitled thread'}
              className="flex-row items-center rounded-2xl border border-zinc-200 dark:border-white/10 bg-zinc-50 dark:bg-[#121215] p-3.5 active:bg-zinc-100 dark:active:bg-[#18181d]"
            >
              <View className="mr-3">
                {thread.group ? (
                  <View className="h-10 w-10 items-center justify-center rounded-2xl border border-purple-500/20 bg-purple-500/10">
                    <Users size={18} color="#a855f7" />
                  </View>
                ) : thread.agent ? (
                  <AgentAvatar
                    avatar={thread.agent.avatar}
                    name={thread.agent.name}
                    size={40}
                  />
                ) : (
                  <View className="h-10 w-10 items-center justify-center rounded-full border border-white/10 bg-white/5">
                    <Sparkles size={18} color="#a1a1aa" />
                  </View>
                )}
              </View>

              <View className="flex-1 min-w-0 pr-2">
                <Text
                  numberOfLines={1}
                  className="text-base font-semibold text-zinc-900 dark:text-white"
                >
                  {thread.title ?? 'Untitled conversation'}
                </Text>
                <View className="mt-1 flex-row items-center gap-2">
                  <Text className="text-xs text-zinc-500 dark:text-zinc-400">
                    {formatThreadDate(thread.updated_at)}
                  </Text>
                  {thread.group ? (
                    <Text
                      numberOfLines={1}
                      className="text-xs font-medium text-purple-600 dark:text-purple-400"
                    >
                      · {thread.group.name}
                    </Text>
                  ) : thread.agent ? (
                    <Text
                      numberOfLines={1}
                      className="text-xs font-medium text-purple-600 dark:text-purple-400"
                    >
                      · {thread.agent.name}
                    </Text>
                  ) : thread.model ? (
                    <Text
                      numberOfLines={1}
                      className="text-xs text-zinc-400 dark:text-zinc-500"
                    >
                      · {thread.model.split(':').pop()}
                    </Text>
                  ) : null}
                </View>
              </View>

              <Pressable
                onPress={() => handleDelete(thread)}
                accessibilityRole="button"
                accessibilityLabel="Delete thread"
                className="h-8 w-8 items-center justify-center rounded-full active:bg-zinc-200 dark:active:bg-white/10"
              >
                <Trash2 size={15} color="#71717a" />
              </Pressable>
            </Pressable>
          ))}
        </ScrollView>
      )}
    </View>
  );
}
