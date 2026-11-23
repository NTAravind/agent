import { useCallback, useEffect, useRef, useState } from 'react';
import { Spinner } from 'heroui-native';
import { Alert as RNAlert, Pressable, RefreshControl, ScrollView, Text, View } from 'react-native';
import { useFocusEffect, useLocalSearchParams, useRouter } from 'expo-router';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { AlertTriangle, Check, CheckCircle2, ChevronLeft, ChevronRight, Wrench, XCircle } from 'lucide-react-native';
import { DEFAULT_AGENT_AVATAR, type Approval, type RunEvent } from '@agent/shared';

import { AppHeader } from '@/components/app-header';
import { AgentAvatar } from '@/components/agent-avatar';
import {
  GroupedCard,
  HairlineDivider,
  PillButton,
  RoundButton,
  SectionLabel,
} from '@/components/design-system';
import { MarkdownText } from '@/components/markdown-text';
import { colors, radius, shadow, space } from '@/theme';
import { cancelRun, decideApproval, fetchRun, pauseRun, resumeRun, type RunDetail } from '@/lib/agents';

const ACTIVE = new Set(['queued', 'running', 'awaiting_approval']);
/** Statuses that keep the detail view polling (paused included so a resume flips live). */
const POLLING = new Set([...ACTIVE, 'paused']);

const STATUS_CONFIG: Record<string, { label: string; text: string; dot: string }> = {
  queued: { label: 'Queued', text: colors.textSecondary, dot: colors.textTertiary },
  running: { label: 'Running', text: colors.textPrimary, dot: colors.primary },
  awaiting_approval: { label: 'Awaiting Approval', text: colors.recording, dot: colors.recording },
  paused: { label: 'Paused', text: colors.textSecondary, dot: colors.textTertiary },
  succeeded: { label: 'Completed', text: colors.success, dot: colors.success },
  failed: { label: 'Failed', text: colors.recording, dot: colors.recording },
  cancelled: { label: 'Cancelled', text: colors.textTertiary, dot: colors.textTertiary },
};

const NODE_LABEL: Record<string, string> = {
  plan: 'Making a plan',
  act: 'Researching',
  observe: 'Checking progress',
  self_correct: 'Adjusting approach',
  finalize: 'Writing the result',
  // Group graph
  route: 'Choosing the next member',
  agent_turn: 'A member is working',
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
  const isGroupRun = Boolean(run?.group_id);
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

  const handleBack = useCallback(() => {
    if (router.canGoBack()) {
      router.back();
    } else {
      router.replace('/agents' as never);
    }
  }, [router]);

  const statusConfig = STATUS_CONFIG[status ?? 'queued'] ?? STATUS_CONFIG.queued;

  return (
    <View style={{ flex: 1, backgroundColor: colors.background }}>
      <AppHeader
        left={
          <RoundButton
            icon={ChevronLeft}
            onPress={handleBack}
            accessibilityLabel="Back"
          />
        }
        center={
          <View
            style={[
              {
                flexDirection: 'row',
                alignItems: 'center',
                gap: 6,
                borderRadius: radius.pill,
                backgroundColor: colors.surfaceRaised,
                paddingHorizontal: 12,
                paddingVertical: 6,
              },
              shadow.floating,
            ]}
          >
            <View style={{ width: 6, height: 6, borderRadius: 3, backgroundColor: statusConfig.dot }} />
            <Text style={{ fontSize: 13, fontWeight: '600', color: statusConfig.text }}>
              {statusConfig.label}
            </Text>
          </View>
        }
      />

      <ScrollView
        contentContainerStyle={{ padding: space.lg, paddingBottom: insets.bottom + 32, gap: space.lg }}
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
      >
        {/* Error banner (failed actions: pause/resume/cancel/approvals) */}
        {error ? (
          <View style={{ flexDirection: 'row', alignItems: 'center', gap: space.sm, backgroundColor: colors.recordingBg, borderRadius: radius.card, padding: space.md }}>
            <AlertTriangle size={16} color={colors.recording} />
            <Text style={{ flex: 1, fontSize: 13, color: colors.recording }} numberOfLines={4}>
              {error}
            </Text>
            <Pressable
              onPress={() => setError(null)}
              accessibilityRole="button"
              accessibilityLabel="Dismiss error"
              style={{ padding: 4 }}
            >
              <XCircle size={16} color={colors.recording} />
            </Pressable>
          </View>
        ) : null}

        {/* Goal Hero Card */}
        {run ? (
          <GroupedCard style={{ padding: space.lg, gap: space.md }}>
            <View style={{ flexDirection: 'row', alignItems: 'center', gap: space.md }}>
              {detail?.agent ? (
                <AgentAvatar avatar={detail.agent.avatar} name={detail.agent.name} size={40} />
              ) : null}
              <View style={{ flex: 1, minWidth: 0 }}>
                <Text style={{ fontSize: 12, fontWeight: '600', color: colors.textSecondary, textTransform: 'uppercase', letterSpacing: 0.5 }}>
                  {detail?.agent?.name ?? (isGroupRun ? 'Agent Group' : 'Autonomous Run')}
                </Text>
                <Text style={{ fontSize: 17, fontWeight: '600', color: colors.textPrimary, lineHeight: 22, marginTop: 2 }}>
                  {run.goal}
                </Text>
              </View>
            </View>
            <View style={{ borderTopWidth: 1, borderTopColor: colors.divider, paddingTop: space.sm, flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between' }}>
              <Text style={{ fontSize: 13, color: colors.textSecondary }}>
                Started {new Date(run.created_at).toLocaleTimeString([], { hour: 'numeric', minute: '2-digit' })}
              </Text>
              {run.tokens_used > 0 ? (
                <Text style={{ fontSize: 13, fontWeight: '500', color: colors.textSecondary }}>
                  {run.tokens_used} tokens
                </Text>
              ) : null}
            </View>
          </GroupedCard>
        ) : null}

        {/* Specialists (Supervisor Sub-runs) */}
        {children.length > 0 ? (
          <View style={{ gap: space.xs }}>
            <SectionLabel text={isGroupRun ? 'Member Turns' : 'Specialists Researching'} />
            <GroupedCard>
              {children.map((child, index) => {
                const childStatus = STATUS_CONFIG[child.status] ?? STATUS_CONFIG.queued;
                return (
                  <View key={child.id}>
                    {index > 0 && <HairlineDivider inset={56} />}
                    <Pressable
                      onPress={() => router.push({ pathname: '/run', params: { id: child.id } })}
                      style={{
                        flexDirection: 'row',
                        alignItems: 'center',
                        justifyContent: 'space-between',
                        paddingHorizontal: space.lg,
                        paddingVertical: space.md,
                      }}
                    >
                      <View style={{ flexDirection: 'row', alignItems: 'center', gap: space.md, flex: 1, minWidth: 0, paddingRight: space.sm }}>
                        <AgentAvatar
                          avatar={child.agent?.avatar ?? DEFAULT_AGENT_AVATAR}
                          name={child.agent?.name}
                          size={32}
                        />
                        <View style={{ flex: 1, minWidth: 0 }}>
                          <Text numberOfLines={1} style={{ fontSize: 15, fontWeight: '600', color: colors.textPrimary }}>
                            {child.agent?.name ?? 'Specialist'}
                          </Text>
                          <Text numberOfLines={1} style={{ fontSize: 13, color: colors.textSecondary, marginTop: 2 }}>
                            {child.goal}
                          </Text>
                        </View>
                      </View>
                      <View style={{ flexDirection: 'row', alignItems: 'center', gap: 4, borderRadius: radius.pill, backgroundColor: colors.surfaceRaised, paddingHorizontal: 8, paddingVertical: 4 }}>
                        <View style={{ width: 6, height: 6, borderRadius: 3, backgroundColor: childStatus.dot }} />
                        <Text style={{ fontSize: 11, fontWeight: '500', color: childStatus.text }}>
                          {childStatus.label}
                        </Text>
                        <ChevronRight size={12} color={colors.textSecondary} />
                      </View>
                    </Pressable>
                  </View>
                );
              })}
            </GroupedCard>
          </View>
        ) : null}

        {/* Final Result Card */}
        {answer ? (
          <GroupedCard style={{ padding: space.lg, gap: space.sm }}>
            <View style={{ flexDirection: 'row', alignItems: 'center', gap: space.sm }}>
              <CheckCircle2 size={18} color={colors.success} />
              <Text style={{ fontSize: 15, fontWeight: '600', color: colors.textPrimary }}>
                Final Result
              </Text>
            </View>
            <MarkdownText markdown={answer} fontSize={16} />
          </GroupedCard>
        ) : null}

        {/* Pending Approvals */}
        {pendingApprovals.map((approval) => (
          <View
            key={approval.id}
            style={{
              backgroundColor: colors.surface,
              borderRadius: radius.card,
              padding: space.lg,
              gap: space.md,
            }}
          >
            <View style={{ flexDirection: 'row', alignItems: 'center', gap: space.sm }}>
              <AlertTriangle size={18} color={colors.recording} />
              <Text style={{ fontSize: 15, fontWeight: '600', color: colors.textPrimary }}>
                Approval Required
              </Text>
            </View>
            <Text style={{ fontSize: 15, lineHeight: 20, color: colors.textPrimary }}>
              {`${detail?.agent?.name ?? (isGroupRun ? 'A group member' : 'The agent')} wants to execute "${approval.tool_name ?? 'a sensitive tool'}".`}
            </Text>
            {typeof approval.args === 'object' && approval.args !== null ? (
              <View style={{ backgroundColor: colors.surfaceRaised, borderRadius: radius.tile, padding: space.md }}>
                <Text style={{ fontFamily: 'monospace', fontSize: 12, color: colors.textPrimary, lineHeight: 18 }}>
                  {JSON.stringify(approval.args, null, 2)}
                </Text>
              </View>
            ) : null}
            <View style={{ flexDirection: 'row', gap: space.sm, paddingTop: space.xs }}>
              <PillButton
                label="Approve"
                onPress={() => void handleDecision(approval, 'approve')}
                variant="primary"
              />
              <PillButton
                label="Deny"
                onPress={() => void handleDecision(approval, 'deny')}
                variant="secondary"
              />
            </View>
          </View>
        ))}

        {/* Live Timeline Section */}
        <View style={{ gap: space.xs }}>
          <SectionLabel text="Execution Timeline" />
          <GroupedCard style={{ padding: space.lg, gap: space.md }}>
            {events.length === 0 ? (
              <View style={{ paddingVertical: space.xl, alignItems: 'center', justifyContent: 'center' }}>
                <Spinner size="sm" color="default" />
                <Text style={{ fontSize: 13, color: colors.textSecondary, marginTop: space.sm }}>Initializing task plan…</Text>
              </View>
            ) : (
              <View style={{ gap: space.md }}>
                {events.map((event: RunEvent) => (
                  <EventRow key={event.id} event={event} />
                ))}
              </View>
            )}

            {status && ACTIVE.has(status) ? (
              <View style={{ flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', gap: space.md, borderTopWidth: 1, borderTopColor: colors.divider, paddingTop: space.md }}>
                <View style={{ flexDirection: 'row', alignItems: 'center', gap: space.sm, flex: 1 }}>
                  <Spinner size="sm" color="default" />
                  <Text style={{ flex: 1, fontSize: 13, color: colors.textSecondary }} numberOfLines={2}>
                    Working in background… you can safely close the app.
                  </Text>
                </View>
                <View style={{ flexDirection: 'row', gap: space.xs }}>
                  <PillButton
                    label="Pause"
                    onPress={() => void handlePauseToggle()}
                    variant="secondary"
                  />
                  <PillButton
                    label="Cancel"
                    onPress={handleCancel}
                    variant="secondary"
                  />
                </View>
              </View>
            ) : status === 'paused' ? (
              <View style={{ flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', gap: space.md, borderTopWidth: 1, borderTopColor: colors.divider, paddingTop: space.md }}>
                <View style={{ flex: 1 }}>
                  <Text style={{ fontSize: 13, fontWeight: '600', color: colors.textPrimary }}>
                    Paused
                  </Text>
                  <Text style={{ marginTop: 2, fontSize: 12, color: colors.textSecondary }}>
                    Stopped at its last step — resume continues from there.
                  </Text>
                </View>
                <View style={{ flexDirection: 'row', gap: space.xs }}>
                  <PillButton
                    label="Resume"
                    onPress={() => void handlePauseToggle()}
                    variant="primary"
                  />
                  <PillButton
                    label="Cancel"
                    onPress={handleCancel}
                    variant="secondary"
                  />
                </View>
              </View>
            ) : null}
          </GroupedCard>
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
      <View style={{ flexDirection: 'row', alignItems: 'center', gap: space.sm }}>
        <View style={{ width: 8, height: 8, borderRadius: 4, backgroundColor: colors.primary }} />
        <Text style={{ fontSize: 15, fontWeight: '600', color: colors.textPrimary }}>
          {label}
        </Text>
      </View>
    );
  }

  if (event.type === 'node_end') {
    if (payload.failed) {
      return (
        <View style={{ marginLeft: space.lg, flexDirection: 'row', alignItems: 'center', gap: 6 }}>
          <XCircle size={13} color={colors.recording} />
          <Text style={{ fontSize: 13, color: colors.recording }}>
            Step failed, adjusting strategy…
          </Text>
        </View>
      );
    }
    return (
      <View style={{ marginLeft: space.lg, flexDirection: 'row', alignItems: 'center', gap: 6 }}>
        <Check size={13} color={colors.success} />
        <Text style={{ fontSize: 13, color: colors.textSecondary }}>
          {String(payload.note ?? payload.summary ?? payload.action ?? 'Step completed')}
        </Text>
      </View>
    );
  }

  if (event.type === 'tool_call') {
    return (
      <View style={{ marginLeft: space.lg, flexDirection: 'row', alignItems: 'center', gap: space.xs, borderRadius: radius.pill, backgroundColor: colors.surfaceRaised, paddingHorizontal: 10, paddingVertical: 4, alignSelf: 'flex-start' }}>
        <Wrench size={12} color={colors.textSecondary} />
        <Text style={{ fontSize: 12, color: colors.textPrimary, fontWeight: '500' }}>
          {`Calling ${String(payload.tool ?? 'tool')}`}
        </Text>
      </View>
    );
  }

  if (event.type === 'tool_result') {
    return (
      <View style={{ marginLeft: space.xl, flexDirection: 'row', alignItems: 'center', gap: 6 }}>
        <Text style={{ fontSize: 12, color: colors.textTertiary }}>
          {`↳ Result received`}
        </Text>
      </View>
    );
  }

  return null;
}
