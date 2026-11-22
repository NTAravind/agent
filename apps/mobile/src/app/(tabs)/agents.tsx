import { useCallback, useMemo, useState } from 'react';
import {
  Alert as RNAlert,
  KeyboardAvoidingView,
  Platform,
  Pressable,
  RefreshControl,
  ScrollView,
  StyleSheet,
  Text,
  View,
} from 'react-native';
import { Skeleton, Typography } from 'heroui-native';
import { useFocusEffect, useRouter } from 'expo-router';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { Plus, Search } from 'lucide-react-native';

import { AgentListRow } from '@/components/agent-list-row';
import { AgentSearch } from '@/components/agent-search';
import { AgentAvatar } from '@/components/agent-avatar';
import { RoundButton, PillButton } from '@/components/design-system';
import { colors, radius, shadow, space, typography } from '@/theme';
import {
  fetchAgents,
  fetchRuns,
  pauseRun,
  resumeRun,
  type Agent,
  type RunListItem,
} from '@/lib/agents';
import { fetchGroups, type AgentGroup } from '@/lib/groups';
import { useSession } from '@/lib/session';

export default function AgentsScreen() {
  const router = useRouter();
  const insets = useSafeAreaInsets();
  const { session } = useSession();

  const [runs, setRuns] = useState<RunListItem[]>([]);
  const [agents, setAgents] = useState<Agent[]>([]);
  const [groups, setGroups] = useState<AgentGroup[]>([]);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [searchOpen, setSearchOpen] = useState(false);
  const [expandedRowId, setExpandedRowId] = useState<string | null>(null);
  const [mutedAgents, setMutedAgents] = useState<Set<string>>(new Set());

  const load = useCallback(async () => {
    try {
      const [nextRuns, nextAgents, nextGroups] = await Promise.all([
        fetchRuns().catch(() => []),
        fetchAgents().catch(() => []),
        fetchGroups().catch(() => []),
      ]);
      setRuns(nextRuns);
      setAgents(nextAgents);
      setGroups(nextGroups);
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

  // Active run map by agent id
  const activeRunByAgent = useMemo(() => {
    const map = new Map<string, RunListItem | null>();
    agents.forEach((agent) => {
      const agentRuns = runs.filter(
        (r) => r.agent_id === agent.id && !['succeeded', 'failed', 'cancelled'].includes(r.status),
      );
      map.set(agent.id, agentRuns[0] ?? null);
    });
    return map;
  }, [agents, runs]);

  const handleRowPress = useCallback(
    (agent: Agent) => {
      if (expandedRowId && expandedRowId !== agent.id) {
        setExpandedRowId(null);
        return;
      }
      if (expandedRowId === agent.id) {
        setExpandedRowId(null);
        return;
      }
      router.push({ pathname: '/chat', params: { agentId: agent.id } });
    },
    [expandedRowId, router],
  );

  const handleGroupPress = useCallback(
    (group: AgentGroup) => {
      router.push({ pathname: '/groups/[id]', params: { id: group.id } });
    },
    [router],
  );

  const handleRowAction = useCallback(
    (action: 'pause' | 'skip' | 'notify', agentId: string) => {
      if (action === 'pause') {
        const run = activeRunByAgent.get(agentId) ?? null;
        if (!run) return;
        const resuming = run.status === 'paused';
        void (async () => {
          try {
            if (resuming) await resumeRun(run.id);
            else await pauseRun(run.id);
            await load();
          } catch (err) {
            RNAlert.alert(
              resuming ? 'Could not resume' : 'Could not pause',
              err instanceof Error ? err.message : String(err),
            );
          }
        })();
        return;
      }
      if (action === 'notify') {
        setMutedAgents((current) => {
          const next = new Set(current);
          if (next.has(agentId)) next.delete(agentId);
          else next.add(agentId);
          return next;
        });
        return;
      }
      RNAlert.alert('Not yet available', 'Skipping the current step needs backend support.');
    },
    [activeRunByAgent, load],
  );

  const userInitial = session?.user.email ? session.user.email.slice(0, 2).toUpperCase() : 'FL';

  return (
    <KeyboardAvoidingView
      style={styles.screen}
      behavior={Platform.OS === 'ios' ? 'padding' : undefined}
    >
      {/* 6.10 Floating header: round initials avatar (44x44) on left, round search + round plus on right with floating shadow */}
      <View
        style={[
          styles.headerBar,
          { paddingTop: insets.top + space.sm },
        ]}
      >
        {/* Left: User initials avatar (44x44, surfaceRaised, floating shadow) */}
        <Pressable
          onPress={() => router.push('/more')}
          accessibilityRole="button"
          accessibilityLabel="Open settings"
          style={({ pressed }) => [
            styles.initialsAvatar,
            shadow.floating,
            { opacity: pressed ? 0.6 : 1 },
          ]}
        >
          <Text style={styles.initialsText}>{userInitial}</Text>
        </Pressable>

        {/* Right: Round search and plus buttons */}
        <View style={styles.headerRight}>
          <RoundButton
            icon={Search}
            onPress={() => setSearchOpen(true)}
            accessibilityLabel="Search agents"
          />
          <RoundButton
            icon={Plus}
            onPress={() => router.push('/agents/new/edit')}
            accessibilityLabel="Create agent"
          />
        </View>
      </View>

      <ScrollView
        contentContainerStyle={{
          paddingTop: space.sm,
          paddingBottom: insets.bottom + 100, // accommodate pill dock
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
        onScrollBeginDrag={() => setExpandedRowId(null)}
      >
        {loading ? (
          <View style={{ marginTop: space.sm }}>
            {Array.from({ length: 6 }).map((_, i) => (
              <View key={i} style={styles.loadingRow}>
                <Skeleton variant="shimmer" style={styles.skeletonAvatar} />
                <View style={{ flex: 1, gap: 6 }}>
                  <Skeleton variant="shimmer" style={{ height: 16, width: 140, borderRadius: 8 }} />
                  <Skeleton variant="shimmer" style={{ height: 14, width: 220, borderRadius: 8 }} />
                </View>
              </View>
            ))}
          </View>
        ) : agents.length === 0 && groups.length === 0 ? (
          /* Empty state */
          <View style={styles.emptyContainer}>
            <View style={styles.emptyAvatarBox}>
              <AgentAvatar size={48} name="Agent" />
            </View>
            <Text style={styles.emptyTitle}>No agents yet</Text>
            <Text style={styles.emptySubtitle}>
              Create custom agents with their own model, personality, and tools.
            </Text>
            <PillButton
              label="Create your first agent"
              onPress={() => router.push('/agents/new/edit')}
              variant="primary"
              style={{ marginTop: space.lg }}
            />
          </View>
        ) : (
          <View>
            {/* 1. Groups */}
            {groups.map((group) => (
              <AgentListRow
                key={`group-${group.id}`}
                agent={{
                  id: group.id,
                  name: group.name,
                  role: 'Group chat',
                  instructions: group.description ?? '',
                  model: null,
                  fallbackModels: [],
                  avatar: { type: 'icon', value: 'bot', color: colors.mark.orange },
                  isSupervisor: false,
                  isSleeping: false,
                  toolCount: 0,
                  createdAt: group.createdAt,
                }}
                activeRun={null}
                isGroup={true}
                groupMembers={group.members}
                onPress={() => handleGroupPress(group)}
                onActionPress={() => {}}
                isActionsOpen={false}
                onActionsToggle={() => {}}
                lastMessage={group.description ?? 'Group chat'}
              />
            ))}

            {/* 2. Individual Agents */}
            {agents.map((agent) => {
              const activeRun = activeRunByAgent.get(agent.id) ?? null;
              const isExpanded = expandedRowId === agent.id;

              return (
                <AgentListRow
                  key={agent.id}
                  agent={agent}
                  activeRun={activeRun}
                  isPaused={activeRun?.status === 'paused'}
                  notificationsEnabled={!mutedAgents.has(agent.id)}
                  onPress={() => handleRowPress(agent)}
                  onActionPress={handleRowAction}
                  isActionsOpen={isExpanded}
                  onActionsToggle={(open) =>
                    setExpandedRowId(open ? agent.id : null)
                  }
                />
              );
            })}
          </View>
        )}

        {error && !loading && (
          <View style={styles.errorBox}>
            <Text style={styles.errorText}>{error}</Text>
            <PillButton
              label="Retry"
              onPress={() => void load()}
              variant="secondary"
              style={{ marginTop: space.sm }}
            />
          </View>
        )}
      </ScrollView>

      {/* Search bottom sheet */}
      <AgentSearch
        agents={agents}
        groups={groups}
        runs={runs}
        onSelect={(id) => {
          const target = agents.find((a) => a.id === id);
          if (target) handleRowPress(target);
        }}
        onSelectGroup={(id) => {
          const target = groups.find((g) => g.id === id);
          if (target) handleGroupPress(target);
        }}
        onClose={() => setSearchOpen(false)}
        isOpen={searchOpen}
      />
    </KeyboardAvoidingView>
  );
}

const styles = StyleSheet.create({
  screen: {
    flex: 1,
    backgroundColor: colors.background,
  },
  headerBar: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingHorizontal: space.lg,
    paddingBottom: space.sm,
  },
  initialsAvatar: {
    width: 44,
    height: 44,
    borderRadius: radius.pill,
    backgroundColor: colors.surfaceRaised,
    alignItems: 'center',
    justifyContent: 'center',
  },
  initialsText: {
    fontSize: 17,
    lineHeight: 22,
    fontWeight: '600',
    color: colors.textPrimary,
  },
  headerRight: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: space.sm,
  },
  loadingRow: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingHorizontal: space.lg,
    paddingVertical: 14,
    gap: space.md,
  },
  skeletonAvatar: {
    width: 44,
    height: 44,
    borderRadius: radius.pill,
  },
  emptyContainer: {
    alignItems: 'center',
    justifyContent: 'center',
    paddingHorizontal: space.xl,
    paddingVertical: 80,
  },
  emptyAvatarBox: {
    marginBottom: space.lg,
  },
  emptyTitle: {
    fontSize: 24,
    lineHeight: 30,
    fontWeight: '600',
    color: colors.textPrimary,
    marginBottom: space.xs,
  },
  emptySubtitle: {
    fontSize: 17,
    lineHeight: 22,
    fontWeight: '400',
    color: colors.textSecondary,
    textAlign: 'center',
    maxWidth: 280,
  },
  errorBox: {
    paddingHorizontal: space.lg,
    paddingVertical: space.md,
    alignItems: 'center',
  },
  errorText: {
    fontSize: 15,
    lineHeight: 20,
    color: colors.recording,
    textAlign: 'center',
  },
});
