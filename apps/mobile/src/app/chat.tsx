import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { useChat } from '@ai-sdk/react';
import { Alert, Button, Spinner } from 'heroui-native';
import type { UIMessage } from 'ai';
import {
  KeyboardAvoidingView,
  Pressable,
  ScrollView,
  Text,
  View,
  type NativeScrollEvent,
  type NativeSyntheticEvent,
  type ScrollViewInstance,
} from 'react-native';
import { useLocalSearchParams, useRouter } from 'expo-router';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import { AppHeader } from '@/components/app-header';
import { Composer } from '@/components/composer';
import { MessageBubble } from '@/components/message-bubble';
import { ModelPicker } from '@/components/model-picker';
import {
  pickAndUploadDocument,
  pickAndUploadImages,
  type PendingAttachment,
} from '@/lib/attachments';
import { ResilientChatTransport } from '@/lib/chat-transport';
import { fetchModels, fetchThread, type ModelOption } from '@/lib/models';
import { supabase } from '@/lib/supabase';
import { useKeyboardHeight } from '@/lib/use-keyboard-height';

/** A chat id is generated on the client so the server can create the thread
 *  with it — no round trip is needed to learn the thread id. */
function newChatId(): string {
  return globalThis.crypto?.randomUUID?.() ?? `${Date.now()}-${Math.random().toString(16).slice(2)}`;
}

const SUGGESTIONS = [
  'Summarize a document',
  'Explain a concept simply',
  'Help me write an email',
  'Debug some code',
];

export default function ChatScreen() {
  const router = useRouter();
  const params = useLocalSearchParams<{ threadId?: string }>();
  const insets = useSafeAreaInsets();
  const keyboardHeight = useKeyboardHeight();

  const [models, setModels] = useState<ModelOption[]>([]);
  const [modelId, setModelId] = useState<string | null>(null);
  const [threadId, setThreadId] = useState<string>(params.threadId ?? newChatId());
  const [input, setInput] = useState('');
  const [attachments, setAttachments] = useState<PendingAttachment[]>([]);
  const [loadingHistory, setLoadingHistory] = useState(Boolean(params.threadId));
  const scrollRef = useRef<ScrollViewInstance>(null);
  const atBottomRef = useRef(true);

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

  // Registry + default model.
  useEffect(() => {
    let active = true;
    void fetchModels().then((response) => {
      if (!active || !response) return;
      setModels(response.models);
      setModelId((current) => current ?? response.defaultModel);
    });
    return () => {
      active = false;
    };
  }, []);

  // Existing thread history.
  useEffect(() => {
    if (!params.threadId) return;
    let active = true;
    void fetchThread(params.threadId).then((thread) => {
      if (!active || !thread) return;
      setThreadId(thread.thread.id);
      setModelId((current) => current ?? thread.thread.model ?? null);
      setMessages(
        thread.messages.map((message) => ({
          id: message.id,
          role: message.role,
          parts: message.parts as UIMessage['parts'],
        })) as UIMessage[],
      );
      setLoadingHistory(false);
    });
    return () => {
      active = false;
    };
  }, [params.threadId, setMessages]);

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

      atBottomRef.current = true;
      setInput('');
      // Attachments travel in the send body: they are read synchronously from
      // state here, then cleared once the send has been handed off.
      const pending = sendMessage({ text }, {
        body: {
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
    [attachments, input, sendMessage],
  );

  const modelLabel = useMemo(() => {
    if (!modelId) return null;
    return models.find((model) => model.id === modelId)?.label ?? modelId;
  }, [modelId, models]);

  const composerBottomPadding = keyboardHeight > 0 ? 8 : insets.bottom + 8;

  return (
    <KeyboardAvoidingView
      className="flex-1 bg-background"
      behavior="padding"
      // The avoiding view begins at the window edge, so it has no header offset.
      keyboardVerticalOffset={0}
    >
      {/* Header: menu · model picker · new chat — minimal, no divider noise */}
      <AppHeader
        left={
          <Button
            size="md"
            variant="ghost"
            isIconOnly
            onPress={() => router.push('/threads')}
            accessibilityLabel="Open threads"
          >
            <Button.Label>☰</Button.Label>
          </Button>
        }
        center={<ModelPicker models={models} selectedId={modelId} onSelect={setModelId} />}
        right={
          <Button
            size="md"
            variant="ghost"
            isIconOnly
            onPress={() => {
              setMessages([]);
              setAttachments([]);
              setInput('');
              setThreadId(newChatId());
            }}
            accessibilityLabel="New chat"
          >
            <Button.Label>＋</Button.Label>
          </Button>
        }
      />

      {loadingHistory ? (
        <View className="flex-1 items-center justify-center">
          <Spinner />
        </View>
      ) : isEmpty ? (
        /* Empty state: greeting and quick-start suggestions. */
        <View className="flex-1 items-center justify-center px-6">
          <Text className="text-center text-3xl font-semibold text-foreground">
            How can I help you today?
          </Text>
          <Text className="mt-2 text-center text-base text-muted">
            Pick a model above, or attach an image or PDF.
          </Text>
          <View className="mt-8 flex-row flex-wrap justify-center gap-2">
            {SUGGESTIONS.map((suggestion) => (
              <Pressable
                key={suggestion}
                onPress={() => setInput(suggestion)}
                className="rounded-full border border-border bg-surface px-4 py-2 active:opacity-70"
              >
                <Text className="text-sm text-foreground">{suggestion}</Text>
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
          {messages.map((message) => (
            <MessageBubble
              key={message.id}
              role={message.role}
              parts={message.parts as { type: string; [key: string]: unknown }[]}
              modelLabel={message.role === 'assistant' ? modelLabel : null}
            />
          ))}

          {status === 'submitted' ? (
            <View className="items-start">
              <Spinner size="sm" />
            </View>
          ) : null}

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

      {/* Composer: floating rounded card pinned to the bottom */}
      <View style={{ paddingHorizontal: 12, paddingTop: 4, paddingBottom: composerBottomPadding }}>
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
        />
      </View>
    </KeyboardAvoidingView>
  );
}
