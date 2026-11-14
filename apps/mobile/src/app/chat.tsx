import { useCallback, useEffect, useMemo, useState } from 'react';
import { useChat } from '@ai-sdk/react';
import { Alert, Button, Spinner, Typography } from 'heroui-native';
import type { UIMessage } from 'ai';
import { KeyboardAvoidingView, Platform, ScrollView, View } from 'react-native';
import { useLocalSearchParams, useRouter } from 'expo-router';

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

/** A chat id is generated on the client so the server can create the thread
 *  with it — no round trip is needed to learn the thread id. */
function newChatId(): string {
  return globalThis.crypto?.randomUUID?.() ?? `${Date.now()}-${Math.random().toString(16).slice(2)}`;
}

export default function ChatScreen() {
  const router = useRouter();
  const params = useLocalSearchParams<{ threadId?: string }>();

  const [models, setModels] = useState<ModelOption[]>([]);
  const [modelId, setModelId] = useState<string | null>(null);
  const [threadId, setThreadId] = useState<string>(params.threadId ?? newChatId());
  const [input, setInput] = useState('');
  const [attachments, setAttachments] = useState<PendingAttachment[]>([]);
  const [loadingHistory, setLoadingHistory] = useState(Boolean(params.threadId));

  const transport = useMemo(
    () =>
      new ResilientChatTransport({
        threadId,
        model: modelId,
        getToken: async () => {
          const { data } = await supabase.auth.getSession();
          return data.session?.access_token ?? null;
        },
        getAttachments: () =>
          attachments.map((attachment) => ({
            documentId: attachment.documentId,
            mediaType: attachment.mediaType,
            name: attachment.name,
          })),
      }),
    [threadId, modelId, attachments],
  );

  const { messages, setMessages, sendMessage, error, status } = useChat<UIMessage>({
    transport,
    id: threadId,
  });

  const isStreaming = status === 'streaming' || status === 'submitted';

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

  const handleSend = useCallback(async () => {
    const text = input.trim();
    if (!text) return;

    setInput('');
    setAttachments([]);
    await sendMessage({ text });
  }, [input, sendMessage]);

  const modelLabel = useMemo(() => {
    if (!modelId) return null;
    return models.find((model) => model.id === modelId)?.label ?? modelId;
  }, [modelId, models]);

  return (
    <KeyboardAvoidingView
      className="flex-1 bg-background"
      behavior={Platform.OS === 'ios' ? 'padding' : undefined}
      keyboardVerticalOffset={80}
    >
      <View className="flex-row items-center justify-between gap-2 border-b border-separator px-3 py-2">
        <Button size="sm" variant="ghost" isIconOnly onPress={() => router.push('/threads')}>
          <Typography type="body">☰</Typography>
        </Button>

        <ModelPicker models={models} selectedId={modelId} onSelect={setModelId} />

        <Button
          size="sm"
          variant="ghost"
          isIconOnly
          onPress={() => {
            setMessages([]);
            setThreadId(newChatId());
          }}
          accessibilityLabel="New chat"
        >
          <Typography type="body">＋</Typography>
        </Button>
      </View>

      {loadingHistory ? (
        <View className="flex-1 items-center justify-center">
          <Spinner />
        </View>
      ) : (
        <ScrollView contentContainerStyle={{ padding: 12, gap: 8, paddingBottom: 24 }}>
          {messages.length === 0 ? (
            <Typography type="body-sm" color="muted" className="mt-10 text-center">
              Ask anything. Pick a model with the button above.
            </Typography>
          ) : null}

          {messages.map((message) => (
            <MessageBubble
              key={message.id}
              role={message.role}
              parts={message.parts as { type: string; [key: string]: unknown }[]}
              modelLabel={message.role === 'assistant' ? modelLabel : null}
            />
          ))}

          {error ? (
            <Alert status="danger">
              <Alert.Content>
                <Alert.Title>Request failed</Alert.Title>
                <Alert.Description>{error.message}</Alert.Description>
              </Alert.Content>
            </Alert>
          ) : null}
        </ScrollView>
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
      />
    </KeyboardAvoidingView>
  );
}
