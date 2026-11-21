import { useCallback, useEffect, useRef, useState } from 'react';
import { Button, Spinner, Typography } from 'heroui-native';
import { Alert as RNAlert, Pressable, RefreshControl, ScrollView, Text, View } from 'react-native';
import { useFocusEffect, useLocalSearchParams, useRouter } from 'expo-router';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { AlertTriangle, Check, CheckCircle2, ChevronRight, Wrench, XCircle } from 'lucide-react-native';
import { DEFAULT_AGENT_AVATAR, type Approval, type RunEvent } from '@agent/shared';

import { AppHeader } from '@/components/app-header';
import { AgentAvatar } from '@/components/agent-avatar';
import { cancelRun, decideApproval, fetchRun, pauseRun, resumeRun, type RunDetail } from '@/lib/agents';

const ACTIVE = new Set(['queued', 'running', 'awaiting_approval']);
/** Statuses that keep the detail view polling (paused included so a resume flips live). */
const POLLING = new Set([...ACTIVE, 'paused']);

const STATUS_CONFIG: Record<string, { label: string; bg: string; border: string; text: string; dot: string }> = {
  queued: { label: 'Queued', bg: 'bg-zinc-100 dark:bg-white/5', border: 'border-zinc-200 dark:border-white/10', text: 'text-zinc-600 dark:text-zinc-400', dot: 'bg-zinc-400' },
  running: { label: 'Running', bg: 'bg-amber-500/15', border: 'border-amber-500/30', text: 'text-amber-500 dark:text-amber-300', dot: 'bg-amber-400' },
  awaiting_approval: { label: 'Awaiting Approval', bg: 'bg-orange-500/15', border: 'border-orange-500/30', text: 'text-orange-500 dark:text-orange-300', dot: 'bg-orange-400' },
  paused: { label: 'Paused', bg: 'bg-violet-500/15', border: 'border-violet-500/30', text: 'text-violet-500 dark:text-violet-300', dot: 'bg-violet-400' },
  succeeded: { label: 'Completed', bg: 'bg-emerald-500/15', border: 'border-emerald-500/30', text: 'text-emerald-500 dark:text-emerald-300', dot: 'bg-emerald-400' },
  failed: { label: 'Failed', bg: 'bg-red-500/15', border: 'border-red-500/30', text: 'text-red-500 dark:text-red-300', dot: 'bg-red-400' },
  cancelled: { label: 'Cancelled', bg: 'bg-zinc-100 dark:bg-white/5', border: 'border-zinc-200 dark:border-white/10', text: 'text-zinc-600 dark:text-zinc-400', dot: 'bg-zinc-500' },
};

const NODE_LABEL: Record<string, string> = {
  plan: 'Making a plan',
  act: 'Researching',
  observe: 'Checking progress',
  self_correct: 'Adjusting approach',
  finalize: 'Writing the result',
  // Supervisor graph
  delegate: 'Delegating to specialists',
  fan_out: 'Specialists researching',
  verify: 'Cross-checking results',
  merge: 'Merging the report',
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
    const active = status ? POLLING.has(status) : false;
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
  const children = detail?.children ?? [];
  const pendingApprovals = detail?.pendingApprovals ?? [];
  const answer =
    run?.status === 'succeeded' && run.result && typeof run.result === 'object'
      ? String((run.result as { answer?: string }).answer ?? '')
      : '';

  const handleDecision = useCallback(
    async (approval: Approval, decision: 'approve' | 'deny') => {
      try {
        await decideApproval(approval.id, decision);
        await load();
      } catch (err) {
        setError(err instanceof Error ? err.message : String(err));
      }
    },
    [load],
  );

  /** Pause/resume this run via the real endpoints (see lib/agents). */
  const handlePauseToggle = useCallback(async () => {
    if (!run) return;
    const resuming = run.status === 'paused';
    try {
      if (resuming) await resumeRun(run.id);
      else await pauseRun(run.id);
      setError(null);
      await load();
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    }
  }, [run, load]);

  /** Cancels this run (and a supervisor's unfinished children). */
  const handleCancel = useCallback(() => {
    if (!run) return;
    RNAlert.alert(
      'Cancel this task?',
      'The run stops at its next step and cannot be resumed afterwards.',
      [
        { text: 'Keep running', style: 'cancel' },
        {
          text: 'Cancel task',
          style: 'destructive',
          onPress: () => {
            void (async () => {
              try {
                await cancelRun(run.id);
                setError(null);
                await load();
              } catch (err) {
                setError(err instanceof Error ? err.message : String(err));
              }
            })();
          },
        },
      ],
    );
  }, [run, load]);

  const statusConfig = STATUS_CONFIG[status ?? 'queued'] ?? STATUS_CONFIG.queued;

  return (
    <View className="flex-1 bg-white dark:bg-[#09090b]">
      <AppHeader
        left={
          <Pressable
            onPress={() => router.back()}
            accessibilityRole="button"
            accessibilityLabel="Back"
            className="px-2 py-1 active:opacity-60"
          >
            <Typography type="body" className="text-zinc-500 dark:text-zinc-400">
              Back
            </Typography>
          </Pressable>
        }
        center={
          <View className={`flex-row items-center gap-1.5 rounded-full border px-3 py-1 ${statusConfig.bg} ${statusConfig.border}`}>
            <View className={`h-1.5 w-1.5 rounded-full ${statusConfig.dot}`} />
            <Text className={`text-xs font-semibold ${statusConfig.text}`}>
              {statusConfig.label}
            </Text>
          </View>
        }
      />

      <ScrollView
        contentContainerStyle={{ padding: 16, paddingBottom: insets.bottom + 32, gap: 16 }}
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
        {/* Error banner (failed actions: pause/resume/cancel/approvals) */}
        {error ? (
          <View className="flex-row items-center gap-2 rounded-2xl border border-red-500/30 bg-red-500/10 px-4 py-3">
            <AlertTriangle size={16} color="#ef4444" />
            <Text className="flex-1 text-xs text-red-500 dark:text-red-300" numberOfLines={4}>
              {error}
            </Text>
            <Pressable
              onPress={() => setError(null)}
              accessibilityRole="button"
              accessibilityLabel="Dismiss error"
              className="px-1 py-1 active:opacity-60"
            >
              <XCircle size={16} color="#ef4444" />
            </Pressable>
          </View>
        ) : null}

        {/* Goal Hero Card */}
        {run ? (
          <View className="rounded-3xl border border-zinc-200 dark:border-white/10 bg-zinc-50 dark:bg-[#121215] p-5 shadow-sm gap-3">
            <View className="flex-row items-center gap-3">
              {detail?.agent ? (
                <AgentAvatar avatar={detail.agent.avatar} name={detail.agent.name} size={40} />
              ) : null}
              <View className="flex-1 min-w-0">
                <Text className="text-xs font-semibold uppercase tracking-wider text-zinc-400 dark:text-zinc-500">
                  {detail?.agent?.name ?? 'Autonomous Run'}
                </Text>
                <Text className="text-base font-bold text-zinc-900 dark:text-white leading-6 mt-0.5">
                  {run.goal}
                </Text>
              </View>
            </View>
            <View className="border-t border-zinc-200 dark:border-white/10 pt-2 flex-row items-center justify-between">
              <Text className="text-xs text-zinc-400">
                Started {new Date(run.created_at).toLocaleTimeString([], { hour: 'numeric', minute: '2-digit' })}
              </Text>
              {run.tokens_used > 0 ? (
                <Text className="text-xs text-zinc-500 font-medium">
                  {run.tokens_used} tokens
                </Text>
              ) : null}
            </View>
          </View>
        ) : null}

        {/* Specialists (Supervisor Sub-runs) */}
        {children.length > 0 ? (
          <View className="gap-2">
            <Text className="text-xs font-semibold uppercase tracking-wider text-zinc-400 dark:text-zinc-500 px-1">
              Specialists Researching
            </Text>
            <View className="gap-2">
              {children.map((child) => {
                const childStatus = STATUS_CONFIG[child.status] ?? STATUS_CONFIG.queued;
                return (
                  <Pressable
                    key={child.id}
                    onPress={() => router.push({ pathname: '/run', params: { id: child.id } })}
                    className="flex-row items-center justify-between rounded-2xl border border-zinc-200 dark:border-white/10 bg-zinc-50 dark:bg-[#121215] p-3.5 active:opacity-75"
                  >
                    <View className="flex-row items-center gap-3 flex-1 min-w-0 pr-2">
                      <AgentAvatar
                        avatar={child.agent?.avatar ?? DEFAULT_AGENT_AVATAR}
                        name={child.agent?.name}
                        size={32}
                      />
                      <View className="flex-1 min-w-0">
                        <Text numberOfLines={1} className="text-sm font-semibold text-zinc-900 dark:text-white">
                          {child.agent?.name ?? 'Specialist'}
                        </Text>
                        <Text numberOfLines={1} className="text-xs text-zinc-500 dark:text-zinc-400 mt-0.5">
                          {child.goal}
                        </Text>
                      </View>
                    </View>
                    <View className={`flex-row items-center gap-1 rounded-full border px-2 py-0.5 ${childStatus.bg} ${childStatus.border}`}>
                      <Text className={`text-[10px] font-medium ${childStatus.text}`}>
                        {childStatus.label}
                      </Text>
                      <ChevronRight size={12} color="#71717a" />
                    </View>
                  </Pressable>
                );
              })}
            </View>
          </View>
        ) : null}

        {/* Final Result Card */}
        {answer ? (
          <View className="rounded-3xl border border-emerald-500/20 bg-emerald-500/5 dark:bg-emerald-500/10 p-5 shadow-sm gap-2">
            <View className="flex-row items-center gap-2">
              <CheckCircle2 size={18} color="#10b981" />
              <Text className="text-sm font-bold text-emerald-600 dark:text-emerald-400">
                Final Result
              </Text>
            </View>
            <Text className="text-base text-zinc-900 dark:text-zinc-100 leading-6">
              {answer}
            </Text>
          </View>
        ) : null}

        {/* Pending Approvals */}
        {pendingApprovals.map((approval) => (
          <View
            key={approval.id}
            className="rounded-3xl border border-amber-500/30 bg-amber-500/10 p-5 shadow-sm gap-3"
          >
            <View className="flex-row items-center gap-2">
              <AlertTriangle size={18} color="#f59e0b" />
              <Text className="text-sm font-bold text-amber-500 dark:text-amber-300">
                Approval Required
              </Text>
            </View>
            <Text className="text-sm text-zinc-800 dark:text-zinc-200">
              {`${detail?.agent?.name ?? 'The agent'} wants to execute "${approval.tool_name ?? 'a sensitive tool'}".`}
            </Text>
            {typeof approval.args === 'object' && approval.args !== null ? (
              <View className="rounded-2xl border border-white/10 bg-black/40 p-3">
                <Text className="font-mono text-xs text-zinc-300 leading-5">
                  {JSON.stringify(approval.args, null, 2)}
                </Text>
              </View>
            ) : null}
            <View className="flex-row gap-2.5 pt-1">
              <Button
                size="sm"
                variant="primary"
                className="rounded-full px-5"
                onPress={() => void handleDecision(approval, 'approve')}
              >
                <Button.Label>Approve</Button.Label>
              </Button>
              <Button
                size="sm"
                variant="secondary"
                className="rounded-full px-5"
                onPress={() => void handleDecision(approval, 'deny')}
              >
                <Button.Label>Deny</Button.Label>
              </Button>
            </View>
          </View>
        ))}

        {/* Live Timeline Section */}
        <View className="rounded-3xl border border-zinc-200 dark:border-white/10 bg-zinc-50 dark:bg-[#121215] p-5 shadow-sm gap-3">
          <Text className="text-xs font-semibold uppercase tracking-wider text-zinc-400 dark:text-zinc-500 mb-1">
            Execution Timeline
          </Text>

          {events.length === 0 ? (
            <View className="py-6 items-center justify-center">
              <Spinner size="sm" color="default" />
              <Text className="text-xs text-zinc-500 mt-2">Initializing task plan…</Text>
            </View>
          ) : (
            <View className="gap-2.5">
              {events.map((event: RunEvent) => (
                <EventRow key={event.id} event={event} />
              ))}
            </View>
          )}

          {status && ACTIVE.has(status) ? (
            <View className="flex-row items-center justify-between gap-3 border-t border-zinc-200 dark:border-white/10 pt-3">
              <View className="flex-row items-center gap-2 flex-1">
                <Spinner size="sm" color="default" />
                <Text className="flex-1 text-xs text-zinc-500" numberOfLines={2}>
                  Working in background… you can safely close the app.
                </Text>
              </View>
              <View className="flex-row gap-2">
                <Button
                  size="sm"
                  variant="secondary"
                  onPress={() => void handlePauseToggle()}
                  accessibilityRole="button"
                  accessibilityLabel="Pause task"
                  accessibilityHint="Stops the task at its next step; resume continues from there"
                >
                  <Button.Label>Pause</Button.Label>
                </Button>
                <Button
                  size="sm"
                  variant="ghost"
                  onPress={handleCancel}
                  accessibilityRole="button"
                  accessibilityLabel="Cancel task"
                  accessibilityHint="Ends this task permanently"
                >
                  <Button.Label>Cancel</Button.Label>
                </Button>
              </View>
            </View>
          ) : status === 'paused' ? (
            <View className="flex-row items-center justify-between gap-3 border-t border-zinc-200 dark:border-white/10 pt-3">
              <View className="flex-1">
                <Text className="text-xs font-semibold text-violet-500 dark:text-violet-300">
                  Paused
                </Text>
                <Text className="mt-0.5 text-xs text-zinc-500">
                  Stopped at its last step — resume continues from there.
                </Text>
              </View>
              <View className="flex-row gap-2">
                <Button
                  size="sm"
                  variant="secondary"
                  onPress={() => void handlePauseToggle()}
                  accessibilityRole="button"
                  accessibilityLabel="Resume task"
                  accessibilityHint="Continues the task from where it stopped"
                >
                  <Button.Label>Resume</Button.Label>
                </Button>
                <Button
                  size="sm"
                  variant="ghost"
                  onPress={handleCancel}
                  accessibilityRole="button"
                  accessibilityLabel="Cancel task"
                  accessibilityHint="Ends this task permanently"
                >
                  <Button.Label>Cancel</Button.Label>
                </Button>
              </View>
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
      <View className="flex-row items-center gap-2.5">
        <View className="h-2 w-2 rounded-full bg-purple-500" />
        <Text className="text-sm font-semibold text-zinc-900 dark:text-white">
          {label}
        </Text>
      </View>
    );
  }

  if (event.type === 'node_end') {
    if (payload.failed) {
      return (
        <View className="ml-4 flex-row items-center gap-1.5">
          <XCircle size={12} color="#ef4444" />
          <Text className="text-xs text-red-400">
            Step failed, adjusting strategy…
          </Text>
        </View>
      );
    }
    return (
      <View className="ml-4 flex-row items-center gap-1.5">
        <Check size={12} color="#10b981" />
        <Text className="text-xs text-zinc-500 dark:text-zinc-400">
          {String(payload.note ?? payload.summary ?? payload.action ?? 'Step completed')}
        </Text>
      </View>
    );
  }

  if (event.type === 'tool_call') {
    return (
      <View className="ml-4 flex-row items-center gap-2 rounded-full border border-zinc-200 dark:border-white/10 bg-zinc-100 dark:bg-white/5 px-3 py-1 self-start">
        <Wrench size={11} color="#38bdf8" />
        <Text className="text-xs text-zinc-700 dark:text-zinc-300">
          {`Calling ${String(payload.tool ?? 'tool')}`}
        </Text>
      </View>
    );
  }

  if (event.type === 'tool_result') {
    return (
      <View className="ml-6 flex-row items-center gap-1.5">
        <Text className="text-xs text-zinc-400">
          {`↳ Result received`}
        </Text>
      </View>
    );
  }

  return null;
}
