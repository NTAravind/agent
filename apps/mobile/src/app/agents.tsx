import { useCallback, useMemo, useState } from 'react';
import { Button, Chip, Input, ListGroup, Spinner, Typography } from 'heroui-native';
import { Alert as RNAlert, KeyboardAvoidingView, Platform, RefreshControl, ScrollView, View } from 'react-native';
import { useFocusEffect, useRouter } from 'expo-router';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import { AppHeader } from '@/components/app-header';
import { fetchRuns, startRun, type RunListItem } from '@/lib/agents';

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
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(async () => {
    try {
      setRuns(await fetchRuns());
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
      const { runId } = await startRun(trimmed);
      setGoal('');
      await load();
      router.push({ pathname: '/run', params: { id: runId } });
    } catch (err) {
      RNAlert.alert('Could not start the run', err instanceof Error ? err.message : String(err));
    } finally {
      setStarting(false);
    }
  }, [goal, load, router]);

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
        <View className="gap-2">
          <Typography type="body-sm" color="muted">
            New task
          </Typography>
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
