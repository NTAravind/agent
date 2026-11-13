import { useCallback, useState } from "react";
import { ActivityIndicator, Pressable, ScrollView, StyleSheet, Text, View } from "react-native";
import { useFocusEffect, useRouter } from "expo-router";

import { deleteThread, fetchThreads } from "@/lib/models";
import type { Thread } from "@agent/shared";

export default function ThreadsScreen() {
  const router = useRouter();
  const [threads, setThreads] = useState<Thread[]>([]);
  const [loading, setLoading] = useState(true);

  const load = useCallback(async () => {
    try {
      setThreads(await fetchThreads());
    } catch (error) {
      console.warn("[threads] could not load threads:", error);
    } finally {
      setLoading(false);
    }
  }, []);

  useFocusEffect(
    useCallback(() => {
      void load();
    }, [load]),
  );

  return (
    <View style={styles.container}>
      <View style={styles.header}>
        <Text style={styles.title}>Threads</Text>
        <Pressable onPress={() => router.back()}>
          <Text style={styles.link}>Close</Text>
        </Pressable>
      </View>

      {loading ? (
        <View style={styles.center}>
          <ActivityIndicator />
        </View>
      ) : (
        <ScrollView contentContainerStyle={styles.list}>
          {threads.length === 0 ? <Text style={styles.empty}>No conversations yet.</Text> : null}

          {threads.map((thread) => (
            <Pressable
              key={thread.id}
              style={styles.row}
              onPress={() => router.push({ pathname: "/chat", params: { threadId: thread.id } })}
            >
              <View style={styles.rowText}>
                <Text style={styles.rowTitle} numberOfLines={1}>
                  {thread.title ?? "Untitled"}
                </Text>
                <Text style={styles.rowMeta}>
                  {new Date(thread.updated_at).toLocaleString()}
                  {thread.model ? ` · ${thread.model}` : ""}
                </Text>
              </View>

              <Pressable
                onPress={() => {
                  void deleteThread(thread.id).then(load);
                }}
                accessibilityLabel="Delete thread"
              >
                <Text style={styles.delete}>Delete</Text>
              </Pressable>
            </Pressable>
          ))}
        </ScrollView>
      )}
    </View>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: "#fff" },
  header: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    padding: 16,
    borderBottomWidth: 1,
    borderBottomColor: "#eee",
  },
  title: { fontSize: 20, fontWeight: "700" },
  link: { fontSize: 15, color: "#208AEF", fontWeight: "600" },
  center: { flex: 1, alignItems: "center", justifyContent: "center" },
  list: { padding: 12, gap: 8 },
  empty: { textAlign: "center", color: "#888", marginTop: 40 },
  row: {
    flexDirection: "row",
    alignItems: "center",
    gap: 12,
    padding: 14,
    borderRadius: 12,
    backgroundColor: "#f7f7f8",
  },
  rowText: { flex: 1, gap: 4 },
  rowTitle: { fontSize: 15, fontWeight: "600" },
  rowMeta: { fontSize: 11, color: "#888" },
  delete: { fontSize: 13, color: "#b91c1c", fontWeight: "600" },
});
