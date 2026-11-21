import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { useChat } from '@ai-sdk/react';
import type { AgentSummary } from '@agent/shared';
import { Alert, Button, Spinner, Typography, useThemeColor } from 'heroui-native';
import type { UIMessage } from 'ai';
import {
  Alert as RNAlert,
  KeyboardAvoidingView,
  Pressable,
  ScrollView,
  Text,
  View,
  type NativeScrollEvent,
  type NativeSyntheticEvent,
  type ScrollViewInstance,
} from 'react-native';
import { useFocusEffect, useLocalSearchParams, useRouter } from 'expo-router';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import { AppHeader } from '@/components/app-header';
import { AgentAvatar } from '@/components/agent-avatar';
import { AgentPicker } from '@/components/agent-picker';
import { Composer } from '@/components/composer';
import { MessageBubble } from '@/components/message-bubble';
import { ModelPicker } from '@/components/model-picker';
import { RunTaskBubble } from '@/components/run-task-bubble';
import {
  pickAndUploadDocument,
  pickAndUploadImages,
  type PendingAttachment,
} from '@/lib/attachments';
import {
  fetchAgents,
  fetchRun,
  fetchRuns,
  type Agent,
  type RunDetail,
  type RunListItem,
} from '@/lib/agents';
import { ResilientChatTransport } from '@/lib/chat-transport';
import {
  fetchEnabledModels,
  fetchThread,
  fetchThreads,
  type ModelOption,
} from '@/lib/models';
import { supabase } from '@/lib/supabase';
import { useKeyboardHeight } from '@/lib/use-keyboard-height';
import { CHAT_HEADER_ICONS, MESSAGE_ICONS, SCREEN_ICONS } from '@/constants/icons';

/** Run statuses that no longer need live updates. */
const FINISHED = new Set(['succeeded', 'failed', 'cancelled']);
/** Run statuses still executing (drive the live timeline polling). */
const LIVE = new Set(['queued', 'running', 'awaiting_approval']);

/** A chat id is generated on the client so the server can create the thread
 *  with it — no round trip is needed to learn the thread id. */
function newChatId(): string {
  return globalThis.crypto?.randomUUID?.() ?? `${Date.now()}-${Math.random().toString(16).slice(2)}`;
}

const SUGGESTIONS = [
  {
    label: 'DeepSearch',
    prompt: 'Search the web for the latest updates on ',
    icon: 'deepSearch' as const,
    deepSearch: true,
  },
  {
    label: 'Think & Reason',
    prompt: 'Provide a deep, step-by-step reasoning analysis of ',
    icon: 'think' as const,
    think: true,
  },
  {
    label: 'Draft & Write',
    prompt: 'Help me draft a concise, professional message about ',
    icon: 'sparkles' as const,
  },
  {
    label: 'Debug Code',
    prompt: 'Help me analyze and fix this issue: ',
    icon: 'wrench' as const,
  },
];

export default function ChatScreen() {
  const router = useRouter();
  const params = useLocalSearchParams<{ threadId?: string; agentId?: string; prompt?: string }>();
  const insets = useSafeAreaInsets();
  const keyboardHeight = useKeyboardHeight();
  const iconColor = useThemeColor('foreground');

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
  const [loadingHistory, setLoadingHistory] = useState(
    Boolean(params.threadId) || Boolean(params.agentId),
  );
  /** Most recent still-running run — target of the "View task" button. */
  const [activeRunId, setActiveRunId] = useState<string | null>(null);
  /** Runs owned by the context agent — surfaced inline as task bubbles. */
  const [agentRuns, setAgentRuns] = useState<RunListItem[]>([]);
  /** Live event detail for the primary active run (drives the step line). */
  const [activeRunDetail, setActiveRunDetail] = useState<RunDetail | null>(null);
  /** Set once the user types/sends — blocks thread resumption from clobbering. */
  const touchedRef = useRef(false);
  /** Mirror of the `threadId` state for async comparisons. */
  const threadIdRef = useRef(threadId);
  /**
   * History stashed while the `useChat` id swaps (agent thread resumption);
   * applied by the effect below once the new Chat instance exists.
   */
  const pendingMessagesRef = useRef<UIMessage[] | null>(null);
  const scrollRef = useRef<ScrollViewInstance>(null);
  const atBottomRef = useRef(true);

  useEffect(() => {
    threadIdRef.current = threadId;
  }, [threadId]);

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

  const { messages, setMessages, sendMessage, regenerate, error, status } = useChat<UIMessage>({
    transport,
    id: threadId,
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
    async (id: string) => {
      try {
        const thread = await fetchThread(id);
        if (!thread || touchedRef.current) return;
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
      } finally {
        // In the id-swap path loading ends when the stashed history applies.
        if (!pendingMessagesRef.current) setLoadingHistory(false);
      }
    },
    [setMessages],
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
    void loadThread(params.threadId);
  }, [params.threadId, loadThread]);

  // Agent contact thread resumption: /chat?agentId=<id> picks up the agent's
  // most recent thread so each agent feels like a continuous conversation.
  // When none exists (or the user starts typing first) a fresh thread id is
  // generated client-side and created seamlessly on the first send.
  useEffect(() => {
    if (!params.agentId || params.threadId || touchedRef.current) return;
    let active = true;
    void fetchThreads()
      .then((threads) => {
        if (!active || touchedRef.current) return;
        const latest = threads
          .filter((thread) => thread.agent_id === params.agentId)
          .sort((a, b) => b.updated_at.localeCompare(a.updated_at))[0];
        if (latest) return loadThread(latest.id);
        setLoadingHistory(false); // no history yet — greet on first send
      })
      .catch(() => setLoadingHistory(false));
    return () => {
      active = false;
    };
  }, [params.agentId, params.threadId, loadThread]);

  const onScroll = useCallback((event: NativeSyntheticEvent<NativeScrollEvent>) => {
    const { contentOffset, contentSize, layoutMeasurement } = event.nativeEvent;
    const distanceFromBottom = contentSize.height - (contentOffset.y + layoutMeasurement.height);
    atBottomRef.current = distanceFromBottom < 96;
  }, []);

  const scrollToBottom = useCallback(() => {
    if (!atBottomRef.current) return;
    scrollRef.current?.scrollToEnd({ animated: true });
  }, []);

  const handleSend = useCallback(
    async (override?: string) => {
      const text = (override ?? input).trim();
      if (!text) return;

      touchedRef.current = true;
      setLoadingHistory(false);
      atBottomRef.current = true;
      setInput('');
      // Attachments travel in the send body: they are read synchronously from
      // state here, then cleared once the send has been handed off.
      const pending = sendMessage({ text }, {
        body: {
          ...(agentId ? { agentId } : {}),
          deepSearch: deepSearchActive,
          attachments: attachments.map((attachment) => ({
            documentId: attachment.documentId,
            mediaType: attachment.mediaType,
            name: attachment.name,
          })),
        },
      });
      setAttachments([]);
      await pending;
    },
    [agentId, attachments, deepSearchActive, input, sendMessage],
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

  const composerBottomPadding = keyboardHeight > 0 ? 8 : insets.bottom + 8;

  // Agent context: opened from the Agents list (agentId param) or a thread
  // that belongs to an agent (threadAgent). The pickers move out of the
  // header in this context — the agent is fixed by the context.
  const isAgentContext = Boolean(params.agentId) || Boolean(threadAgent);
  const currentAgent = useMemo(() => {
    return agents.find((a) => a.id === agentId) ?? null;
  }, [agents, agentId]);

  /** The agent this conversation belongs to (param wins over loaded thread). */
  const contextAgentId = params.agentId ?? agentId;

  // Poll the agent's runs while an agent chat is open so task bubbles update
  // in place (Plan → Act → tool calls → completion) without leaving the chat.
  useEffect(() => {
    if (!isAgentContext || !contextAgentId) return;
    let active = true;

    const refreshRuns = async () => {
      try {
        const all = await fetchRuns();
        if (!active) return;
        setAgentRuns(all.filter((run) => run.agent_id === contextAgentId));
        setActiveRunId(
          all.find(
            (run) => run.agent_id === contextAgentId && !FINISHED.has(run.status),
          )?.id ?? null,
        );
      } catch {
        // Transient — the next tick retries.
      }
    };

    void refreshRuns();
    const interval = setInterval(() => void refreshRuns(), 4000);
    return () => {
      active = false;
      clearInterval(interval);
    };
  }, [isAgentContext, contextAgentId]);

  // The agent's primary active run: keep its event timeline fresh so the
  // task bubble's current step (act llm / tool) transitions live. Paused runs
  // are deliberately excluded — their badge is static and they must not steal
  // the poll slot from a running task (the 4s runs list picks a resumed run
  // back up).
  const primaryActiveRunId = useMemo(
    () => agentRuns.find((run) => LIVE.has(run.status))?.id ?? null,
    [agentRuns],
  );

  useEffect(() => {
    if (!primaryActiveRunId) return;
    let active = true;
    const refreshDetail = async () => {
      try {
        const detail = await fetchRun(primaryActiveRunId);
        if (active) setActiveRunDetail(detail);
      } catch {
        // Transient — the next tick retries.
      }
    };
    void refreshDetail();
    const interval = setInterval(() => void refreshDetail(), 3000);
    return () => {
      active = false;
      clearInterval(interval);
    };
  }, [primaryActiveRunId]);

  // Runs surfaced in the timeline: executing runs first, then paused ones,
  // then the most recent finished ones (the list is newest-first) — capped
  // so the thread never gets cluttered.
  const visibleRuns = useMemo(() => {
    const live = agentRuns.filter((run) => LIVE.has(run.status));
    const paused = agentRuns.filter((run) => run.status === 'paused');
    const finished = agentRuns.filter((run) => FINISHED.has(run.status)).slice(0, 3);
    return [...live, ...paused, ...finished].slice(0, 4);
  }, [agentRuns]);

  // The polled detail may belong to a run that just finished — only feed it
  // to the bubble while it still matches the primary active run.
  const liveRunDetail =
    activeRunDetail && activeRunDetail.run.id === primaryActiveRunId
      ? activeRunDetail
      : null;

  return (
    <KeyboardAvoidingView
      className="flex-1 bg-[#09090b]"
      behavior="padding"
      // The avoiding view begins at the window edge, so it has no header offset.
      keyboardVerticalOffset={0}
    >
      {/* Header: 
          - Agent context: back + tappable avatar/name (→ contact card) · search · details
          - Normal: menu · model picker · new chat */}
      <AppHeader
        left={
          isAgentContext ? (
            <View className="flex-row items-center gap-1">
              <Button
                size="md"
                variant="ghost"
                isIconOnly
                onPress={() => router.back()}
                accessibilityRole="button"
                accessibilityLabel="Go back"
                accessibilityHint="Returns to the previous screen"
              >
                <CHAT_HEADER_ICONS.back size={22} color={iconColor} />
              </Button>
              <Pressable
                onPress={() => {
                  const target = params.agentId ?? agentId;
                  if (target) {
                    router.push({ pathname: '/agents/[id]', params: { id: target } });
                  }
                }}
                accessibilityRole="button"
                accessibilityLabel={`Open ${currentAgent?.name ?? threadAgent?.name ?? 'agent'} profile`}
                accessibilityHint="Opens the agent contact card"
                className="flex-row items-center gap-2 rounded-xl py-1 pr-2 active:opacity-70"
                style={{ maxWidth: 180 }}
              >
                <View className="rounded-xl overflow-hidden" style={{ width: 32, height: 32 }}>
                  <AgentAvatar avatar={currentAgent?.avatar ?? threadAgent?.avatar} size={32} />
                </View>
                <Typography type="body" weight="semibold" truncate>
                  {currentAgent?.name ?? threadAgent?.name ?? 'Agent'}
                </Typography>
              </Pressable>
            </View>
          ) : (
            <Button
              size="md"
              variant="ghost"
              isIconOnly
              onPress={() => router.push('/threads')}
              accessibilityRole="button"
              accessibilityLabel="Open threads"
              accessibilityHint="Opens the thread list"
            >
              <CHAT_HEADER_ICONS.menu size={20} color={iconColor} />
            </Button>
          )
        }
        center={isAgentContext ? null : <ModelPicker models={models} selectedId={modelId} onSelect={setModelId} />}
        right={
          isAgentContext ? (
            <View className="flex-row items-center gap-1">
              <Button
                size="md"
                variant="ghost"
                isIconOnly
                onPress={() => {
                  // TODO(backend): Implement in-thread message search.
                  RNAlert.alert(
                    'Search in conversation',
                    'In-thread search is not wired up yet (TODO(backend)).',
                  );
                }}
                accessibilityRole="button"
                accessibilityLabel="Search in this conversation"
                accessibilityHint="Searches messages in this thread"
              >
                <CHAT_HEADER_ICONS.search size={20} color={iconColor} />
              </Button>
              <Button
                size="md"
                variant="ghost"
                isIconOnly
                onPress={() => {
                  if (agentId) {
                    router.push({ pathname: '/agents/[id]', params: { id: agentId } });
                  }
                }}
                accessibilityRole="button"
                accessibilityLabel="View agent details"
                accessibilityHint="Opens the agent overview screen"
              >
                <CHAT_HEADER_ICONS.details size={20} color={iconColor} />
              </Button>
            </View>
          ) : (
            <Button
              size="md"
              variant="ghost"
              isIconOnly
              onPress={() => {
                setMessages([]);
                setAttachments([]);
                setInput('');
                setThreadAgent(null);
                setThreadId(newChatId());
              }}
              accessibilityRole="button"
              accessibilityLabel="New chat"
              accessibilityHint="Starts a fresh conversation"
            >
              <CHAT_HEADER_ICONS.create size={20} color={iconColor} />
            </Button>
          )
        }
      />

      {/* Model picker pill under header when in agent context */}
      {isAgentContext && (
        <View className="px-3.5 py-1.5 bg-[#09090b] border-b border-white/10">
          <View className="flex-row items-center justify-between rounded-2xl border border-white/10 bg-white/5 px-3 py-1.5">
            <Text className="text-xs text-zinc-400">Model</Text>
            <ModelPicker models={models} selectedId={modelId} onSelect={setModelId} />
          </View>
        </View>
      )}

      {loadingHistory ? (
        <View className="flex-1 items-center justify-center bg-[#09090b]">
          <Spinner color="default" />
        </View>
      ) : isEmpty && visibleRuns.length === 0 ? (
        /* Grok-style Minimalist Hero with glowing emblem and capability pills */
        <View className="flex-1 items-center justify-center px-6">
          {/* Glowing Geometric Emblem */}
          <View className="h-16 w-16 items-center justify-center rounded-3xl border border-white/15 bg-white/5 shadow-2xl">
            <MESSAGE_ICONS.sparkles size={32} color="#ffffff" />
          </View>

          <Text className="mt-5 text-center text-3xl font-bold tracking-tight text-white">
            What do you want to explore?
          </Text>
          <Text className="mt-2 text-center text-sm text-zinc-400">
            Powered by multi-provider intelligence & autonomous agents
          </Text>

          {/* Quick-action Grok capability capsules */}
          <View className="mt-8 flex-row flex-wrap justify-center gap-2 max-w-md">
            {SUGGESTIONS.map((item) => (
              <Pressable
                key={item.label}
                onPress={() => {
                  setInput(item.prompt);
                  if (item.deepSearch) setDeepSearchActive(true);
                  if (item.think) toggleThink();
                }}
                accessibilityRole="button"
                accessibilityLabel={item.label}
                className="flex-row items-center gap-2 rounded-full border border-white/10 bg-white/5 px-4 py-2.5 active:bg-white/10"
              >
                {item.icon === 'deepSearch' && <MESSAGE_ICONS.deepSearch size={14} color="#38bdf8" />}
                {item.icon === 'think' && <MESSAGE_ICONS.brain size={14} color="#c084fc" />}
                {item.icon === 'sparkles' && <MESSAGE_ICONS.sparkles size={14} color="#facc15" />}
                {item.icon === 'wrench' && <SCREEN_ICONS.wrench size={14} color="#4ade80" />}
                <Text className="text-sm font-medium text-zinc-200">{item.label}</Text>
              </Pressable>
            ))}
          </View>
        </View>
      ) : (
        <ScrollView
          ref={scrollRef}
          className="flex-1"
          contentContainerStyle={{ paddingHorizontal: 16, paddingTop: 8, paddingBottom: 24, gap: 20 }}
          keyboardShouldPersistTaps="handled"
          keyboardDismissMode="interactive"
          onScroll={onScroll}
          onContentSizeChange={scrollToBottom}
          scrollEventThrottle={32}
        >
          {messages.map((message) => {
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
                key={message.id}
                role={message.role}
                parts={parts}
                modelLabel={message.role === 'assistant' ? modelLabel : null}
                agent={message.role === 'assistant' ? activeAgent : null}
                runId={runId}
                onViewTask={(id) => {
                  router.push({ pathname: '/run', params: { id } });
                }}
              />
            );
          })}

          {status === 'submitted' ? (
            <View className="items-start">
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

          {error ? (
            <Alert status="danger">
              <Alert.Content>
                <Alert.Title>Request failed</Alert.Title>
                <Alert.Description>{error.message}</Alert.Description>
                <View className="mt-2">
                  <Button size="sm" variant="secondary" onPress={() => void regenerate()}>
                    <Button.Label>Retry</Button.Label>
                  </Button>
                </View>
              </Alert.Content>
            </Alert>
          ) : null}
        </ScrollView>
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
            const picked = await pickAndUploadImages();
            setAttachments((current) => [...current, ...picked]);
          }}
          onAttachDocument={async () => {
            const picked = await pickAndUploadDocument();
            setAttachments((current) => [...current, ...picked]);
          }}
          attachments={attachments}
          onRemoveAttachment={(documentId) =>
            setAttachments((current) => current.filter((a) => a.documentId !== documentId))
          }
          isStreaming={isStreaming}
          deepSearchActive={deepSearchActive}
          onToggleDeepSearch={toggleDeepSearch}
          thinkActive={thinkActive}
          onToggleThink={toggleThink}
        />
      </View>
    </KeyboardAvoidingView>
  );
}
