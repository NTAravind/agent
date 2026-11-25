import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { useChat } from '@ai-sdk/react';
import * as Crypto from 'expo-crypto';
import type { AgentSummary } from '@agent/shared';
import { Spinner } from 'heroui-native';
import { lastAssistantMessageIsCompleteWithApprovalResponses, type UIMessage } from 'ai';
import {
  Alert as RNAlert,
  FlatList,
  KeyboardAvoidingView,
  Pressable,
  StyleSheet,
  Text,
  View,
  type NativeScrollEvent,
  type NativeSyntheticEvent,
} from 'react-native';
import { useFocusEffect, useLocalSearchParams, useRouter } from 'expo-router';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import {
  Brain,
  CalendarClock,
  ChevronLeft,
  Code,
  FileText,
  Globe,
  Menu,
  Pencil,
  Plus,
  Search,
  SlidersHorizontal,
} from 'lucide-react-native';
import { SymbolIcon } from '@/components/symbol-icon';

import { AppHeader, useHeaderInset } from '@/components/app-header';
import { AgentAvatar } from '@/components/agent-avatar';
import { AgentPicker } from '@/components/agent-picker';
import { Composer } from '@/components/composer';
import { MessageBubble } from '@/components/message-bubble';
import { RoutineListSheet } from '@/components/routine-sheet';
import { ModelPicker } from '@/components/model-picker';
import { RunTaskBubble } from '@/components/run-task-bubble';
import { useErrorDialog } from '@/components/error-dialog-provider';
import { colors, radius, shadow } from '@/theme';
import {
  pickAndUploadDocument,
  pickAndUploadImages,
  takeAndUploadPhoto,
  type PendingAttachment,
} from '@/lib/attachments';
import {
  fetchAgents,
  fetchRun,
  fetchRuns,
  pauseRun,
  startRun,
  type Agent,
  type RunDetail,
  type RunListItem,
} from '@/lib/agents';
import { deviceTimeZone, ResilientChatTransport } from '@/lib/chat-transport';
import {
  fetchEnabledModels,
  fetchThread,
  fetchThreads,
  type ModelOption,
} from '@/lib/models';
import { supabase } from '@/lib/supabase';
import { useKeyboardHeight } from '@/lib/use-keyboard-height';
import { useFocusedPoll } from '@/lib/use-focused-poll';

/** Run statuses that no longer need live updates. */
const FINISHED = new Set(['succeeded', 'failed', 'cancelled']);
/** Run statuses still executing (drive the live timeline polling). */
const LIVE = new Set(['queued', 'running', 'awaiting_approval']);

/** A chat id is generated on the client so the server can create the thread
 *  with it — no round trip is needed to learn the thread id. */
function newChatId(): string {
  return Crypto.randomUUID();
}

function newMessageId(): string {
  return Crypto.randomUUID();
}

const SUGGESTIONS = [
  {
    label: 'DeepSearch',
    prompt: 'Search the web for the latest updates on ',
    icon: Globe,
  },
  {
    label: 'Think & reason',
    prompt: 'Provide a deep, step-by-step reasoning analysis of ',
    icon: Brain,
  },
  {
    label: 'Draft & write',
    prompt: 'Help me draft a concise, professional message about ',
    icon: Pencil,
  },
  {
    label: 'Debug code',
    prompt: 'Help me analyze and fix this issue: ',
    icon: Code,
  },
];

type RawChatRouteParams = {
  threadId?: string | string[];
  agentId?: string | string[];
  prompt?: string | string[];
};

type ChatRouteParams = {
  threadId?: string;
  agentId?: string;
  prompt?: string;
};

type ThreadLoadResult =
  | { kind: 'loaded' }
  | { kind: 'not_found' }
  | { kind: 'group' }
  | { kind: 'ignored' }
  | { kind: 'error' }
  | { kind: 'agent_mismatch'; agentId: string | null };

function firstParam(value: string | string[] | undefined): string | undefined {
  return Array.isArray(value) ? value[0] : value;
}

/**
 * Chat state is intentionally isolated per route context.
 *
 * Expo Router can reuse this screen while its query parameters change (for
 * example, agent A -> agent B). Keying the session by that context remounts
 * the chat instance, so messages, loaded thread state and the "user already
 * typed" guard from one agent can never leak into another.
 */
export default function ChatScreen() {
  const rawParams = useLocalSearchParams<RawChatRouteParams>();
  const params: ChatRouteParams = {
    threadId: firstParam(rawParams.threadId),
    agentId: firstParam(rawParams.agentId),
    prompt: firstParam(rawParams.prompt),
  };
  const conversationKey = JSON.stringify([
    params.threadId ?? null,
    params.agentId ?? null,
    params.prompt ?? null,
  ]);

  return <ChatSession key={conversationKey} params={params} />;
}

function ChatSession({ params }: { params: ChatRouteParams }) {
  const router = useRouter();
  const { showError } = useErrorDialog();
  const insets = useSafeAreaInsets();
  const keyboardHeight = useKeyboardHeight();

  const [models, setModels] = useState<ModelOption[]>([]);
  const [modelId, setModelId] = useState<string | null>(null);
  const [agents, setAgents] = useState<Agent[]>([]);
  const [agentId, setAgentId] = useState<string | null>(null);
  /** Author identity loaded with an existing thread; overrides the picker. */
  const [threadAgent, setThreadAgent] = useState<AgentSummary | null>(null);
  const [threadId, setThreadId] = useState<string>(params.threadId ?? newChatId());
  const [input, setInput] = useState(params.prompt ?? '');
  const [attachments, setAttachments] = useState<PendingAttachment[]>([]);
  const [deepSearchActive, setDeepSearchActive] = useState(false);
  const [thinkActive, setThinkActive] = useState(false);
  /** Task Mode sends through the durable agent-run pipeline instead of /api/chat. */
  const [taskModeActive, setTaskModeActive] = useState(false);
  const [loadingHistory, setLoadingHistory] = useState(
    Boolean(params.threadId) || Boolean(params.agentId),
  );
  /** Most recent still-running run — target of the "View task" button. */
  const [activeRunId, setActiveRunId] = useState<string | null>(null);
  /** Runs owned by the context agent — surfaced inline as task bubbles. */
  const [agentRuns, setAgentRuns] = useState<RunListItem[]>([]);
  /** Task runs launched from this free-chat conversation. */
  const [taskRunIds, setTaskRunIds] = useState<string[]>([]);
  /** Live event detail for the primary active run (drives the step line). */
  const [activeRunDetail, setActiveRunDetail] = useState<RunDetail | null>(null);
  /** Set once the user types/sends — blocks thread resumption from clobbering. */
  const touchedRef = useRef(false);
  /** Prevents a request from an unmounted agent session changing the new one. */
  const mountedRef = useRef(true);
  /** The routine sheet (clock icon in the agent chat header). */
  const [routineSheetOpen, setRoutineSheetOpen] = useState(false);
  /** Mirror of the `threadId` state for async comparisons. */
  const threadIdRef = useRef(threadId);
  /**
   * History stashed while the `useChat` id swaps (agent thread resumption);
   * applied by the effect below once the new Chat instance exists.
   */
  const pendingMessagesRef = useRef<UIMessage[] | null>(null);
  /**
   * Idempotency key of the Task Mode submission that is in flight (or that
   * failed). A retry of the same text reuses it, so the server returns the
   * run it already created instead of starting a second one.
   */
  const taskSubmissionRef = useRef<{ text: string; key: string } | null>(null);
  const reportedRunFailuresRef = useRef<Set<string>>(new Set());
  const scrollRef = useRef<FlatList<UIMessage>>(null);
  const atBottomRef = useRef(true);

  useEffect(() => {
    threadIdRef.current = threadId;
  }, [threadId]);

  useEffect(() => {
    mountedRef.current = true;
    return () => {
      mountedRef.current = false;
    };
  }, []);

  const transport = useMemo(
    () =>
      new ResilientChatTransport({
        threadId,
        model: modelId,
        getToken: async () => {
          const { data } = await supabase.auth.getSession();
          return data.session?.access_token ?? null;
        },
      }),
    [threadId, modelId],
  );

  const {
    messages,
    setMessages,
    sendMessage,
    regenerate,
    error,
    status,
    stop,
    addToolApprovalResponse,
  } = useChat<UIMessage>({
    transport,
    id: threadId,
    sendAutomaticallyWhen: lastAssistantMessageIsCompleteWithApprovalResponses,
  });

  const isStreaming = status === 'streaming' || status === 'submitted';
  const isEmpty = messages.length === 0;

  // Refresh dashboard-enabled models, the agent list and the active run
  // (for the "View task" button) whenever chat becomes active.
  useFocusEffect(
    useCallback(() => {
      let active = true;
      void Promise.all([fetchEnabledModels(), fetchAgents(), fetchRuns()]).then(
        ([response, list, runs]) => {
          if (!active) return;
          if (response) {
            setModels(response.models);
            setModelId((current) => {
              if (current && response.models.some((model) => model.id === current && model.available)) return current;
              return response.models.find((model) => model.id === response.defaultModel && model.available)?.id
                ?? response.models.find((model) => model.available)?.id
                ?? null;
            });
          }
          setAgents(list);
          // If agentId param is provided, use it; otherwise default to the oldest agent.
          setAgentId((current) => {
            if (params.agentId) return params.agentId;
            return current ?? list[0]?.id ?? null;
          });
          // The most recent run that is still going: assistant messages with
          // tool calls link to it via "View task". When the chat is pinned to
          // an agent, only that agent's runs qualify (agent polling refines
          // this further).
          // TODO(backend): messages are not linked to their run yet — once the
          // API exposes `run_id` on messages, use that instead of this fallback.
          setActiveRunId(
            runs.find(
              (run) =>
                (params.agentId ? run.agent_id === params.agentId : true) &&
                !FINISHED.has(run.status),
            )?.id ?? null,
          );
        },
      );
      return () => {
        active = false;
      };
    }, [params.agentId]),
  );

  /**
   * Loads a thread's history into the composer (deep link + resumption).
   *
   * `useChat` keys its Chat instance on `id` and `setMessages` closes over
   * that instance, so when the thread id swaps (agent resumption) the history
   * is stashed and applied by the effect below — after the new Chat exists.
   */
  const loadThread = useCallback(
    async (id: string, expectedAgentId?: string): Promise<ThreadLoadResult> => {
      try {
        const thread = await fetchThread(id);
        if (!mountedRef.current) return { kind: 'ignored' };
        if (!thread) return { kind: 'not_found' };
        // A group conversation never runs through this chat screen: its
        // messages are group runs. Hand it to the group screen instead of
        // trying to stream it here.
        const groupId = thread.thread.group_id ?? thread.thread.group?.id;
        if (groupId) {
          router.replace({ pathname: '/groups/[id]', params: { id: groupId } } as never);
          return { kind: 'group' };
        }

        // Never display one agent's transcript under another agent. The
        // caller either corrects the route or falls back to a thread whose
        // persisted owner matches the requested agent.
        const actualAgentId = thread.thread.agent_id ?? null;
        if (expectedAgentId && actualAgentId !== expectedAgentId) {
          return { kind: 'agent_mismatch', agentId: actualAgentId };
        }

        if (touchedRef.current) return { kind: 'ignored' };
        const history = thread.messages.map((message) => ({
          id: message.id,
          role: message.role,
          parts: message.parts as UIMessage['parts'],
        })) as UIMessage[];

        if (id === threadIdRef.current) {
          setMessages(history);
        } else {
          pendingMessagesRef.current = history;
          setThreadId(thread.thread.id);
        }
        setModelId((current) => current ?? thread.thread.model ?? null);
        if (thread.thread.agent_id) setAgentId(thread.thread.agent_id);
        setThreadAgent(thread.thread.agent ?? null);
        return { kind: 'loaded' };
      } catch {
        return { kind: 'error' };
      } finally {
        // In the id-swap path loading ends when the stashed history applies.
        if (mountedRef.current && !pendingMessagesRef.current) setLoadingHistory(false);
      }
    },
    [router, setMessages],
  );

  // Apply stashed history once the Chat instance has swapped to the new id.
  useEffect(() => {
    const pending = pendingMessagesRef.current;
    if (!pending) return;
    pendingMessagesRef.current = null;
    setMessages(pending);
    setLoadingHistory(false);
  }, [threadId, setMessages]);

  // Existing thread history (deep link: chat?threadId=…).
  useEffect(() => {
    if (!params.threadId) return;
    void (async () => {
      const result = await loadThread(params.threadId!, params.agentId);
      if (result.kind !== 'agent_mismatch') return;

      // The URL and the persisted thread disagree. Replace the stale agent
      // parameter with the thread's real owner before rendering its history.
      router.replace({
        pathname: '/chat',
        params: {
          threadId: params.threadId,
          ...(result.agentId ? { agentId: result.agentId } : {}),
        },
      } as never);
    })();
  }, [params.agentId, params.threadId, loadThread, router]);

  // Agent contact thread resumption: /chat?agentId=<id> picks up the agent's
  // primary (persistent) thread — agents are chats — and falls back to the
  // agent's most recent thread when there is no primary one yet.
  // When none exists (or the user starts typing first) a fresh thread id is
  // generated client-side and created seamlessly on the first send.
  useEffect(() => {
    if (!params.agentId || params.threadId || touchedRef.current) return;
    // Wait for the agent list so the primary thread is known.
    if (agents.length === 0) return;
    let active = true;
    void (async () => {
      try {
        const threads = await fetchThreads();
        if (!active || touchedRef.current) return;

        const primaryThreadId = agents.find(
          (agent) => agent.id === params.agentId,
        )?.primaryThreadId;
        if (primaryThreadId) {
          const primaryResult = await loadThread(primaryThreadId, params.agentId);
          if (!active || touchedRef.current) return;
          if (primaryResult.kind === 'loaded' || primaryResult.kind === 'group') {
            return;
          }
        }

        // The primary pointer can be stale (or the thread can be unscoped).
        // Only resume a thread whose persisted owner is this agent.
        const latest = threads
          .filter((thread) => thread.agent_id === params.agentId)
          .sort((a, b) => b.updated_at.localeCompare(a.updated_at))[0];
        if (latest) {
          await loadThread(latest.id, params.agentId);
          return;
        }
        setLoadingHistory(false); // no history yet — greet on first send
      } catch {
        setLoadingHistory(false);
      }
    })();
    return () => {
      active = false;
    };
  }, [agents, params.agentId, params.threadId, loadThread]);

  const onScroll = useCallback((event: NativeSyntheticEvent<NativeScrollEvent>) => {
    const { contentOffset, contentSize, layoutMeasurement } = event.nativeEvent;
    const distanceFromBottom = contentSize.height - (contentOffset.y + layoutMeasurement.height);
    atBottomRef.current = distanceFromBottom < 96;
  }, []);

  const scrollToBottom = useCallback(() => {
    if (!atBottomRef.current) return;
    scrollRef.current?.scrollToEnd({ animated: true });
  }, []);

  /** The agent this conversation belongs to (route wins over loaded thread). */
  const contextAgentId = params.agentId ?? agentId;

  /** Refreshes the selected agent's runs for the inline task timeline. */
  const refreshAgentRuns = useCallback(async () => {
    try {
      const all = await fetchRuns();
      if (!mountedRef.current) return;

      const scoped = contextAgentId
        ? all.filter((run) => run.agent_id === contextAgentId)
        : all;

      setAgentRuns((current) => {
        const fetchedIds = new Set(scoped.map((run) => run.id));
        // Keep a just-created optimistic run visible if the list endpoint has
        // not caught up yet. The next poll replaces it with the server row.
        const pending = current.filter(
          (run) =>
            !fetchedIds.has(run.id) &&
            (!contextAgentId || run.agent_id === contextAgentId),
        );
        return [...pending, ...scoped];
      });

      setActiveRunId(
        scoped.find((run) => !FINISHED.has(run.status))?.id ?? null,
      );
    } catch {
      // Transient — the next poll retries.
    }
  }, [contextAgentId]);

  const handleSend = useCallback(
    async (override?: string) => {
      const text = (override ?? input).trim();
      if (!text) return;

      const attachmentPayload = attachments.map((attachment) => ({
        documentId: attachment.documentId,
        mediaType: attachment.mediaType,
        name: attachment.name,
      }));

      touchedRef.current = true;
      setLoadingHistory(false);
      atBottomRef.current = true;
      setInput('');
      // Attachments are handed to ordinary chat below. Task Mode never sends
      // them to the durable endpoint, so both paths clear them consistently.
      setAttachments([]);

      if (taskModeActive) {
        // The durable endpoint returns a run, not a streamed UI message. Add
        // the user turn locally so it is visible while the task is queued.
        const localMessage: UIMessage = {
          id: newMessageId(),
          role: 'user',
          parts: [{ type: 'text', text }],
        };
        setMessages((current) => [...current, localMessage]);

        // A retry of the same submission reuses its idempotency key, so the
        // server answers with the run it already created.
        const submission =
          taskSubmissionRef.current?.text === text
            ? taskSubmissionRef.current
            : { text, key: Crypto.randomUUID() };
        taskSubmissionRef.current = submission;

        try {
          const response = await startRun(
            text,
            modelId,
            contextAgentId,
            threadId,
            deviceTimeZone(),
            submission.key,
          );
          taskSubmissionRef.current = null;

          setTaskRunIds((current) =>
            current.includes(response.runId) ? current : [...current, response.runId],
          );

          // The API resolves (and may create) the ordinary thread. Continue the
          // same conversation if the server chose a different id.
          if (response.threadId && response.threadId !== threadId) {
            setThreadId(response.threadId);
          }

          const optimisticRun: RunListItem = {
            id: response.runId,
            goal: text,
            status: response.status,
            model: modelId,
            tokens_used: 0,
            created_at: new Date().toISOString(),
            finished_at: null,
            agent_id: response.agentId ?? contextAgentId,
            agent: null,
          };
          setAgentRuns((current) => [
            optimisticRun,
            ...current.filter((run) => run.id !== response.runId),
          ]);

          await refreshAgentRuns();
          if (LIVE.has(response.status)) setActiveRunId(response.runId);
        } catch (err) {
          showError(err, { title: 'Task could not start' });
        }
        return;
      }

      // Ordinary chat stays on /api/chat and includes attachment references in
      // the request body.
      const pending = sendMessage({ text }, {
        body: {
          ...(contextAgentId ? { agentId: contextAgentId } : {}),
          deepSearch: deepSearchActive,
          attachments: attachmentPayload,
        },
      });
      await pending;
    },
    [
      attachments,
      contextAgentId,
      deepSearchActive,
      input,
      modelId,
      refreshAgentRuns,
      sendMessage,
      setMessages,
      showError,
      taskModeActive,
      threadId,
    ],
  );

  const toggleDeepSearch = useCallback(() => {
    setDeepSearchActive((prev) => !prev);
  }, []);

  const toggleThink = useCallback(() => {
    setThinkActive((prev) => {
      const next = !prev;
      if (next) {
        const reasoningModel = models.find(
          (m) => m.available && m.capabilities.reasoning,
        );
        if (reasoningModel) {
          setModelId(reasoningModel.id);
        }
      }
      return next;
    });
  }, [models]);

  const toggleTaskMode = useCallback(() => {
    setTaskModeActive((prev) => !prev);
  }, []);

  const modelLabel = useMemo(() => {
    if (!modelId) return null;
    return models.find((model) => model.id === modelId)?.label ?? modelId;
  }, [modelId, models]);

  /** Author identity for assistant messages: the loaded thread's agent, else the picker's. */
  const activeAgent = useMemo<AgentSummary | null>(() => {
    if (threadAgent) return threadAgent;
    const selected = agents.find((agent) => agent.id === agentId);
    return selected ? { name: selected.name, avatar: selected.avatar } : null;
  }, [agents, agentId, threadAgent]);

  // Agent context: opened from the Agents list (agentId param) or a thread
  // that belongs to an agent (threadAgent). The pickers move out of the
  // header in this context — the agent is fixed by the context.
  const isAgentContext = Boolean(params.agentId) || Boolean(threadAgent);

  const composerBottomPadding =
    keyboardHeight > 0
      ? 8
      : isAgentContext
      ? insets.bottom + 8
      : insets.bottom + 88;
  const currentAgent = useMemo(() => {
    return agents.find((a) => a.id === agentId) ?? null;
  }, [agents, agentId]);

  // Poll the agent's runs while an agent chat is open so task bubbles update
  // in place (Plan → Act → tool calls → completion) without leaving the chat.
  // Free chat starts the same polling after it launches its first Task Mode run.
  // Focus-aware (stops while another screen covers the tab) and never
  // overlapping, so a slow fetch can't race the next tick.
  useFocusedPoll(
    refreshAgentRuns,
    4_000,
    isAgentContext || taskRunIds.length > 0,
  );

  // Agent context shows the agent's task history. Free chat shows only the
  // tasks launched from this conversation.
  const conversationRuns = useMemo(() => {
    if (isAgentContext) return agentRuns;
    const ids = new Set(taskRunIds);
    return agentRuns.filter((run) => ids.has(run.id));
  }, [agentRuns, isAgentContext, taskRunIds]);

  // The agent's primary active run: keep its event timeline fresh so the
  // task bubble's current step (act llm / tool) transitions live. Paused runs
  // are deliberately excluded — their badge is static and they must not steal
  // the poll slot from a running task (the 4s runs list picks a resumed run
  // back up).
  const primaryActiveRunId = useMemo(() => {
    const launchedTask = conversationRuns.find(
      (run) => taskRunIds.includes(run.id) && LIVE.has(run.status),
    );
    return (
      launchedTask?.id ??
      conversationRuns.find((run) => LIVE.has(run.status))?.id ??
      null
    );
  }, [conversationRuns, taskRunIds]);

  const pollActiveRun = useCallback(async () => {
    if (!primaryActiveRunId) return;
    try {
      const detail = await fetchRun(primaryActiveRunId);
      if (mountedRef.current) setActiveRunDetail(detail);
    } catch {
      // Transient — the next tick retries.
    }
  }, [primaryActiveRunId]);

  useFocusedPoll(pollActiveRun, 3_000, Boolean(primaryActiveRunId));

  // Runs surfaced in the timeline: executing runs first, then paused ones,
  // then the most recent finished ones (the list is newest-first) — capped
  // so the thread never gets cluttered.
  const visibleRuns = useMemo(() => {
    const live = conversationRuns.filter((run) => LIVE.has(run.status));
    const paused = conversationRuns.filter((run) => run.status === 'paused');
    const finished = conversationRuns.filter((run) => FINISHED.has(run.status)).slice(0, 3);
    return [...live, ...paused, ...finished].slice(0, 4);
  }, [conversationRuns]);

  // The polled detail may belong to a run that just finished — only feed it
  // to the bubble while it still matches the primary active run.
  const liveRunDetail =
    activeRunDetail && activeRunDetail.run.id === primaryActiveRunId
      ? activeRunDetail
      : null;

  useEffect(() => {
    const failedRun = liveRunDetail?.run;
    if (!failedRun || failedRun.status !== 'failed' || reportedRunFailuresRef.current.has(failedRun.id)) return;
    reportedRunFailuresRef.current.add(failedRun.id);
    showError(failedRun.error || new Error('The task did not finish successfully.'), {
      title: 'Task could not finish',
    });
  }, [liveRunDetail, showError]);

  // Active task running for this agent or in this conversation
  const activeTaskRun = useMemo(() => {
    return (
      conversationRuns.find((run) => LIVE.has(run.status)) ??
      (activeRunId
        ? conversationRuns.find((run) => run.id === activeRunId && LIVE.has(run.status))
        : null)
    );
  }, [activeRunId, conversationRuns]);

  const isTaskActive = isStreaming || Boolean(activeTaskRun || primaryActiveRunId);

  useEffect(() => {
    if (error) {
      showError(error, { title: 'Message could not send', retry: () => regenerate() });
    }
  }, [error, regenerate, showError]);

  const handlePauseTask = useCallback(async () => {
    // 1. Stop streaming if chat response is in flight
    if (isStreaming) {
      try {
        stop();
      } catch (err) {
        showError(err, { title: 'Could not stop request' });
      }
    }

    // 2. Pause autonomous agent run if in flight
    const targetRunId = activeTaskRun?.id ?? primaryActiveRunId ?? activeRunId;
    if (targetRunId) {
      try {
        await pauseRun(targetRunId);
        // Refresh runs immediately so UI updates
        const all = await fetchRuns();
        if (contextAgentId) {
          setAgentRuns(all.filter((run) => run.agent_id === contextAgentId));
        }
        setActiveRunId(
          all.find(
            (run) =>
              (contextAgentId ? run.agent_id === contextAgentId : true) &&
              !FINISHED.has(run.status),
          )?.id ?? null,
        );
      } catch (err) {
        showError(err, { title: 'Could not pause task' });
      }
    }
  }, [isStreaming, stop, activeTaskRun, primaryActiveRunId, activeRunId, contextAgentId, showError]);

  const handleBack = useCallback(() => {
    if (router.canGoBack()) {
      router.back();
    } else {
      router.replace('/agents' as never);
    }
  }, [router]);

  const headerInset = useHeaderInset();

  return (
    <KeyboardAvoidingView
      style={{ flex: 1, backgroundColor: colors.background }}
      behavior="padding"
      keyboardVerticalOffset={0}
    >
      {/* Top Header conforming to old design & design.md */}
      <AppHeader
        left={
          isAgentContext ? (
            <View style={{ flexDirection: 'row', alignItems: 'center', gap: 6 }}>
              <Pressable
                onPress={handleBack}
                accessibilityRole="button"
                accessibilityLabel="Go back"
                hitSlop={4}
                style={({ pressed }) => [
                  {
                    width: 36,
                    height: 36,
                    borderRadius: radius.pill,
                    backgroundColor: colors.surface,
                    alignItems: 'center',
                    justifyContent: 'center',
                    opacity: pressed ? 0.6 : 1,
                  },
                  shadow.floating,
                ]}
              >
                <SymbolIcon icon={ChevronLeft} size={20} color={colors.textPrimary} strokeWidth={1.75} />
              </Pressable>

              <Pressable
                onPress={() => {
                  const target = params.agentId ?? agentId;
                  if (target) {
                    router.push({ pathname: '/agents/[id]', params: { id: target } });
                  }
                }}
                accessibilityRole="button"
                accessibilityLabel={`Open ${currentAgent?.name ?? threadAgent?.name ?? 'agent'} profile`}
                style={({ pressed }) => [
                  {
                    flexDirection: 'row',
                    alignItems: 'center',
                    gap: 8,
                    height: 36,
                    borderRadius: radius.pill,
                    backgroundColor: colors.surface,
                    paddingHorizontal: 10,
                    maxWidth: 210,
                    opacity: pressed ? 0.6 : 1,
                  },
                  shadow.floating,
                ]}
              >
                <View style={{ width: 28, height: 28 }}>
                  <AgentAvatar
                    avatar={currentAgent?.avatar ?? threadAgent?.avatar}
                    name={currentAgent?.name ?? threadAgent?.name}
                    size={28}
                  />
                </View>
                <Text
                  numberOfLines={1}
                  style={{
                    flexShrink: 1,
                    fontSize: 17,
                    lineHeight: 22,
                    fontWeight: '600',
                    color: colors.textPrimary,
                  }}
                >
                  {currentAgent?.name ?? threadAgent?.name ?? 'Agent'}
                </Text>
              </Pressable>
            </View>
          ) : (
            <Pressable
              onPress={() => router.push('/threads')}
              accessibilityRole="button"
              accessibilityLabel="Open threads"
              hitSlop={4}
              style={({ pressed }) => [
                {
                  width: 36,
                  height: 36,
                  borderRadius: radius.pill,
                  backgroundColor: colors.surface,
                  alignItems: 'center',
                  justifyContent: 'center',
                  opacity: pressed ? 0.6 : 1,
                },
                shadow.floating,
              ]}
            >
              <SymbolIcon icon={Menu} size={20} color={colors.textPrimary} strokeWidth={1.75} />
            </Pressable>
          )
        }
        center={isAgentContext ? null : <ModelPicker models={models} selectedId={modelId} onSelect={setModelId} />}
        right={
          isAgentContext ? (
            <View style={{ flexDirection: 'row', alignItems: 'center', gap: 6 }}>
              <Pressable
                onPress={() => setRoutineSheetOpen(true)}
                accessibilityRole="button"
                accessibilityLabel="Routines for this agent"
                hitSlop={4}
                style={({ pressed }) => [
                  {
                    width: 36,
                    height: 36,
                    borderRadius: radius.pill,
                    backgroundColor: colors.surface,
                    alignItems: 'center',
                    justifyContent: 'center',
                    opacity: pressed ? 0.6 : 1,
                  },
                  shadow.floating,
                ]}
              >
                <SymbolIcon icon={CalendarClock} size={20} color={colors.textPrimary} strokeWidth={1.75} />
              </Pressable>

              <Pressable
                onPress={() => {
                  RNAlert.alert(
                    'Search in conversation',
                    'In-thread search is not wired up yet.',
                  );
                }}
                accessibilityRole="button"
                accessibilityLabel="Search in this conversation"
                hitSlop={4}
                style={({ pressed }) => [
                  {
                    width: 36,
                    height: 36,
                    borderRadius: radius.pill,
                    backgroundColor: colors.surface,
                    alignItems: 'center',
                    justifyContent: 'center',
                    opacity: pressed ? 0.6 : 1,
                  },
                  shadow.floating,
                ]}
              >
                <SymbolIcon icon={Search} size={20} color={colors.textPrimary} strokeWidth={1.75} />
              </Pressable>

              <Pressable
                onPress={() => {
                  if (agentId) {
                    router.push({ pathname: '/agents/[id]', params: { id: agentId } });
                  }
                }}
                accessibilityRole="button"
                accessibilityLabel="View agent details"
                hitSlop={4}
                style={({ pressed }) => [
                  {
                    width: 36,
                    height: 36,
                    borderRadius: radius.pill,
                    backgroundColor: colors.surface,
                    alignItems: 'center',
                    justifyContent: 'center',
                    opacity: pressed ? 0.6 : 1,
                  },
                  shadow.floating,
                ]}
              >
                <SymbolIcon icon={SlidersHorizontal} size={20} color={colors.textPrimary} strokeWidth={1.75} />
              </Pressable>
            </View>
          ) : (
            <Pressable
              onPress={() => {
                setMessages([]);
                setAttachments([]);
                setInput('');
                setTaskRunIds([]);
                setAgentRuns([]);
                setThreadAgent(null);
                setThreadId(newChatId());
              }}
              accessibilityRole="button"
              accessibilityLabel="New chat"
              hitSlop={4}
              style={({ pressed }) => [
                {
                  width: 36,
                  height: 36,
                  borderRadius: radius.pill,
                  backgroundColor: colors.surface,
                  alignItems: 'center',
                  justifyContent: 'center',
                  opacity: pressed ? 0.6 : 1,
                },
                shadow.floating,
              ]}
            >
              <SymbolIcon icon={Plus} size={20} color={colors.textPrimary} strokeWidth={1.75} />
            </Pressable>
          )
        }
      />

      {/* Model picker pill under header when in agent context */}
      {isAgentContext && (
        <View
          style={{
            paddingHorizontal: 16,
            paddingVertical: 8,
            backgroundColor: colors.background,
            borderBottomWidth: StyleSheet.hairlineWidth,
            borderBottomColor: colors.divider,
          }}
        >
          <View
            style={{
              flexDirection: 'row',
              alignItems: 'center',
              justifyContent: 'space-between',
              backgroundColor: colors.surface,
              borderRadius: radius.card,
              paddingHorizontal: 14,
              paddingVertical: 8,
            }}
          >
            <Text style={{ fontSize: 15, color: colors.textSecondary }}>Model</Text>
            <ModelPicker models={models} selectedId={modelId} onSelect={setModelId} />
          </View>
        </View>
      )}

      {loadingHistory ? (
        <View style={{ flex: 1, alignItems: 'center', justifyContent: 'center', backgroundColor: colors.background }}>
          <Spinner color="default" />
        </View>
      ) : isEmpty && visibleRuns.length === 0 ? (
        /* Calm Monochrome Hero conforming to design.md */
        <View style={{ flex: 1, alignItems: 'center', justifyContent: 'center', paddingHorizontal: 24 }}>
          <View
            style={[
              {
                width: 72,
                height: 72,
                alignItems: 'center',
                justifyContent: 'center',
                borderRadius: radius.card,
                backgroundColor: colors.surface,
              },
            ]}
          >
            {/* The Pacbot mascot (same mark as the app icon). */}
            <AgentAvatar size={56} name="Pacbot" forcedShape="ghost" forcedColor={colors.mark.black} />
          </View>

          <Text
            style={{
              marginTop: 20,
              textAlign: 'center',
              fontSize: 20,
              lineHeight: 26,
              fontWeight: '600',
              color: colors.textPrimary,
            }}
          >
            What would you like to explore?
          </Text>
          <Text
            style={{
              marginTop: 8,
              textAlign: 'center',
              fontSize: 15,
              lineHeight: 22,
              color: colors.textSecondary,
            }}
          >
            Multi-provider intelligence & autonomous workflows
          </Text>

          {/* Calm Capability Pills as prompt starters */}
          <View style={{ marginTop: 24, flexDirection: 'row', flexWrap: 'wrap', justifyContent: 'center', gap: 8, maxWidth: 360 }}>
            {SUGGESTIONS.map((item) => (
              <Pressable
                key={item.label}
                onPress={() => {
                  setInput(item.prompt);
                }}
                accessibilityRole="button"
                accessibilityLabel={item.label}
                style={({ pressed }) => [
                  {
                    height: 38,
                    flexDirection: 'row',
                    alignItems: 'center',
                    justifyContent: 'center',
                    gap: 6,
                    borderRadius: radius.pill,
                    backgroundColor: colors.surface,
                    paddingHorizontal: 14,
                    opacity: pressed ? 0.6 : 1,
                  },
                ]}
              >
                <SymbolIcon icon={item.icon} size={15} color={colors.textSecondary} strokeWidth={1.75} />
                <Text style={{ fontSize: 13, lineHeight: 18, fontWeight: '500', color: colors.textPrimary }}>
                  {item.label}
                </Text>
              </Pressable>
            ))}
          </View>
        </View>
      ) : (
        <FlatList
          ref={scrollRef}
          style={{ flex: 1 }}
          data={messages}
          keyExtractor={(message) => message.id}
          renderItem={({ item: message, index }) => {
            const parts = message.parts as { type: string; [key: string]: unknown }[];
            // Assistant messages containing tool calls belong to a background
            // run — offer "View task" for the most recent active run.
            // TODO(backend): use the message's own run id once the API links
            // messages to runs.
            const hasToolParts = parts.some((part) => part.type.startsWith('tool-'));
            const runId =
              message.role === 'assistant' && hasToolParts ? activeRunId : null;

            return (
              <MessageBubble
                role={message.role}
                parts={parts}
                modelLabel={message.role === 'assistant' ? modelLabel : null}
                agent={message.role === 'assistant' ? activeAgent : null}
                runId={runId}
                onViewTask={(id) => {
                  router.push({ pathname: '/run', params: { id } });
                }}
                onEditRoutine={() => setRoutineSheetOpen(true)}
                onToolApprovalResponse={({ id, approved }) => {
                  void addToolApprovalResponse({ id, approved });
                }}
                isStreaming={isStreaming && index === messages.length - 1}
              />
            );
          }}
          ListFooterComponent={
            <>
              {status === 'submitted' ? (
                <View style={{ alignItems: 'flex-start' }}>
                  <Spinner size="sm" />
                </View>
              ) : null}

              {/* Agent runs surfaced as live task bubbles: current step and tool
                  chips update in place while the run polls. */}
              {visibleRuns.map((run) => (
                <RunTaskBubble
                  key={run.id}
                  run={run}
                  detail={run.id === primaryActiveRunId ? liveRunDetail : null}
                  onViewTask={(id) => {
                    router.push({ pathname: '/run', params: { id } });
                  }}
                />
              ))}
            </>
          }
          contentContainerStyle={{ paddingHorizontal: 16, paddingTop: headerInset, paddingBottom: 24, gap: 10 }}
          keyboardShouldPersistTaps="handled"
          keyboardDismissMode="interactive"
          onScroll={onScroll}
          onContentSizeChange={scrollToBottom}
          scrollEventThrottle={32}
        />
      )}

      {/* Composer: pinned at the bottom; the agent picker only shows in the
          free-chat context (in agent context the agent is fixed by the header) */}
      <View style={{ paddingHorizontal: 12, paddingTop: 4, paddingBottom: composerBottomPadding }}>
        {!isAgentContext && (
          <AgentPicker agents={agents} selectedId={agentId} onSelect={setAgentId} />
        )}
        <Composer
          value={input}
          onChangeText={setInput}
          onSend={() => void handleSend()}
          onAttachImage={async () => {
            try {
              const picked = await pickAndUploadImages();
              setAttachments((current) => [...current, ...picked]);
            } catch (err) {
              showError(err, { title: 'Could not attach images' });
            }
          }}
          onAttachDocument={async () => {
            try {
              const picked = await pickAndUploadDocument();
              setAttachments((current) => [...current, ...picked]);
            } catch (err) {
              showError(err, { title: 'Could not attach document' });
            }
          }}
          onTakePhoto={async () => {
            try {
              const picked = await takeAndUploadPhoto();
              setAttachments((current) => [...current, ...picked]);
            } catch (err) {
              showError(err, { title: 'Could not take photo' });
            }
          }}
          attachments={attachments}
          onRemoveAttachment={(documentId) =>
            setAttachments((current) => current.filter((a) => a.documentId !== documentId))
          }
          isStreaming={isStreaming}
          isTaskActive={isTaskActive}
          onPause={handlePauseTask}
          deepSearchActive={deepSearchActive}
          onToggleDeepSearch={toggleDeepSearch}
          thinkActive={thinkActive}
          onToggleThink={toggleThink}
          taskModeActive={taskModeActive}
          onToggleTaskMode={toggleTaskMode}
          agentName={currentAgent?.name ?? threadAgent?.name ?? 'Agent'}
        />
      </View>

      {/* Routines for this agent (Phase 10): the clock icon in the header and
          the "Edit" action on a routine proposal both open this sheet. */}
      <RoutineListSheet
        visible={routineSheetOpen}
        onClose={() => setRoutineSheetOpen(false)}
        agentId={contextAgentId}
      />
    </KeyboardAvoidingView>
  );
}
