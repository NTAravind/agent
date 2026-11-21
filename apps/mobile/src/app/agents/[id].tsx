import type { Agent } from '@agent/shared';
import { useCallback, useEffect, useState } from 'react';
import { Alert as RNAlert, ScrollView, View } from 'react-native';
import { BottomSheet, Button, Chip, Spinner, Typography, useThemeColor } from 'heroui-native';
import { useFocusEffect, useLocalSearchParams, useRouter } from 'expo-router';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import { AppHeader } from '@/components/app-header';
import { AgentAvatar as AgentAvatarBadge } from '@/components/agent-avatar';
import { AgentQuickActions } from '@/components/agent-quick-actions';
import { AgentDetailSection } from '@/components/agent-detail-section';
import { SCREEN_ICONS } from '@/constants/icons';
import { deleteAgent, fetchAgents, fetchRuns, pauseRun, resumeRun, sleepAgent, wakeAgent, type RunListItem } from '@/lib/agents';

/** Local-only quick-action prefs — TODO(backend) when per-agent prefs exist. */
const INITIAL_PREFS = {
  notificationsEnabled: true,
  memoryEnabled: true,
};

type LocalPrefs = typeof INITIAL_PREFS;

/**
 * Agent overview / detail screen.
 * - Top: centered avatar + large name
 * - Bottom: rounded sheet panel with quick actions, agent info, tools
 * - Danger zone: Duplicate / Delete
 * The full editor lives at agents/[id]/edit.tsx.
 */
export default function AgentDetailScreen() {
  const router = useRouter();
  const insets = useSafeAreaInsets();
  const params = useLocalSearchParams<{ id: string }>();
  const id = typeof params.id === 'string' ? params.id : '';

  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [agent, setAgent] = useState<Agent | null>(null);
  const [activeRun, setActiveRun] = useState<RunListItem | null>(null);
  const [prefs, setPrefs] = useState<LocalPrefs>(INITIAL_PREFS);
  const [toolsSheetOpen, setToolsSheetOpen] = useState(false);
  const iconColor = useThemeColor('foreground');

  // `/agents/new` is the create flow — it lands in the editor, not here.
  useEffect(() => {
    if (id === 'new') {
      router.replace('/agents/new/edit');
    }
  }, [id, router]);

  const load = useCallback(async () => {
    if (id === 'new') return; // redirecting to the editor
    try {
      const [agents, runs] = await Promise.all([fetchAgents(), fetchRuns()]);
      const found = agents.find((a) => a.id === id) ?? null;
      setAgent(found);
      if (!found) {
        setError('Agent not found');
        return;
      }
      // Most recent non-finished run owned by this agent (agent_id is joined
      // by GET /api/runs — no goal-name heuristic needed).
      const agentRuns = runs.filter(
        (r) => r.agent_id === found.id && !['succeeded', 'failed', 'cancelled'].includes(r.status),
      );
      setActiveRun(agentRuns[0] ?? null);
      setError(null);
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setLoading(false);
    }
  }, [id]);

  useFocusEffect(
    useCallback(() => {
      void load();
    }, [load]),
  );

  /** Pauses/resumes the agent's active task (server-backed, see lib/agents). */
  const handlePauseToggle = useCallback(() => {
    if (!activeRun) return;
    const resuming = activeRun.status === 'paused';
    void (async () => {
      try {
        if (resuming) await resumeRun(activeRun.id);
        else await pauseRun(activeRun.id);
        await load();
      } catch (err) {
        RNAlert.alert(
          resuming ? 'Could not resume' : 'Could not pause',
          err instanceof Error ? err.message : String(err),
        );
      }
    })();
  }, [activeRun, load]);

  /** Sleeps/wakes the agent: pauses all of its tasks + blocks new ones. */
  const handleSleepToggle = useCallback(() => {
    if (!agent) return;
    const sleeping = agent.isSleeping;
    void (async () => {
      try {
        if (sleeping) await wakeAgent(agent.id);
        else await sleepAgent(agent.id);
        await load();
      } catch (err) {
        RNAlert.alert(
          sleeping ? 'Could not wake' : 'Could not sleep',
          err instanceof Error ? err.message : String(err),
        );
      }
    })();
  }, [agent, load]);

  const handleQuickAction = useCallback((key: keyof LocalPrefs) => {
    // TODO(backend): notifications + memory are still optimistic local prefs
    // (no per-agent preference endpoints yet).
    setPrefs((prev) => ({ ...prev, [key]: !prev[key] }));
  }, []);

  const handleDuplicate = useCallback(() => {
    // TODO(backend): POST /api/agents/:id/duplicate
    RNAlert.alert(
      'Duplicate Agent',
      'This will create a copy of this agent. (TODO(backend): API not yet implemented)',
    );
  }, []);

  const handleDelete = useCallback(() => {
    RNAlert.alert(
      'Delete this agent?',
      'MCP integrations attached to it are removed. Run history is kept.',
      [
        { text: 'Cancel', style: 'cancel' },
        {
          text: 'Delete',
          style: 'destructive',
          onPress: () => {
            void (async () => {
              try {
                await deleteAgent(id);
                router.back();
              } catch (err) {
                RNAlert.alert('Could not delete', err instanceof Error ? err.message : String(err));
              }
            })();
          },
        },
      ],
    );
  }, [id, router]);

  /** "⋯" fallback menu: edit / duplicate / delete (moved from the list's long-press). */
  const handleMoreMenu = useCallback(() => {
    RNAlert.alert(agent?.name ?? 'Agent', 'Manage this agent', [
      {
        text: 'Edit',
        onPress: () => router.push({ pathname: '/agents/[id]/edit', params: { id } }),
      },
      { text: 'Duplicate', onPress: handleDuplicate },
      { text: 'Delete', style: 'destructive', onPress: handleDelete },
      { text: 'Cancel', style: 'cancel' },
    ]);
  }, [agent?.name, handleDelete, handleDuplicate, id, router]);

  // `/agents/new` is mid-redirect to the editor.
  if (id === 'new') return null;

  if (loading) {
    return (
      <View className="flex-1 bg-background items-center justify-center gap-3">
        <Spinner />
        <Typography type="body" color="muted">Loading agent...</Typography>
      </View>
    );
  }

  if (error || !agent) {
    return (
      <View className="flex-1 bg-background items-center justify-center px-6">
        <Typography type="h3" weight="semibold" className="text-center mb-2">
          {error ?? 'Agent not found'}
        </Typography>
        <Button variant="secondary" onPress={() => router.back()} className="mt-4">
          <Button.Label>Back</Button.Label>
        </Button>
      </View>
    );
  }

  const modelLabel = agent.model ?? 'App default';
  const toolsSummary = agent.toolCount > 0
    ? `${agent.toolCount} MCP tool${agent.toolCount === 1 ? '' : 's'} enabled`
    : 'No MCP tools enabled';

  return (
    <View className="flex-1 bg-background">
      {/* Header */}
      <AppHeader
        left={
          <Button
            size="md"
            variant="ghost"
            isIconOnly
            onPress={() => router.back()}
            accessibilityRole="button"
            accessibilityLabel="Go back"
            accessibilityHint="Returns to the previous screen"
          >
            <SCREEN_ICONS.back size={22} color={iconColor} />
          </Button>
        }
        center={
          <Typography type="body" weight="semibold">
            {agent.name}
          </Typography>
        }
        right={
          <Button
            size="md"
            variant="ghost"
            isIconOnly
            onPress={handleMoreMenu}
            accessibilityRole="button"
            accessibilityLabel="More actions"
            accessibilityHint="Opens edit, duplicate and delete options"
          >
            <SCREEN_ICONS.more size={22} color={iconColor} />
          </Button>
        }
      />

      <ScrollView
        contentContainerStyle={{ paddingBottom: insets.bottom + 24 }}
        className="flex-1"
      >
        {/* Top area: centered avatar + name with breathing room */}
        <View className="items-center justify-center px-6 py-10 gap-3">
          <AgentAvatarBadge avatar={agent.avatar} name={agent.name} size={96} />
          <Typography type="h2" weight="bold" className="text-center">
            {agent.name}
          </Typography>
          {agent.isSleeping && (
            <Chip variant="soft" size="sm" color="default">
              <Chip.Label>💤 Sleeping</Chip.Label>
            </Chip>
          )}
          {activeRun && (
            <Chip
              variant="soft"
              size="sm"
              color={activeRun.status === 'paused' ? 'default' : 'warning'}
            >
              <Chip.Label>
                {activeRun.status === 'paused'
                  ? `Paused: ${activeRun.goal}`
                  : `Active: ${activeRun.goal}`}
              </Chip.Label>
            </Chip>
          )}
        </View>

        {/* Bottom sheet panel */}
        <View className="bg-surface rounded-t-2xl shadow-lg flex-1 pt-6 px-4 gap-6">
          {/* Quick actions row */}
          <View className="w-full">
            <AgentQuickActions
              agentName={agent.name}
              isPaused={activeRun?.status === 'paused'}
              pauseDisabled={!activeRun}
              onPauseToggle={handlePauseToggle}
              notificationsEnabled={prefs.notificationsEnabled}
              onNotificationsToggle={() => handleQuickAction('notificationsEnabled')}
              isSleeping={agent.isSleeping}
              onSleepToggle={handleSleepToggle}
              memoryEnabled={prefs.memoryEnabled}
              onMemoryToggle={() => handleQuickAction('memoryEnabled')}
            />
          </View>

          {/* Agent info section */}
          <AgentDetailSection
            label="Agent info"
            action={
              <Button
                size="sm"
                variant="secondary"
                onPress={() => router.push({ pathname: '/agents/[id]/edit', params: { id } })}
                accessibilityLabel="Edit agent info"
              >
                <Button.Label>Edit</Button.Label>
              </Button>
            }
          >
            <View className="gap-2">
              <View className="flex-row justify-between">
                <Typography type="body" color="muted">Name</Typography>
                <Typography type="body" weight="semibold" numberOfLines={1} className="max-w-[60%]" align="end">
                  {agent.name}
                </Typography>
              </View>
              <View className="flex-row justify-between">
                <Typography type="body" color="muted">Role</Typography>
                <Typography type="body" weight="semibold" numberOfLines={1} className="max-w-[60%]" align="end">
                  {agent.role ?? '—'}
                </Typography>
              </View>
              <View className="flex-row justify-between">
                <Typography type="body" color="muted">Model</Typography>
                <Typography type="body" weight="semibold" numberOfLines={1} className="max-w-[60%]" align="end">
                  {modelLabel}
                </Typography>
              </View>
              <View className="flex-row justify-between">
                <Typography type="body" color="muted">Fallback</Typography>
                <Typography type="body" weight="semibold" numberOfLines={1} className="max-w-[60%]" align="end">
                  {agent.fallbackModels.length > 0 ? agent.fallbackModels.join(', ') : '—'}
                </Typography>
              </View>
              <View className="flex-row justify-between">
                <Typography type="body" color="muted">Supervisor</Typography>
                <Typography type="body" weight="semibold">
                  {agent.isSupervisor ? 'Yes' : 'No'}
                </Typography>
              </View>
              {agent.instructions ? (
                <View className="gap-0.5 pt-1">
                  <Typography type="body" color="muted">Instructions</Typography>
                  <Typography type="body-sm" numberOfLines={2}>
                    {agent.instructions}
                  </Typography>
                </View>
              ) : null}
            </View>
          </AgentDetailSection>

          {/* Tools section */}
          <AgentDetailSection
            label="Tools"
            action={
              <Button
                size="sm"
                variant="secondary"
                onPress={() => setToolsSheetOpen(true)}
                accessibilityRole="button"
                accessibilityLabel="Edit tools"
                accessibilityHint="Opens a sheet summarising this agent's enabled tools"
              >
                <Button.Label>Edit tools</Button.Label>
              </Button>
            }
            secondaryAction={
              <Button
                size="sm"
                variant="secondary"
                onPress={() => router.push('/mcp')}
                accessibilityRole="button"
                accessibilityLabel="Add integrations"
                accessibilityHint="Opens the MCP Store to browse integrations"
              >
                <Button.Label>Add integrations</Button.Label>
              </Button>
            }
          >
            <View className="gap-2">
              <Typography type="body" color="muted">{toolsSummary}</Typography>
              {agent.toolCount > 0 && (
                <View className="flex-row flex-wrap gap-2">
                  <Chip variant="soft" size="sm">
                    <Chip.Label>MCP Tools Enabled</Chip.Label>
                  </Chip>
                </View>
              )}
            </View>
          </AgentDetailSection>

          {/* Danger zone */}
          <View className="gap-2 w-full">
            <Typography type="body-xs" color="muted" weight="semibold" className="text-center">
              DANGER ZONE
            </Typography>
            <View className="flex-row gap-3">
              <Button
                variant="secondary"
                onPress={handleDuplicate}
                className="flex-1"
                accessibilityLabel="Duplicate this agent"
              >
                <Button.Label>Duplicate</Button.Label>
              </Button>
              <Button
                variant="danger"
                onPress={handleDelete}
                className="flex-1"
                accessibilityLabel="Delete this agent"
              >
                <Button.Label>Delete</Button.Label>
              </Button>
            </View>
          </View>
        </View>
      </ScrollView>

      {/* Tools sheet: summary + link to the integration screens.
          Per-agent tool toggles are not in the API yet — the per-tool
          permission UI lives on each MCP integration screen. */}
      <BottomSheet
        isOpen={toolsSheetOpen}
        onOpenChange={(open: boolean) => setToolsSheetOpen(open)}
      >
        <BottomSheet.Portal>
          <BottomSheet.Overlay />
          <BottomSheet.Content enableDynamicSizing={false} snapPoints={['45%']}>
            <BottomSheet.Close accessibilityLabel="Close tools sheet" />
            <BottomSheet.Title>Tools</BottomSheet.Title>
            <BottomSheet.Description>
              {toolsSummary}
            </BottomSheet.Description>

            <View className="gap-4 px-4 pb-6">
              <Typography type="body-sm" color="muted">
                Tool permissions are managed per integration. Enable, disable or require
                approval for individual tools on each integration&apos;s screen.
              </Typography>

              {agent.toolCount > 0 ? (
                <View className="flex-row flex-wrap gap-2">
                  <Chip variant="soft" size="sm">
                    <Chip.Label>{agent.toolCount} MCP tool{agent.toolCount === 1 ? '' : 's'} enabled</Chip.Label>
                  </Chip>
                </View>
              ) : (
                <Typography type="body-sm" color="muted">
                  No tools enabled yet — connect an integration to give this agent tools.
                </Typography>
              )}

              <Button
                variant="primary"
                onPress={() => {
                  setToolsSheetOpen(false);
                  router.push('/mcp');
                }}
                accessibilityRole="button"
                accessibilityLabel="Manage integrations"
                accessibilityHint="Opens the MCP Store to browse and connect integrations"
              >
                <Button.Label>Manage integrations</Button.Label>
              </Button>
            </View>
          </BottomSheet.Content>
        </BottomSheet.Portal>
      </BottomSheet>
    </View>
  );
}