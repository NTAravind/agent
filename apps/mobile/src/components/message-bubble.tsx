import { StyleSheet, Text, View } from "react-native";
import { Image } from "expo-image";

type Props = {
  role: "user" | "assistant" | "system" | "tool";
  parts: { type: string; [key: string]: unknown }[];
  /** Model that produced this reply (assistant only). */
  modelLabel?: string | null;
};

export function MessageBubble({ role, parts, modelLabel }: Props) {
  const isUser = role === "user";

  return (
    <View style={[styles.bubble, isUser ? styles.bubbleUser : styles.bubbleAssistant]}>
      {parts.map((part, index) => {
        if (part.type === "text") {
          return (
            <Text key={index} style={styles.text}>
              {String(part.text ?? "")}
            </Text>
          );
        }
        if (part.type === "reasoning") {
          return (
            <Text key={index} style={styles.reasoning}>
              {String(part.text ?? "")}
            </Text>
          );
        }
        if (part.type === "file") {
          const url = part.url as string | undefined;
          const mediaType = String(part.mediaType ?? "");
          if (url && mediaType.startsWith("image/")) {
            return <Image key={index} source={{ uri: url }} style={styles.image} contentFit="cover" />;
          }
          return (
            <Text key={index} style={styles.file}>
              📎 {String(part.filename ?? "attachment")}
            </Text>
          );
        }
        if (part.type === "error") {
          return (
            <Text key={index} style={styles.error}>
              {String(part.errorText ?? "Something went wrong.")}
            </Text>
          );
        }
        return null;
      })}

      {!isUser && modelLabel ? <Text style={styles.meta}>{modelLabel}</Text> : null}
    </View>
  );
}

const styles = StyleSheet.create({
  bubble: {
    maxWidth: "85%",
    borderRadius: 16,
    paddingHorizontal: 14,
    paddingVertical: 10,
    marginVertical: 4,
    gap: 6,
  },
  bubbleUser: { alignSelf: "flex-end", backgroundColor: "#208AEF" },
  bubbleAssistant: { alignSelf: "flex-start", backgroundColor: "#f2f2f7" },
  text: { fontSize: 15, color: "#111", lineHeight: 21 },
  reasoning: { fontSize: 13, color: "#666", fontStyle: "italic" },
  file: { fontSize: 13, color: "#333" },
  image: { width: 180, height: 180, borderRadius: 10 },
  error: { fontSize: 13, color: "#b91c1c" },
  meta: { fontSize: 10, color: "#888", alignSelf: "flex-end" },
});
