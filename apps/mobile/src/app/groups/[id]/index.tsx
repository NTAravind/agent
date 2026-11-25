import type { AgentGroup, StoredMessage, Thread } from '@agent/shared';
import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import {
  FlatList,
  KeyboardAvoidingView,
  Modal,
  Platform,
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  View,
} from 'react-native';
import { Spinner } from 'heroui-native';
import { useFocusEffect, useLocalSearchParams, useRouter } from 'expo-router';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import {
  ChevronLeft,
  ChevronRight,
  MoreHorizontal,
  Pencil,
  Plus,
} from 'lucide-react-native';
import { SymbolIcon } from '@/components/symbol-icon';

import { AgentAvatar, ClusterAvatar } from '@/components/agent-avatar';
import { AppHeader, useHeaderInset } from '@/components/app-header';
import { Composer } from '@/components/composer';
import {
  GroupedCard,
  HairlineDivider,
  InlineError,
  RoundButton,
  TextAction,
} from '@/components/design-system';
import { GroupMessageBubble } from '@/components/group-message-bubble';
import { reportAppError } from '@/components/error-dialog-provider';
import { colors, radius, shadow, space } from '@/theme';
import { fetchRun, pauseRun } from '@/lib/agents';
import { createGroupThread, fetchGroup, startGroupRun } from '@/lib/groups';
import { fetchThread } from '@/lib/models';
import { useFocusedPoll } from '@/lib/use-focused-poll';

const ACTIVE_RUN = new Set(['queued', 'running', 'awaiting_approval', 'paused']);

export default function GroupChatScreen() {
  const router = useRouter();
  const insets = useSafeAreaInsets();
  const headerInset = useHeaderInset();
  const params = useLocalSearchParams<{ id: string; threadId?: string }>();
  const id = typeof params.id === 'string' ? params.id : '';
  const requestedThreadId = typeof params.threadId === 'string' ? params.threadId : '';

  const [group, setGroup] = useState<AgentGroup | null>(null);
  const [thread, setThread] = useState<Thread | null>(null);
  const [messages, setMessages] = useState<StoredMessage[]>([]);
  const [activeRunId, setActiveRunId] = useState<string | null>(null);
  const [runStatus, setRunStatus] = useState<string | null>(null);
  const [input, setInput] = useState('');
  const [loading, setLoading] = useState(true);
  const [sending, setSending] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [detailsOpen, setDetailsOpen] = useState(false);
  const scrollRef = useRef<FlatList<StoredMessage>>(null);

  const handleBack = useCallback(() => {
    if (router.canGoBack()) {
      router.back();
    } else {
      router.replace('/agents' as never);
    }
  }, [router]);

  const loadConversation = useCallback(async () => {
    if (!id) return;
    try {
      const loadedGroup = await fetchGroup(id);
      setGroup(loadedGroup);

      const preferredThreadId = requestedThreadId || loadedGroup.threadId;
      const existingDetail = preferredThreadId
        ? await fetchThread(preferredThreadId)
        : null;
      const loadedThread = existingDetail?.thread ?? (await createGroupThread(id, loadedGroup.name));
      setThread(loadedThread);
      setGroup({ ...loadedGroup, threadId: loadedThread.id });

      const detail = existingDetail ?? (await fetchThread(loadedThread.id));
      if (detail) setMessages(detail.messages);
      setError(null);

      setActiveRunId(loadedGroup.activeParentRunId ?? null);
      setRunStatus(loadedGroup.activeParentRunStatus ?? null);
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setLoading(false);
    }
  }, [id, requestedThreadId]);

  useFocusEffect(
    useCallback(() => {
      void loadConversation();
    }, [loadConversation]),
  );

  // 2s message/run poll — focus-aware (nothing runs while this screen is
  // covered) and never overlapping (a slow fetch skips the next tick instead
  // of racing it), so stale responses can't overwrite newer ones.
  const threadId = thread?.id;
  const pollThread = useCallback(async () => {
    if (!threadId) return;
    try {
      const detail = await fetchThread(threadId);
      if (detail) setMessages(detail.messages);
      if (activeRunId) {
        const run = await fetchRun(activeRunId);
        setRunStatus(run.run.status);
      }
    } catch {
      // Ignored
    }
  }, [threadId, activeRunId]);

  useFocusedPoll(pollThread, 2_000, Boolean(threadId));

  useEffect(() => {
    const timer = setTimeout(() => scrollRef.current?.scrollToEnd({ animated: true }), 80);
    return () => clearTimeout(timer);
  }, [messages.length]);

  const mentionMembers = useMemo(
    () => group?.members.map((member) => member.agent) ?? [],
    [group],
  );

  const handleSend = useCallback(() => {
    const goal = input.trim();
    if (!goal || !thread || !group) return;
    setSending(true);
    setInput('');
    void startGroupRun({
      groupId: group.id,
      threadId: thread.id,
      goal,
    })
      .then((response) => {
        setActiveRunId(response.runId);
        setRunStatus(response.status);
        return fetchThread(thread.id);
      })
      .then((detail) => {
        if (detail) setMessages(detail.messages);
        setError(null);
      })
      .catch((err: unknown) => {
        setInput(goal);
        reportAppError(err, { title: 'Could not send group message' });
      })
      .finally(() => setSending(false));
  }, [group, input, thread]);

  const runActive = Boolean(activeRunId && runStatus && ACTIVE_RUN.has(runStatus));
  const isTaskRunning = Boolean(sending || (activeRunId && runStatus && runStatus !== 'paused' && ACTIVE_RUN.has(runStatus)));

  const handlePauseGroupRun = useCallback(async () => {
    if (activeRunId && runStatus !== 'paused') {
      try {
        await pauseRun(activeRunId);
        setRunStatus('paused');
      } catch (err) {
        reportAppError(err, { title: 'Could not pause group task' });
      }
    }
  }, [activeRunId, runStatus]);

  if (loading) {
    return (
      <View style={[styles.screen, styles.center]}>
        <Spinner size="lg" color="default" />
      </View>
    );
  }

  return (
    <KeyboardAvoidingView
      style={styles.screen}
      behavior={Platform.OS === 'ios' ? 'padding' : undefined}
      keyboardVerticalOffset={8}
    >
      {/* 6.1 Floating Header */}
      <AppHeader
        left={
          <RoundButton
            icon={ChevronLeft}
            onPress={handleBack}
            accessibilityLabel="Go back"
          />
        }
        center={
          <Pressable
            onPress={() => setDetailsOpen(true)}
            accessibilityRole="button"
            accessibilityLabel="Open group details"
            style={({ pressed }) => [
              styles.titlePill,
              shadow.floating,
              { opacity: pressed ? 0.6 : 1 },
            ]}
          >
            <ClusterAvatar size={28} members={group?.members ?? []} />
            <Text numberOfLines={1} style={styles.titlePillText}>
              {group?.name ?? 'Group'}
            </Text>
          </Pressable>
        }
        right={
          <RoundButton
            icon={MoreHorizontal}
            onPress={() => setDetailsOpen(true)}
            accessibilityLabel="Group settings"
          />
        }
      />

      <FlatList
        ref={scrollRef}
        data={messages}
        keyExtractor={(message) => message.id}
        renderItem={({ item: message }) => (
          <GroupMessageBubble
            message={message}
            members={group?.members ?? []}
            onOpenRun={(runId) => router.push({ pathname: '/run', params: { id: runId } } as never)}
          />
        )}
        ListHeaderComponent={
          error ? (
            <InlineError
              message={error}
              onRetry={() => void loadConversation()}
              style={styles.headerError}
            />
          ) : undefined
        }
        ListEmptyComponent={
          <View style={styles.emptyContainer}>
            <View style={styles.emptyAvatarBox}>
              <ClusterAvatar size={56} members={group?.members ?? []} />
            </View>
            <Text style={styles.emptyTitle}>Start the group conversation</Text>
            <Text style={styles.emptySubtitle}>
              Mention a member to route the first turn, or let the lead decide who starts.
            </Text>
          </View>
        }
        ListFooterComponent={
          activeRunId && runActive ? (
            <Pressable
              onPress={() => router.push({ pathname: '/run', params: { id: activeRunId } } as never)}
              accessibilityRole="button"
              accessibilityLabel="View active group run"
              style={styles.runBadge}
            >
              <Spinner size="sm" color="default" />
              <Text style={styles.runBadgeText}>
                {runStatus?.replace('_', ' ')} · View run
              </Text>
            </Pressable>
          ) : undefined
        }
        contentContainerStyle={{
          paddingHorizontal: space.lg,
          paddingTop: headerInset,
          paddingBottom: 24,
          gap: space.sm,
        }}
        keyboardShouldPersistTaps="handled"
      />

      {/* Composer */}
      <View style={{ paddingHorizontal: space.lg, paddingBottom: space.md }}>
        <Composer
          value={input}
          onChangeText={setInput}
          onSend={handleSend}
          onAttachImage={() => undefined}
          onAttachDocument={() => undefined}
          attachments={[]}
          onRemoveAttachment={() => undefined}
          isStreaming={sending || runActive}
          isTaskActive={isTaskRunning}
          onPause={handlePauseGroupRun}
          disabled={!thread || !group}
          mentionMembers={mentionMembers}
          showAttachments={false}
          placeholder="Message group... use @name to route"
        />
      </View>

      {/* Group Detail Modal */}
      <Modal
        visible={detailsOpen}
        animationType="slide"
        presentationStyle="pageSheet"
        onRequestClose={() => setDetailsOpen(false)}
      >
        <View style={[styles.modalScreen, { paddingTop: insets.top + space.md }]}>
          {/* Header */}
          <View style={styles.modalHeader}>
            <RoundButton
              icon={ChevronLeft}
              onPress={() => setDetailsOpen(false)}
              inSheet
              accessibilityLabel="Close"
            />
            <Text style={styles.modalTitle}>Group details</Text>
            <RoundButton
              icon={Pencil}
              onPress={() => {
                setDetailsOpen(false);
                router.push({ pathname: '/groups/[id]/edit', params: { id } } as never);
              }}
              inSheet
              accessibilityLabel="Edit group"
            />
          </View>

          <ScrollView
            contentContainerStyle={{
              paddingHorizontal: space.lg,
              paddingTop: space.md,
              paddingBottom: insets.bottom + space.xxl,
              gap: space.xl,
            }}
          >
            {/* Clustered Avatar */}
            <View style={styles.heroAvatarContainer}>
              <ClusterAvatar size={96} members={group?.members ?? []} />
            </View>

            {/* Group Name Card */}
            <View style={styles.groupNameCard}>
              <Text style={styles.groupNameText}>{group?.name ?? 'Group'}</Text>
              {group?.description ? (
                <Text style={styles.groupDescText}>{group.description}</Text>
              ) : null}
            </View>

            {/* Members Section */}
            <View>
              <Text style={styles.sectionLabel}>Members</Text>
              <GroupedCard>
                {group?.members.map((member, idx) => (
                  <React.Fragment key={member.agentId}>
                    {idx > 0 && <HairlineDivider />}
                    <Pressable
                      onPress={() => {
                        setDetailsOpen(false);
                        router.push({ pathname: '/agents/[id]', params: { id: member.agentId } });
                      }}
                      accessibilityRole="button"
                      accessibilityLabel={`${member.agent.name}`}
                      style={({ pressed }) => [styles.memberRow, { opacity: pressed ? 0.6 : 1 }]}
                    >
                      <View style={styles.memberLeft}>
                        <AgentAvatar
                          avatar={member.agent.avatar}
                          name={member.agent.name}
                          size={32}
                        />
                        <Text style={styles.memberName}>{member.agent.name}</Text>
                      </View>
                      <SymbolIcon icon={ChevronRight} size={17} color={colors.textSecondary} strokeWidth={2} />
                    </Pressable>
                  </React.Fragment>
                ))}
              </GroupedCard>

              {/* Add member action */}
              <View style={{ marginTop: space.sm, paddingHorizontal: space.lg }}>
                <TextAction
                  icon={Plus}
                  label="Add member"
                  onPress={() => {
                    setDetailsOpen(false);
                    router.push({ pathname: '/groups/[id]/edit', params: { id } } as never);
                  }}
                />
              </View>
            </View>
          </ScrollView>
        </View>
      </Modal>
    </KeyboardAvoidingView>
  );
}

const styles = StyleSheet.create({
  screen: {
    flex: 1,
    backgroundColor: colors.background,
  },
  center: {
    alignItems: 'center',
    justifyContent: 'center',
  },
  titlePill: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: space.sm,
    height: 44,
    borderRadius: radius.pill,
    backgroundColor: colors.surface,
    paddingHorizontal: space.md,
  },
  titlePillText: {
    fontSize: 20,
    lineHeight: 26,
    fontWeight: '500',
    color: colors.textPrimary,
    maxWidth: 160,
  },
  headerError: {
    // Keeps the old 8pt gap under the banner (the list gap adds another 8).
    marginBottom: space.sm,
  },
  emptyContainer: {
    alignItems: 'center',
    paddingHorizontal: space.xl,
    paddingVertical: 56,
  },
  emptyAvatarBox: {
    marginBottom: space.md,
  },
  emptyTitle: {
    fontSize: 20,
    lineHeight: 26,
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
  },
  runBadge: {
    alignSelf: 'flex-start',
    flexDirection: 'row',
    alignItems: 'center',
    gap: space.xs,
    backgroundColor: colors.surface,
    borderRadius: radius.pill,
    paddingHorizontal: 12,
    paddingVertical: 6,
    marginTop: space.sm,
  },
  runBadgeText: {
    fontSize: 14,
    fontWeight: '500',
    color: colors.textPrimary,
    textTransform: 'capitalize',
  },
  modalScreen: {
    flex: 1,
    backgroundColor: colors.surfaceRaised,
  },
  modalHeader: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingHorizontal: space.lg,
    paddingBottom: space.md,
  },
  modalTitle: {
    fontSize: 20,
    lineHeight: 26,
    fontWeight: '600',
    color: colors.textPrimary,
  },
  heroAvatarContainer: {
    alignItems: 'center',
    justifyContent: 'center',
    paddingVertical: space.md,
  },
  groupNameCard: {
    alignItems: 'center',
    backgroundColor: colors.surface,
    borderRadius: radius.card,
    paddingVertical: space.lg,
    paddingHorizontal: space.xl,
  },
  groupNameText: {
    fontSize: 24,
    lineHeight: 30,
    fontWeight: '600',
    color: colors.textPrimary,
  },
  groupDescText: {
    fontSize: 17,
    lineHeight: 22,
    fontWeight: '400',
    color: colors.textSecondary,
    marginTop: space.xs,
    textAlign: 'center',
  },
  sectionLabel: {
    fontSize: 15,
    lineHeight: 20,
    fontWeight: '400',
    color: colors.textSecondary,
    marginBottom: space.sm,
    marginHorizontal: space.lg,
  },
  memberRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    minHeight: 56,
  },
  memberLeft: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: space.md,
  },
  memberName: {
    fontSize: 20,
    lineHeight: 26,
    fontWeight: '500',
    color: colors.textPrimary,
  },
});
