import { useState } from "react";
import { ActivityIndicator, Pressable, StyleSheet, Text, TextInput, View } from "react-native";

import type { PendingAttachment } from "@/lib/attachments";

type Props = {
  value: string;
  onChangeText: (value: string) => void;
  onSend: () => void;
  onAttachImage: () => void | Promise<void>;
  onAttachDocument: () => void | Promise<void>;
  attachments: PendingAttachment[];
  onRemoveAttachment: (documentId: string) => void;
  isStreaming: boolean;
  disabled?: boolean;
};

export function Composer({
  value,
  onChangeText,
  onSend,
  onAttachImage,
  onAttachDocument,
  attachments,
  onRemoveAttachment,
  isStreaming,
  disabled,
}: Props) {
  const [uploading, setUploading] = useState(false);
  const canSend = value.trim().length > 0 && !isStreaming && !disabled;

  const withBusy = async (fn: () => void | Promise<void>) => {
    setUploading(true);
    try {
      await fn();
    } finally {
      setUploading(false);
    }
  };

  return (
    <View style={styles.container}>
      {attachments.length > 0 ? (
        <View style={styles.attachments}>
          {attachments.map((attachment) => (
            <View key={attachment.documentId} style={styles.chip}>
              <Text style={styles.chipText} numberOfLines={1}>
                {attachment.name}
              </Text>
              <Pressable onPress={() => onRemoveAttachment(attachment.documentId)}>
                <Text style={styles.chipRemove}>×</Text>
              </Pressable>
            </View>
          ))}
        </View>
      ) : null}

      <View style={styles.row}>
        <Pressable
          style={styles.iconButton}
          onPress={() => void withBusy(onAttachImage)}
          disabled={uploading}
          accessibilityLabel="Attach an image"
        >
          <Text style={styles.iconText}>🖼</Text>
        </Pressable>

        <Pressable
          style={styles.iconButton}
          onPress={() => void withBusy(onAttachDocument)}
          disabled={uploading}
          accessibilityLabel="Attach a document"
        >
          <Text style={styles.iconText}>📄</Text>
        </Pressable>

        <TextInput
          style={styles.input}
          placeholder="Message…"
          placeholderTextColor="#888"
          value={value}
          onChangeText={onChangeText}
          multiline
          editable={!disabled}
        />

        <Pressable
          style={[styles.send, !canSend && styles.sendDisabled]}
          onPress={onSend}
          disabled={!canSend}
          accessibilityLabel="Send message"
        >
          {isStreaming ? (
            <ActivityIndicator color="#fff" size="small" />
          ) : (
            <Text style={styles.sendText}>Send</Text>
          )}
        </Pressable>
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  container: { padding: 12, gap: 8, borderTopWidth: 1, borderTopColor: "#eee" },
  row: { flexDirection: "row", alignItems: "flex-end", gap: 8 },
  iconButton: { padding: 10 },
  iconText: { fontSize: 20 },
  input: {
    flex: 1,
    minHeight: 40,
    maxHeight: 120,
    borderRadius: 20,
    paddingHorizontal: 14,
    paddingVertical: 10,
    backgroundColor: "#f2f2f7",
    fontSize: 15,
  },
  send: {
    minWidth: 64,
    height: 40,
    borderRadius: 20,
    backgroundColor: "#208AEF",
    alignItems: "center",
    justifyContent: "center",
    paddingHorizontal: 12,
  },
  sendDisabled: { opacity: 0.4 },
  sendText: { color: "#fff", fontWeight: "700" },
  attachments: { flexDirection: "row", flexWrap: "wrap", gap: 6 },
  chip: {
    flexDirection: "row",
    alignItems: "center",
    gap: 6,
    backgroundColor: "#eef2ff",
    borderRadius: 999,
    paddingHorizontal: 10,
    paddingVertical: 6,
    maxWidth: 220,
  },
  chipText: { fontSize: 12, color: "#3730a3" },
  chipRemove: { fontSize: 16, color: "#3730a3", fontWeight: "700" },
});
