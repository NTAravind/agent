import type { AgentGroup } from '@agent/shared';
import { useCallback, useState } from 'react';
import { FlatList, Pressable, RefreshControl, Text, View } from 'react-native';
import { Spinner } from 'heroui-native';
import { useFocusEffect, useRouter } from 'expo-router';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { ChevronLeft, ChevronRight, Plus, Users } from 'lucide-react-native';
import { SymbolIcon } from '@/components/symbol-icon';

import { AppHeader, useHeaderInset } from '@/components/app-header';
import { ClusterAvatar } from '@/components/agent-avatar';
import { GroupedCard, InlineError, PillButton, RoundButton } from '@/components/design-system';
import { colors, radius, space } from '@/theme';
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

  const handleBack = useCallback(() => {
    if (router.canGoBack()) {
      router.back();
    } else {
      router.replace('/agents' as never);
    }
  }, [router]);

  const headerInset = useHeaderInset();

  return (
    <View style={{ flex: 1, backgroundColor: colors.background }}>
      <AppHeader
        left={
          <RoundButton
            icon={ChevronLeft}
            onPress={handleBack}
            accessibilityLabel="Go back"
          />
        }
        center={<Text style={{ fontSize: 20, lineHeight: 26, fontWeight: '600', color: colors.textPrimary }}>Groups</Text>}
        right={
          <RoundButton
            icon={Plus}
            onPress={() => router.push('/groups/new' as never)}
            accessibilityLabel="Create group"
          />
        }
      />

      <FlatList
        data={groups}
        keyExtractor={(group) => group.id}
        renderItem={({ item: group }) => (
          <Pressable
            onPress={() => router.push({ pathname: '/groups/[id]', params: { id: group.id } } as never)}
            accessibilityRole="button"
            accessibilityLabel={`Open ${group.name}`}
          >
            <GroupedCard style={{ padding: space.lg, gap: space.md }}>
              <View style={{ flexDirection: 'row', alignItems: 'center', gap: space.md }}>
                {/* The group profile is a collage of its members' avatars. */}
                <View style={{ width: 48, height: 48, alignItems: 'center', justifyContent: 'center' }}>
                  <ClusterAvatar size={48} members={group.members} />
                </View>
                <View style={{ minWidth: 0, flex: 1 }}>
                  <Text numberOfLines={1} style={{ fontSize: 17, fontWeight: '600', color: colors.textPrimary }}>
                    {group.name}
                  </Text>
                  {group.description ? (
                    <Text numberOfLines={1} style={{ marginTop: 2, fontSize: 13, color: colors.textSecondary }}>
                      {group.description}
                    </Text>
                  ) : null}
                </View>
                <SymbolIcon icon={ChevronRight} size={18} color={colors.textSecondary} />
              </View>
              <View style={{ flexDirection: 'row', alignItems: 'center', gap: space.sm }}>
                <View style={{ borderRadius: radius.pill, backgroundColor: colors.surfaceRaised, paddingHorizontal: 10, paddingVertical: 4 }}>
                  <Text style={{ fontSize: 12, fontWeight: '500', color: colors.textSecondary, textTransform: 'capitalize' }}>
                    {group.mode}
                  </Text>
                </View>
                <Text style={{ fontSize: 13, color: colors.textSecondary, fontVariant: ['tabular-nums'], }}>
                  {group.members.length} member{group.members.length === 1 ? '' : 's'} · {group.maxHops} hop cap
                </Text>
              </View>
            </GroupedCard>
          </Pressable>
        )}
        ListHeaderComponent={
          error ? <InlineError message={error} onRetry={() => void load()} /> : undefined
        }
        ListEmptyComponent={
          loading ? (
            <View style={{ alignItems: 'center', justifyContent: 'center', paddingVertical: 64 }}>
              <Spinner size="lg" color="default" />
            </View>
          ) : (
            <View style={{ alignItems: 'center', justifyContent: 'center', gap: space.md, paddingHorizontal: space.xl, paddingVertical: 64 }}>
              <View style={{ width: 64, height: 64, alignItems: 'center', justifyContent: 'center', borderRadius: radius.card, backgroundColor: colors.surface }}>
                <SymbolIcon icon={Users} size={28} color={colors.textSecondary} />
              </View>
              <Text style={{ fontSize: 17, fontWeight: '600', color: colors.textPrimary }}>No groups yet</Text>
              <Text style={{ maxWidth: 260, textAlign: 'center', fontSize: 14, lineHeight: 20, color: colors.textSecondary }}>
                Put agents together so they can ask each other for help and hand work forward.
              </Text>
              <PillButton
                label="Create group"
                onPress={() => router.push('/groups/new' as never)}
                variant="primary"
              />
            </View>
          )
        }
        contentContainerStyle={{
          padding: space.lg,
          paddingTop: headerInset,
          paddingBottom: insets.bottom + 32,
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
    </View>
  );
}
