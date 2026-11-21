import { useCallback, useMemo, useState } from 'react';
import {
  Alert as RNAlert,
  KeyboardAvoidingView,
  Platform,
  Pressable,
  RefreshControl,
  ScrollView,
  Text,
  View,
} from 'react-native';
import { Button, Skeleton, Typography } from 'heroui-native';
import { useFocusEffect, useRouter } from 'expo-router';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { Plus, Search } from 'lucide-react-native';

import { AgentTile } from '@/components/agent-tile';
import { AgentListRow } from '@/components/agent-list-row';
import { AgentSearch } from '@/components/agent-search';
import { AgentAvatar } from '@/components/agent-avatar';
import {
  fetchAgents,
  fetchRuns,
  pauseRun,
  resumeRun,
  type Agent,
  type RunListItem,
} from '@/lib/agents';
import { useSession } from '@/lib/session';

export default function AgentsScreen() {
  const router = useRouter();
  const insets = useSafeAreaInsets();
  const { session } = useSession();

  const [runs, setRuns] = useState<RunListItem[]>([]);
  const [agents, setAgents] = useState<Agent[]>([]);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [searchOpen, setSearchOpen] = useState(false);
  const [expandedRowId, setExpandedRowId] = useState<string | null>(null);
  const [mutedAgents, setMutedAgents] = useState<Set<string>>(new Set());

  const load = useCallback(async () => {
    try {
      const [nextRuns, nextAgents] = await Promise.all([
        fetchRuns(),
        fetchAgents(),
      ]);
      setRuns(nextRuns);
      setAgents(nextAgents);
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

  // Top pinned agents (supervisor first, or first 3 agents)
  const pinnedAgents = useMemo(() => {
    if (agents.length <= 1) return [];
    // Prioritize supervisor agents or the first 3 agents
    const supervisors = agents.filter((a) => a.isSupervisor);
    const nonSupervisors = agents.filter((a) => !a.isSupervisor);
    return [...supervisors, ...nonSupervisors].slice(0, 3);
  }, [agents]);

  // List agents (if there are pinned agents, show the rest or all)
  const listAgents = useMemo(() => {
    if (agents.length <= 3) return agents;
    // Show agents not in the pinned row
    const pinnedIds = new Set(pinnedAgents.map((a) => a.id));
    return agents.filter((a) => !pinnedIds.has(a.id));
  }, [agents, pinnedAgents]);

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

  const handleRowAction = useCallback(
    (action: 'pause' | 'skip' | 'notify', agentId: string) => {
      if (action === 'pause') {
        // Real pause/resume of the agent's active run — the API flips the run
        // status; the graph stops (or continues) at its next step boundary.
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

  const userInitial = session?.user.email?.[0]?.toUpperCase() ?? '👤';

  return (
    <KeyboardAvoidingView
      className="flex-1 bg-white dark:bg-[#09090b]"
      behavior={Platform.OS === 'ios' ? 'padding' : undefined}
    >
      {/* Top Header matching reference design */}
      <View
        className="flex-row items-center justify-between px-5 pb-3"
        style={{ paddingTop: insets.top + 8 }}
      >
        {/* Left: User Avatar */}
        <Pressable
          onPress={() => router.push('/settings' as any)}
          accessibilityRole="button"
          accessibilityLabel="Open settings"
          className="h-10 w-10 items-center justify-center rounded-full border border-zinc-200 dark:border-white/10 bg-zinc-100 dark:bg-white/10 active:opacity-75"
        >
          <Text className="text-sm font-semibold text-zinc-800 dark:text-zinc-200">
            {userInitial}
          </Text>
        </Pressable>

        {/* Right: Search & Create Round Action Buttons */}
        <View className="flex-row items-center gap-2.5">
          <Pressable
            onPress={() => setSearchOpen(true)}
            accessibilityRole="button"
            accessibilityLabel="Search agents"
            className="h-9.5 w-9.5 items-center justify-center rounded-full border border-zinc-200 dark:border-white/10 bg-zinc-50 dark:bg-white/5 shadow-sm active:bg-zinc-100 dark:active:bg-white/10"
          >
            <Search size={17} color="#71717a" />
          </Pressable>

          <Pressable
            onPress={() => router.push('/agents/new/edit')}
            accessibilityRole="button"
            accessibilityLabel="Create agent"
            className="h-9.5 w-9.5 items-center justify-center rounded-full border border-zinc-200 dark:border-white/10 bg-zinc-50 dark:bg-white/5 shadow-sm active:bg-zinc-100 dark:active:bg-white/10"
          >
            <Plus size={19} color="#71717a" />
          </Pressable>
        </View>
      </View>

      <ScrollView
        contentContainerStyle={{ paddingBottom: insets.bottom + 24 }}
        keyboardShouldPersistTaps="handled"
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
        onScrollBeginDrag={() => setExpandedRowId(null)}
      >
        {/* Pinned Creatures Row (only shown when there are real agents to pin) */}
        {pinnedAgents.length > 0 && (
          <View className="my-2 px-4 py-2">
            <View className="flex-row items-center justify-around">
              {loading ? (
                Array.from({ length: 3 }).map((_, i) => (
                  <View key={i} className="items-center gap-2" style={{ width: 92 }}>
                    <Skeleton variant="shimmer" className="h-17 w-17 rounded-3xl" />
                    <Skeleton variant="shimmer" className="h-3.5 w-16 rounded-full" />
                  </View>
                ))
              ) : (
                pinnedAgents.map((agent) => (
                  <AgentTile
                    key={agent.id}
                    agent={agent}
                    onPress={() => handleRowPress(agent)}
                  />
                ))
              )}
            </View>
          </View>
        )}

        {/* Real Agent Contact List */}
        {loading ? (
          <View className="mt-2">
            {Array.from({ length: 5 }).map((_, i) => (
              <View key={i} className="flex-row items-center px-4 py-3.5 gap-3.5">
                <Skeleton variant="shimmer" className="h-12 w-12 rounded-2xl" />
                <View className="flex-1 gap-1.5">
                  <Skeleton variant="shimmer" className="h-4 w-40 rounded-full" />
                  <Skeleton variant="shimmer" className="h-3 w-64 rounded-full" />
                </View>
              </View>
            ))}
          </View>
        ) : agents.length === 0 ? (
          /* Clean Empty State when user has no agents yet */
          <View className="flex-1 items-center justify-center px-6 py-20">
            <View className="h-20 w-20 items-center justify-center rounded-3xl border border-zinc-200 dark:border-white/10 bg-zinc-100 dark:bg-white/5 mb-4 shadow-sm">
              <AgentAvatar size={52} name="Agent" />
            </View>
            <Typography type="h3" weight="semibold" className="text-center text-zinc-900 dark:text-white mb-2">
              No agents yet
            </Typography>
            <Typography type="body-sm" className="text-center text-zinc-500 dark:text-zinc-400 mb-6 max-w-xs">
              Create custom agents with their own model, personality, and MCP tools to automate research and workflows.
            </Typography>
            <Button
              onPress={() => router.push('/agents/new/edit')}
              className="rounded-full px-6"
            >
              <Button.Label>Create your first agent</Button.Label>
            </Button>
          </View>
        ) : (
          <View className="mt-1">
            {listAgents.map((agent) => {
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
          <View className="px-5 py-4">
            <Typography type="body-sm" className="text-red-500 text-center">
              {error}
            </Typography>
            <Button variant="secondary" onPress={() => void load()} className="mt-2 w-full">
              <Button.Label>Retry</Button.Label>
            </Button>
          </View>
        )}
      </ScrollView>

      {/* Search bottom sheet */}
      <AgentSearch
        agents={agents}
        runs={runs}
        onSelect={(id) => {
          const target = agents.find((a) => a.id === id);
          if (target) handleRowPress(target);
        }}
        onClose={() => setSearchOpen(false)}
        isOpen={searchOpen}
      />
    </KeyboardAvoidingView>
  );
}
