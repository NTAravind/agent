import { useCallback, useState } from 'react';
import { Alert as RNAlert, Pressable, RefreshControl, ScrollView, Text, View } from 'react-native';
import { Button, Spinner, Typography } from 'heroui-native';
import { useFocusEffect, useRouter } from 'expo-router';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { Brain, Sparkles, Trash2 } from 'lucide-react-native';
import type { Memory } from '@agent/shared';

import { AppHeader } from '@/components/app-header';
import { deleteMemory, fetchMemories } from '@/lib/knowledge';

const KIND_BADGE: Record<Memory['kind'], { label: string; bg: string; text: string }> = {
  fact: { label: 'Fact', bg: 'bg-blue-500/15 border-blue-500/30', text: 'text-blue-500 dark:text-blue-300' },
  preference: { label: 'Preference', bg: 'bg-purple-500/15 border-purple-500/30', text: 'text-purple-500 dark:text-purple-300' },
  decision: { label: 'Decision', bg: 'bg-emerald-500/15 border-emerald-500/30', text: 'text-emerald-500 dark:text-emerald-300' },
  task: { label: 'Task', bg: 'bg-amber-500/15 border-amber-500/30', text: 'text-amber-500 dark:text-amber-300' },
};

export default function MemoriesScreen() {
  const router = useRouter();
  const insets = useSafeAreaInsets();

  const [memories, setMemories] = useState<Memory[]>([]);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [error, setError] = useState<string | null>(null);

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
          void deleteMemory(memory.id).then(() => load());
        },
      },
    ]);
  }, [load]);

  return (
    <View className="flex-1 bg-white dark:bg-[#09090b]">
      <AppHeader
        left={
          <Pressable
            onPress={() => router.back()}
            accessibilityRole="button"
            className="px-2 py-1 active:opacity-60"
          >
            <Typography type="body" className="text-zinc-500 dark:text-zinc-400">
              Close
            </Typography>
          </Pressable>
        }
        center={
          <Typography type="body" weight="semibold" className="text-zinc-900 dark:text-white">
            Agent Memories
          </Typography>
        }
      />

      {loading ? (
        <View className="flex-1 items-center justify-center">
          <Spinner size="lg" color="default" />
        </View>
      ) : (
        <ScrollView
          contentContainerStyle={{ padding: 16, paddingBottom: insets.bottom + 32, gap: 10 }}
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
          {error ? (
            <View className="rounded-2xl border border-red-500/20 bg-red-500/10 p-4">
              <Text className="text-sm text-red-500 text-center">{error}</Text>
            </View>
          ) : null}

          {memories.length === 0 && !error ? (
            <View className="mt-20 items-center justify-center px-6 gap-3">
              <View className="h-16 w-16 items-center justify-center rounded-3xl border border-zinc-200 dark:border-white/10 bg-zinc-50 dark:bg-white/5">
                <Brain size={28} color="#71717a" />
              </View>
              <Text className="text-base font-semibold text-zinc-900 dark:text-white">
                Nothing remembered yet
              </Text>
              <Text className="text-xs text-zinc-500 text-center max-w-xs leading-4">
                Key facts, preferences, and decisions are autonomously extracted after conversation turns and used in future tasks.
              </Text>
            </View>
          ) : null}

          {memories.map((memory) => {
            const badge = KIND_BADGE[memory.kind] ?? KIND_BADGE.fact;
            return (
              <View
                key={memory.id}
                className="flex-row items-start justify-between rounded-2xl border border-zinc-200 dark:border-white/10 bg-zinc-50 dark:bg-[#121215] p-4 shadow-sm gap-3"
              >
                <View className="flex-1 min-w-0 gap-2">
                  <View className="flex-row items-center gap-2">
                    <View className={`rounded-full border px-2 py-0.5 ${badge.bg}`}>
                      <Text className={`text-[10px] font-semibold ${badge.text}`}>
                        {badge.label}
                      </Text>
                    </View>
                    <Text className="text-[11px] text-zinc-400">
                      {new Date(memory.created_at).toLocaleDateString([], { month: 'short', day: 'numeric' })}
                    </Text>
                  </View>
                  <Text className="text-sm text-zinc-900 dark:text-zinc-100 leading-5">
                    {memory.content}
                  </Text>
                </View>

                <Pressable
                  onPress={() => handleDelete(memory)}
                  accessibilityRole="button"
                  accessibilityLabel="Delete memory"
                  className="h-8 w-8 items-center justify-center rounded-full active:bg-zinc-200 dark:active:bg-white/10"
                >
                  <Trash2 size={15} color="#71717a" />
                </Pressable>
              </View>
            );
          })}
        </ScrollView>
      )}
    </View>
  );
}
