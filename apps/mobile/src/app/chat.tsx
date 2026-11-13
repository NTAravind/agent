import { useCallback, useEffect, useMemo, useState } from "react";
import {
  ActivityIndicator,
  KeyboardAvoidingView,
  Platform,
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  View,
} from "react-native";
import { useLocalSearchParams, useRouter } from "expo-router";
import { useChat } from "@ai-sdk/react";
import type { UIMessage } from "ai";

import { Composer } from "@/components/composer";
import { MessageBubble } from "@/components/message-bubble";
import { ModelPicker } from "@/components/model-picker";
import { pickAndUploadDocument, pickAndUploadImages, type PendingAttachment } from "@/lib/attachments";
import { ResilientChatTransport } from "@/lib/chat-transport";
import { fetchModels, fetchThread, type ModelOption } from "@/lib/models";
import { supabase } from "@/lib/supabase";

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
  const [input, setInput] = useState("");
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

  const isStreaming = status === "streaming" || status === "submitted";

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
          parts: message.parts as UIMessage["parts"],
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

    setInput("");
    setAttachments([]);
    await sendMessage({ text });
  }, [input, sendMessage]);

  const modelLabel = useMemo(() => {
    if (!modelId) return null;
    return models.find((model) => model.id === modelId)?.label ?? modelId;
  }, [modelId, models]);

  return (
    <KeyboardAvoidingView
      style={styles.container}
      behavior={Platform.OS === "ios" ? "padding" : undefined}
      keyboardVerticalOffset={80}
    >
      <View style={styles.header}>
        <Pressable onPress={() => router.push("/threads")} accessibilityLabel="Threads">
          <Text style={styles.headerButton}>☰</Text>
        </Pressable>

        <ModelPicker models={models} selectedId={modelId} onSelect={setModelId} />

        <Pressable
          onPress={() => {
            setMessages([]);
            setThreadId(newChatId());
          }}
          accessibilityLabel="New chat"
        >
          <Text style={styles.headerButton}>＋</Text>
        </Pressable>
      </View>

      {loadingHistory ? (
        <View style={styles.center}>
          <ActivityIndicator />
        </View>
      ) : (
        <ScrollView style={styles.messages} contentContainerStyle={styles.messagesContent}>
          {messages.length === 0 ? (
            <Text style={styles.empty}>Ask anything. Pick a model with the button above.</Text>
          ) : null}

          {messages.map((message) => (
            <MessageBubble
              key={message.id}
              role={message.role}
              parts={message.parts as { type: string; [key: string]: unknown }[]}
              modelLabel={message.role === "assistant" ? modelLabel : null}
            />
          ))}

          {error ? (
            <View style={styles.errorBox}>
              <Text style={styles.errorTitle}>Request failed</Text>
              <Text style={styles.errorText}>{error.message}</Text>
            </View>
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

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: "#fff" },
  header: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    paddingHorizontal: 12,
    paddingVertical: 10,
    borderBottomWidth: 1,
    borderBottomColor: "#eee",
    gap: 8,
  },
  headerButton: { fontSize: 20, paddingHorizontal: 6 },
  messages: { flex: 1 },
  messagesContent: { padding: 12, paddingBottom: 24 },
  empty: { textAlign: "center", color: "#888", marginTop: 40, fontSize: 14 },
  center: { flex: 1, alignItems: "center", justifyContent: "center" },
  errorBox: {
    backgroundColor: "#fef2f2",
    borderRadius: 12,
    padding: 12,
    marginTop: 8,
    gap: 4,
  },
  errorTitle: { fontWeight: "700", color: "#b91c1c", fontSize: 13 },
  errorText: { color: "#7f1d1d", fontSize: 12 },
});
