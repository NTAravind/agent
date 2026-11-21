import { useCallback, useState } from 'react';
import { Pressable, RefreshControl, ScrollView, Text, View } from 'react-native';
import { Spinner, Typography } from 'heroui-native';
import { useFocusEffect, useRouter } from 'expo-router';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { BookMarked, Plus } from 'lucide-react-native';
import type { Skill } from '@agent/shared';

import { AppHeader } from '@/components/app-header';
import { fetchSkills } from '@/lib/skills';

/**
 * Skills list: reusable instruction bundles agents load on demand.
 * Stored in the GitHub vault at skills/<slug>/SKILL.md (Supabase is the index).
 */
export default function SkillsScreen() {
  const router = useRouter();
  const insets = useSafeAreaInsets();

  const [skills, setSkills] = useState<Skill[]>([]);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(async () => {
    try {
      setSkills(await fetchSkills());
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
            className="px-2 py-1 active:opacity-60"
          >
            <Typography type="body" className="text-zinc-500 dark:text-zinc-400">
              Close
            </Typography>
          </Pressable>
        }
        center={
          <Typography type="body" weight="semibold" className="text-zinc-900 dark:text-white">
            Skills
          </Typography>
        }
        right={
          <Pressable
            onPress={() => router.push('/skills/new')}
            accessibilityRole="button"
            accessibilityLabel="New skill"
            className="h-8 px-3 flex-row items-center gap-1 rounded-full border border-zinc-200 dark:border-white/10 bg-zinc-50 dark:bg-white/5 active:opacity-75"
          >
            <Plus size={14} color="#8b5cf6" />
            <Text className="text-xs font-medium text-zinc-600 dark:text-zinc-300">New</Text>
          </Pressable>
        }
      />

      {loading ? (
        <View className="flex-1 items-center justify-center">
          <Spinner size="lg" color="default" />
        </View>
      ) : (
        <ScrollView
          contentContainerStyle={{ padding: 16, paddingBottom: insets.bottom + 32, gap: 12 }}
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

          {skills.length === 0 && !error ? (
            <View className="mt-20 items-center justify-center px-6 gap-3">
              <View className="h-16 w-16 items-center justify-center rounded-3xl border border-zinc-200 dark:border-white/10 bg-zinc-50 dark:bg-white/5">
                <BookMarked size={28} color="#71717a" />
              </View>
              <Text className="text-base font-semibold text-zinc-900 dark:text-white">
                No skills yet
              </Text>
              <Text className="text-xs text-zinc-500 text-center max-w-xs leading-4">
                Skills are reusable instruction bundles (SKILL.md in your vault). Agents only see
                their name and description until they load one.
              </Text>
            </View>
          ) : null}

          {skills.map((skill) => (
            <Pressable
              key={skill.id}
              onPress={() => router.push({ pathname: '/skills/[id]', params: { id: skill.id } })}
              className="rounded-2xl border border-zinc-200 dark:border-white/10 bg-zinc-50 dark:bg-[#121215] p-4 active:bg-zinc-100 dark:active:bg-[#18181e] shadow-sm gap-2"
            >
              <View className="flex-row items-center justify-between gap-2">
                <Text numberOfLines={1} className="text-sm font-semibold text-zinc-900 dark:text-white flex-1">
                  {skill.name}
                </Text>
                {!skill.enabled ? (
                  <View className="rounded-full border border-zinc-500/30 bg-zinc-500/10 px-2 py-0.5">
                    <Text className="text-[10px] font-semibold text-zinc-500">Off</Text>
                  </View>
                ) : null}
              </View>
              <Text numberOfLines={2} className="text-xs text-zinc-500 dark:text-zinc-400 leading-4">
                {skill.description}
              </Text>
              <View className="flex-row items-center justify-between gap-2">
                <Text numberOfLines={1} className="text-[11px] text-zinc-400 flex-1">
                  {skill.slug}
                  {skill.tools.length > 0 ? ` · ${skill.tools.length} tool limit` : ''}
                </Text>
                <View className="rounded-full border border-purple-500/25 bg-purple-500/10 px-2 py-0.5">
                  <Text className="text-[10px] font-semibold text-purple-500 dark:text-purple-300">
                    {skill.assignedAgentIds.length} agent
                    {skill.assignedAgentIds.length === 1 ? '' : 's'}
                  </Text>
                </View>
              </View>
            </Pressable>
          ))}
        </ScrollView>
      )}
    </View>
  );
}
