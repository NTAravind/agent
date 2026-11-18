import { useCallback, useMemo, useState } from 'react';
import { Button, Chip, Input, ListGroup, Spinner, Typography } from 'heroui-native';
import { Alert as RNAlert, KeyboardAvoidingView, Platform, RefreshControl, ScrollView, View } from 'react-native';
import { useFocusEffect, useRouter } from 'expo-router';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import { AppHeader } from '@/components/app-header';
import { AgentAvatar } from '@/components/agent-avatar';
import { ModelPicker } from '@/components/model-picker';
import { fetchAgents, fetchRuns, startRun, type Agent, type RunListItem } from '@/lib/agents';
import { fetchEnabledModels, type ModelOption } from '@/lib/models';

const STATUS_COLOR: Record<string, 'default' | 'success' | 'danger' | 'warning'> = {
  queued: 'default',
  running: 'warning',
  awaiting_approval: 'warning',
  succeeded: 'success',
  failed: 'danger',
  cancelled: 'default',
};

export default function AgentsScreen() {
  const router = useRouter();
  const insets = useSafeAreaInsets();

  const [goal, setGoal] = useState('');
  const [starting, setStarting] = useState(false);
  const [runs, setRuns] = useState<RunListItem[]>([]);
  const [agents, setAgents] = useState<Agent[]>([]);
  const [models, setModels] = useState<ModelOption[]>([]);
  const [modelId, setModelId] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(async () => {
    try {
      const [nextRuns, modelResponse, nextAgents] = await Promise.all([
        fetchRuns(),
        fetchEnabledModels(),
        fetchAgents(),
      ]);
      setRuns(nextRuns);
      setAgents(nextAgents);
      const available = modelResponse?.models.filter((model) => model.available && model.capabilities.tools && model.capabilities.structuredOutput) ?? [];
      setModels(available);
      setModelId((current) => current && available.some((model) => model.id === current)
        ? current
        : available.find((model) => model.id === modelResponse?.defaultModel)?.id ?? available[0]?.id ?? null);
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

  const handleStart = useCallback(async () => {
    const trimmed = goal.trim();
    if (trimmed.length < 3) {
      RNAlert.alert('Describe the task', 'Give the agent a goal with at least 3 characters.');
      return;
    }

    setStarting(true);
    try {
      const { runId } = await startRun(trimmed, modelId);
      setGoal('');
      await load();
      router.push({ pathname: '/run', params: { id: runId } });
    } catch (err) {
      RNAlert.alert('Could not start the run', err instanceof Error ? err.message : String(err));
    } finally {
      setStarting(false);
    }
  }, [goal, load, modelId, router]);

  const grouped = useMemo(() => runs, [runs]);

  return (
    <KeyboardAvoidingView
      className="flex-1 bg-background"
      behavior={Platform.OS === 'ios' ? 'padding' : undefined}
    >
      <AppHeader
        left={
          <Button size="md" variant="ghost" onPress={() => router.back()}>
            <Button.Label>Close</Button.Label>
          </Button>
        }
        center={<Typography type="h4">Agents</Typography>}
        right={
          <Button
            size="md"
            variant="ghost"
            onPress={() => router.push('/agents/new')}
            accessibilityLabel="New agent"
          >
            <Button.Label>+</Button.Label>
          </Button>
        }
      />

      <ScrollView
        contentContainerStyle={{ padding: 16, paddingBottom: insets.bottom + 24, gap: 16 }}
        keyboardShouldPersistTaps="handled"
        refreshControl={
          <RefreshControl
            refreshing={refreshing}
            onRefresh={() => {
              setRefreshing(true);
              void load();
            }}
            tintColor="#208AEF"
          />
        }
      >
        {agents.length > 0 ? (
          <View className="gap-2">
            <Typography type="body-sm" color="muted">
              Your agents
            </Typography>
            <ListGroup className="rounded-2xl">
              {agents.map((agent) => (
                <ListGroup.Item
                  key={agent.id}
                  onPress={() =>
                    router.push({ pathname: '/agents/[id]', params: { id: agent.id } })
                  }
                  accessibilityLabel={`Edit ${agent.name}`}
                >
                  <ListGroup.ItemPrefix>
                    <AgentAvatar avatar={agent.avatar} size={32} />
                  </ListGroup.ItemPrefix>
                  <ListGroup.ItemContent>
                    <ListGroup.ItemTitle>{agent.name}</ListGroup.ItemTitle>
                    <ListGroup.ItemDescription>
                      {[
                        agent.role ?? 'No role',
                        agent.toolCount > 0 ? `${agent.toolCount} MCP tools` : null,
                      ]
                        .filter(Boolean)
                        .join(' · ')}
                    </ListGroup.ItemDescription>
                  </ListGroup.ItemContent>
                  <ListGroup.ItemSuffix />
                </ListGroup.Item>
              ))}
            </ListGroup>
          </View>
        ) : null}

        <View className="gap-2">
          <Typography type="body-sm" color="muted">
            New task
          </Typography>
          <View className="flex-row items-center justify-between rounded-xl border border-border px-3 py-1">
            <Typography type="body-sm" color="muted">Preferred model</Typography>
            <ModelPicker models={models} selectedId={modelId} onSelect={setModelId} />
          </View>
          <Input
            value={goal}
            onChangeText={setGoal}
            placeholder="e.g. Research the best free LLM APIs this week and summarize trade-offs"
            onSubmitEditing={() => void handleStart()}
            returnKeyType="send"
            multiline
          />
          <Button onPress={() => void handleStart()} isDisabled={starting}>
            {starting ? <Spinner size="sm" /> : <Button.Label>Run as task</Button.Label>}
          </Button>
        </View>

        {error ? (
          <Typography type="body-sm" className="text-danger">
            {error}
          </Typography>
        ) : null}

        <View className="gap-2">
          <Typography type="body-sm" color="muted">
            Runs
          </Typography>

          {loading ? (
            <View className="items-center py-8">
              <Spinner />
            </View>
          ) : grouped.length === 0 ? (
            <Typography type="body-sm" color="muted">
              No runs yet. Give the agent a goal above — it keeps working even if you close the app.
            </Typography>
          ) : (
            <ListGroup className="rounded-2xl">
              {grouped.map((run) => (
                <ListGroup.Item
                  key={run.id}
                  onPress={() => router.push({ pathname: '/run', params: { id: run.id } })}
                  accessibilityLabel={run.goal}
                >
                  <ListGroup.ItemContent>
                    <ListGroup.ItemTitle numberOfLines={2}>{run.goal}</ListGroup.ItemTitle>
                    <ListGroup.ItemDescription>
                      {new Date(run.created_at).toLocaleString()}
                      {run.tokens_used > 0 ? ` · ${run.tokens_used} tokens` : ''}
                    </ListGroup.ItemDescription>
                  </ListGroup.ItemContent>
                  <ListGroup.ItemSuffix>
                    <Chip variant="soft" size="sm" color={STATUS_COLOR[run.status] ?? 'default'}>
                      <Chip.Label>{run.status.replace('_', ' ')}</Chip.Label>
                    </Chip>
                  </ListGroup.ItemSuffix>
                </ListGroup.Item>
              ))}
            </ListGroup>
          )}
        </View>
      </ScrollView>
    </KeyboardAvoidingView>
  );
}
