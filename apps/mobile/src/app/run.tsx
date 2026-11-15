import { useCallback, useEffect, useRef, useState } from 'react';
import { Button, Card, Chip, Spinner, Typography } from 'heroui-native';
import { RefreshControl, ScrollView, View } from 'react-native';
import { useFocusEffect, useLocalSearchParams, useRouter } from 'expo-router';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import type { RunEvent } from '@agent/shared';

import { AppHeader } from '@/components/app-header';
import { fetchRun, type RunDetail } from '@/lib/agents';

const ACTIVE = new Set(['queued', 'running', 'awaiting_approval']);

const NODE_LABEL: Record<string, string> = {
  plan: 'Making a plan',
  act: 'Researching',
  observe: 'Checking progress',
  self_correct: 'Adjusting approach',
  finalize: 'Writing the result',
};

export default function RunScreen() {
  const router = useRouter();
  const insets = useSafeAreaInsets();
  const { id } = useLocalSearchParams<{ id: string }>();

  const [detail, setDetail] = useState<RunDetail | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [refreshing, setRefreshing] = useState(false);
  const pollRef = useRef<ReturnType<typeof setInterval> | null>(null);

  const load = useCallback(async () => {
    if (!id) return;
    try {
      const result = await fetchRun(id);
      setDetail(result);
      setError(null);
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setRefreshing(false);
    }
  }, [id]);

  useFocusEffect(
    useCallback(() => {
      void load();
    }, [load]),
  );

  const status = detail?.run.status;

  useEffect(() => {
    const active = status ? ACTIVE.has(status) : false;
    if (active && !pollRef.current) {
      pollRef.current = setInterval(() => void load(), 2500);
    }
    if (!active && pollRef.current) {
      clearInterval(pollRef.current);
      pollRef.current = null;
    }
    return () => {
      if (pollRef.current) {
        clearInterval(pollRef.current);
        pollRef.current = null;
      }
    };
  }, [status, load]);

  const run = detail?.run;
  const events = detail?.events ?? [];
  const answer =
    run?.status === 'succeeded' && run.result && typeof run.result === 'object'
      ? String((run.result as { answer?: string }).answer ?? '')
      : '';

  return (
    <View className="flex-1 bg-background">
      <AppHeader
        left={
          <Button size="md" variant="ghost" onPress={() => router.back()}>
            <Button.Label>Back</Button.Label>
          </Button>
        }
        center={
          <Chip
            variant="soft"
            size="sm"
            color={
              status === 'succeeded'
                ? 'success'
                : status === 'failed'
                  ? 'danger'
                  : status === 'running' || status === 'queued'
                    ? 'warning'
                    : 'default'
            }
          >
            <Chip.Label>{status ? status.replace('_', ' ') : '…'}</Chip.Label>
          </Chip>
        }
      />

      <ScrollView
        contentContainerStyle={{ padding: 16, paddingBottom: insets.bottom + 24, gap: 16 }}
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
        {run ? (
          <Typography type="body" weight="semibold">
            {run.goal}
          </Typography>
        ) : null}

        {error ? (
          <Typography type="body-sm" className="text-danger">
            {error}
          </Typography>
        ) : null}

        {!detail ? (
          <View className="items-center py-10">
            <Spinner />
          </View>
        ) : null}

        {answer ? (
          <Card className="rounded-2xl">
            <Card.Body className="gap-2">
              <Card.Title>Result</Card.Title>
              <Typography type="body" className="leading-6">
                {answer}
              </Typography>
            </Card.Body>
          </Card>
        ) : null}

        {run?.status === 'failed' && run.error ? (
          <Typography type="body-sm" className="text-danger">
            {run.error}
          </Typography>
        ) : null}

        <View className="gap-1.5">
          {events.map((event: RunEvent) => (
            <EventRow key={event.id} event={event} />
          ))}
          {status && ACTIVE.has(status) ? (
            <View className="flex-row items-center gap-2 py-2">
              <Spinner size="sm" />
              <Typography type="body-xs" color="muted">
                Working… you can close the app, it keeps going.
              </Typography>
            </View>
          ) : null}
        </View>
      </ScrollView>
    </View>
  );
}

function EventRow({ event }: { event: RunEvent }) {
  const payload = (event.payload ?? {}) as Record<string, unknown>;

  if (event.type === 'node_start') {
    const node = String(payload.node ?? '');
    const label = NODE_LABEL[node] ?? node;
    return (
      <View className="flex-row items-center gap-2">
        <View className="h-1.5 w-1.5 rounded-full bg-accent" />
        <Typography type="body-sm" weight="semibold">
          {label}
        </Typography>
      </View>
    );
  }

  if (event.type === 'node_end') {
    if (payload.failed) {
      return (
        <Typography type="body-xs" className="text-danger">
          {`↳ failed, will retry differently`}
        </Typography>
      );
    }
    return (
      <Typography type="body-xs" color="muted">
        {`↳ ${String(payload.note ?? payload.summary ?? payload.action ?? 'done')}`}
      </Typography>
    );
  }

  if (event.type === 'tool_call') {
    return (
      <Typography type="body-xs" color="muted">
        {`🔧 ${String(payload.tool ?? 'tool')} ${typeof payload.args === 'string' ? truncate(payload.args, 90) : ''}`}
      </Typography>
    );
  }

  if (event.type === 'tool_result') {
    return (
      <Typography type="body-xs" color="muted">
        {`✓ ${String(payload.tool ?? '')} ${typeof payload.result === 'string' ? truncate(payload.result, 90) : ''}`}
      </Typography>
    );
  }

  if (event.type === 'error') {
    return (
      <Typography type="body-xs" className="text-danger">
        {`⚠ ${String(payload.message ?? 'error')}`}
      </Typography>
    );
  }

  return null;
}

function truncate(text: string, max: number): string {
  return text.length > max ? `${text.slice(0, max)}…` : text;
}
