import type { AgentGroup, StoredMessage, Thread } from '@agent/shared';
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import {
  KeyboardAvoidingView,
  Platform,
  Pressable,
  ScrollView,
  Text,
  View,
  type ScrollViewInstance,
} from 'react-native';
import { Spinner } from 'heroui-native';
import { useFocusEffect, useLocalSearchParams, useRouter } from 'expo-router';
import { Pencil, Users } from 'lucide-react-native';

import { AppHeader } from '@/components/app-header';
import { Composer } from '@/components/composer';
import { GroupMessageBubble } from '@/components/group-message-bubble';
import { fetchRun } from '@/lib/agents';
import { createGroupThread, fetchGroup, startGroupRun } from '@/lib/groups';
import { fetchThread } from '@/lib/models';

const ACTIVE_RUN = new Set(['queued', 'running', 'awaiting_approval', 'paused']);

/** A group chat. Member turns arrive through the durable run pipeline. */
export default function GroupChatScreen() {
  const router = useRouter();
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
  const scrollRef = useRef<ScrollViewInstance>(null);

  const loadConversation = useCallback(async () => {
    if (!id) return;
    try {
      const loadedGroup = await fetchGroup(id);
      setGroup(loadedGroup);

      // A deep link may name the conversation explicitly; otherwise the
      // group's own latest thread is used.
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

      // Recover the live parent run: the app may have been killed while the
      // group was still working. The server knows which parent run is in
      // flight, so the "running" pill comes back on mount.
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

  // Poll the durable thread and the active run. A group has no streaming
  // response; member turns become persisted messages as they complete.
  useEffect(() => {
    if (!thread?.id) return;
    let active = true;

    const poll = async () => {
      try {
        const detail = await fetchThread(thread.id);
        if (active && detail) setMessages(detail.messages);
        if (active && activeRunId) {
          const run = await fetchRun(activeRunId);
          if (active) setRunStatus(run.run.status);
        }
      } catch {
        // A transient poll failure should not replace the visible conversation.
      }
    };

    const timer = setInterval(() => void poll(), 2_000);
    void poll();
    return () => {
      active = false;
      clearInterval(timer);
    };
  }, [activeRunId, thread?.id]);

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
        setError(err instanceof Error ? err.message : String(err));
      })
      .finally(() => setSending(false));
  }, [group, input, thread]);

  const runActive = Boolean(activeRunId && runStatus && ACTIVE_RUN.has(runStatus));

  if (loading) {
    return (
      <View className="flex-1 items-center justify-center bg-white dark:bg-[#09090b]">
        <Spinner size="lg" color="default" />
      </View>
    );
  }

  return (
    <KeyboardAvoidingView
      className="flex-1 bg-white dark:bg-[#09090b]"
      behavior={Platform.OS === 'ios' ? 'padding' : undefined}
      keyboardVerticalOffset={8}
    >
      <AppHeader
        left={
          <Pressable
            onPress={() => router.back()}
            accessibilityRole="button"
            accessibilityLabel="Go back"
            className="px-2 py-1 active:opacity-60"
          >
            <Text className="text-base text-zinc-500 dark:text-zinc-400">Back</Text>
          </Pressable>
        }
        center={
          <View className="items-center">
            <Text numberOfLines={1} className="text-sm font-semibold text-zinc-900 dark:text-white">
              {group?.name ?? 'Group'}
            </Text>
            {group ? (
              <Text className="text-[10px] capitalize text-zinc-500 dark:text-zinc-400">
                {group.mode} · {group.members.length} members
              </Text>
            ) : null}
          </View>
        }
        right={
          <Pressable
            onPress={() => router.push({ pathname: '/groups/[id]/edit', params: { id } } as never)}
            accessibilityRole="button"
            accessibilityLabel="Edit group"
            className="h-9 w-9 items-center justify-center rounded-full border border-zinc-200 dark:border-white/10 active:opacity-70"
          >
            <Pencil size={16} color="#71717a" />
          </Pressable>
        }
      />

      <ScrollView
        ref={scrollRef}
        contentContainerStyle={{ padding: 16, paddingBottom: 18, gap: 2 }}
        keyboardShouldPersistTaps="handled"
      >
        {error ? (
          <View className="mb-3 rounded-2xl border border-red-500/20 bg-red-500/10 px-3.5 py-2.5">
            <Text className="text-xs text-red-500 dark:text-red-300">{error}</Text>
          </View>
        ) : null}

        {messages.length === 0 ? (
          <View className="items-center gap-3 px-5 py-14">
            <View className="h-14 w-14 items-center justify-center rounded-3xl border border-zinc-200 dark:border-white/10 bg-zinc-50 dark:bg-white/5">
              <Users size={24} color="#71717a" />
            </View>
            <Text className="text-base font-semibold text-zinc-900 dark:text-white">
              Start the group conversation
            </Text>
            <Text className="max-w-xs text-center text-xs leading-4 text-zinc-500 dark:text-zinc-400">
              Mention a member to route the first turn, or let the lead decide who starts.
            </Text>
          </View>
        ) : (
          messages.map((message) => (
            <GroupMessageBubble
              key={message.id}
              message={message}
              members={group?.members ?? []}
              onOpenRun={(runId) => router.push({ pathname: '/run', params: { id: runId } } as never)}
            />
          ))
        )}

        {activeRunId && runActive ? (
          <Pressable
            onPress={() => router.push({ pathname: '/run', params: { id: activeRunId } } as never)}
            accessibilityRole="button"
            accessibilityLabel="View active group run"
            className="ml-9 mt-2 flex-row items-center gap-2 self-start rounded-full border border-amber-500/25 bg-amber-500/10 px-3 py-1.5 active:opacity-75"
          >
            <Spinner size="sm" color="default" />
            <Text className="text-[10px] font-semibold uppercase text-amber-500 dark:text-amber-300">
              {runStatus?.replace('_', ' ')} · View run
            </Text>
          </Pressable>
        ) : null}
      </ScrollView>

      <View className="px-3 pb-3">
        <Composer
          value={input}
          onChangeText={setInput}
          onSend={handleSend}
          onAttachImage={() => undefined}
          onAttachDocument={() => undefined}
          attachments={[]}
          onRemoveAttachment={() => undefined}
          isStreaming={sending || runActive}
          disabled={!thread || !group}
          mentionMembers={mentionMembers}
          showAttachments={false}
          placeholder="Message the group… use @name to route a turn"
        />
      </View>
    </KeyboardAvoidingView>
  );
}
