import type { AgentGroup } from '@agent/shared';
import { useCallback, useState } from 'react';
import { Pressable, RefreshControl, ScrollView, Text, View } from 'react-native';
import { Button, Spinner } from 'heroui-native';
import { useFocusEffect, useRouter } from 'expo-router';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { ChevronRight, Plus, Users } from 'lucide-react-native';

import { AppHeader } from '@/components/app-header';
import { AgentAvatar } from '@/components/agent-avatar';
import { fetchGroups } from '@/lib/groups';

/** Lists the user's dynamic agent groups. */
export default function GroupsScreen() {
  const router = useRouter();
  const insets = useSafeAreaInsets();
  const [groups, setGroups] = useState<AgentGroup[]>([]);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(async () => {
    try {
      setGroups(await fetchGroups());
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
        center={<Text className="text-sm font-semibold text-zinc-900 dark:text-white">Groups</Text>}
        right={
          <Pressable
            onPress={() => router.push('/groups/new' as never)}
            accessibilityRole="button"
            accessibilityLabel="Create group"
            className="h-9 w-9 items-center justify-center rounded-full bg-violet-500 active:opacity-75"
          >
            <Plus size={18} color="#ffffff" />
          </Pressable>
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
        {error ? (
          <View className="rounded-2xl border border-red-500/20 bg-red-500/10 px-3.5 py-2.5">
            <Text className="text-xs text-red-500 dark:text-red-300">{error}</Text>
          </View>
        ) : null}

        {loading ? (
          <View className="items-center justify-center py-16">
            <Spinner size="lg" color="default" />
          </View>
        ) : groups.length === 0 ? (
          <View className="items-center justify-center gap-3 px-6 py-16">
            <View className="h-16 w-16 items-center justify-center rounded-3xl border border-zinc-200 dark:border-white/10 bg-zinc-50 dark:bg-white/5">
              <Users size={28} color="#71717a" />
            </View>
            <Text className="text-base font-semibold text-zinc-900 dark:text-white">No groups yet</Text>
            <Text className="max-w-xs text-center text-xs leading-4 text-zinc-500 dark:text-zinc-400">
              Put agents together so they can ask each other for help and hand work forward.
            </Text>
            <Button
              size="sm"
              variant="primary"
              className="mt-2 rounded-full"
              onPress={() => router.push('/groups/new' as never)}
            >
              <Button.Label>Create Group</Button.Label>
            </Button>
          </View>
        ) : (
          groups.map((group) => (
            <Pressable
              key={group.id}
              onPress={() => router.push({ pathname: '/groups/[id]', params: { id: group.id } } as never)}
              accessibilityRole="button"
              accessibilityLabel={`Open ${group.name}`}
              className="gap-3 rounded-3xl border border-zinc-200 dark:border-white/10 bg-zinc-50 dark:bg-[#121215] p-4 shadow-sm active:opacity-75"
            >
              <View className="flex-row items-center gap-3">
                <View className="flex-row -space-x-2">
                  {group.members.slice(0, 4).map((member) => (
                    <View
                      key={member.agentId}
                      className="rounded-full border-2 border-zinc-50 dark:border-[#121215]"
                    >
                      <AgentAvatar avatar={member.agent.avatar} name={member.agent.name} size={38} />
                    </View>
                  ))}
                </View>
                <View className="min-w-0 flex-1">
                  <Text numberOfLines={1} className="text-base font-bold text-zinc-900 dark:text-white">
                    {group.name}
                  </Text>
                  {group.description ? (
                    <Text numberOfLines={1} className="mt-0.5 text-xs text-zinc-500 dark:text-zinc-400">
                      {group.description}
                    </Text>
                  ) : null}
                </View>
                <ChevronRight size={18} color="#71717a" />
              </View>
              <View className="flex-row items-center gap-2">
                <View className="rounded-full bg-violet-500/10 px-2.5 py-1">
                  <Text className="text-[10px] font-semibold uppercase text-violet-500 dark:text-violet-300">
                    {group.mode}
                  </Text>
                </View>
                <Text className="text-[11px] text-zinc-500 dark:text-zinc-400">
                  {group.members.length} member{group.members.length === 1 ? '' : 's'} · {group.maxHops} hop cap
                </Text>
              </View>
            </Pressable>
          ))
        )}
      </ScrollView>
    </View>
  );
}
