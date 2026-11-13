import { useMemo, useState } from "react";
import { Modal, Pressable, ScrollView, StyleSheet, Text, View } from "react-native";

import type { ModelOption } from "@/lib/models";

type Props = {
  models: ModelOption[];
  selectedId: string | null;
  onSelect: (id: string) => void;
};

const CAPABILITIES = ["tools", "vision", "structuredOutput", "reasoning", "pdf"] as const;

export function ModelPicker({ models, selectedId, onSelect }: Props) {
  const [open, setOpen] = useState(false);

  const selected = useMemo(
    () => models.find((model) => model.id === selectedId) ?? null,
    [models, selectedId],
  );

  return (
    <>
      <Pressable style={styles.trigger} onPress={() => setOpen(true)}>
        <Text style={styles.triggerText} numberOfLines={1}>
          {selected ? selected.label : "Select model"}
        </Text>
        {selected ? <Text style={styles.provider}>{selected.provider}</Text> : null}
      </Pressable>

      <Modal visible={open} animationType="slide" transparent onRequestClose={() => setOpen(false)}>
        <View style={styles.backdrop}>
          <View style={styles.sheet}>
            <Text style={styles.title}>Model</Text>
            <ScrollView>
              {models.map((model) => {
                const isSelected = model.id === selectedId;
                return (
                  <Pressable
                    key={model.id}
                    style={[styles.row, isSelected && styles.rowSelected]}
                    onPress={() => {
                      onSelect(model.id);
                      setOpen(false);
                    }}
                  >
                    <View style={styles.rowHeader}>
                      <Text style={styles.label}>{model.label}</Text>
                      <View style={[styles.badge, model.provider === "google" ? styles.badgeGoogle : model.provider === "groq" ? styles.badgeGroq : styles.badgeOpenRouter]}>
                        <Text style={styles.badgeText}>{model.provider}</Text>
                      </View>
                      {model.tier === "paid" ? (
                        <View style={styles.badgePaid}>
                          <Text style={styles.badgeText}>paid</Text>
                        </View>
                      ) : null}
                      {!model.available ? (
                        <View style={styles.badgeOff}>
                          <Text style={styles.badgeText}>no key</Text>
                        </View>
                      ) : null}
                    </View>

                    <View style={styles.caps}>
                      {CAPABILITIES.filter((capability) => model.capabilities[capability]).map(
                        (capability) => (
                          <View key={capability} style={styles.cap}>
                            <Text style={styles.capText}>{capability}</Text>
                          </View>
                        ),
                      )}
                      {!model.privateOk ? (
                        <View style={styles.capWarning}>
                          <Text style={styles.capWarningText}>no private context</Text>
                        </View>
                      ) : null}
                    </View>
                  </Pressable>
                );
              })}
            </ScrollView>
            <Pressable style={styles.close} onPress={() => setOpen(false)}>
              <Text style={styles.closeText}>Close</Text>
            </Pressable>
          </View>
        </View>
      </Modal>
    </>
  );
}

const styles = StyleSheet.create({
  trigger: {
    flexDirection: "row",
    alignItems: "center",
    gap: 6,
    paddingHorizontal: 10,
    paddingVertical: 6,
    borderRadius: 999,
    borderWidth: 1,
    borderColor: "#8884",
  },
  triggerText: { fontSize: 13, fontWeight: "600", maxWidth: 180 },
  provider: { fontSize: 11, opacity: 0.6 },
  backdrop: { flex: 1, backgroundColor: "#0008", justifyContent: "flex-end" },
  sheet: {
    backgroundColor: "#fff",
    borderTopLeftRadius: 16,
    borderTopRightRadius: 16,
    padding: 16,
    maxHeight: "75%",
    gap: 12,
  },
  title: { fontSize: 18, fontWeight: "700" },
  row: { paddingVertical: 10, borderBottomWidth: 1, borderBottomColor: "#eee", gap: 6 },
  rowSelected: { backgroundColor: "#208AEF12" },
  rowHeader: { flexDirection: "row", alignItems: "center", gap: 8, flexWrap: "wrap" },
  label: { fontSize: 15, fontWeight: "600" },
  badge: { paddingHorizontal: 6, paddingVertical: 2, borderRadius: 4, backgroundColor: "#eee" },
  badgeGoogle: { backgroundColor: "#dbeafe" },
  badgeGroq: { backgroundColor: "#dcfce7" },
  badgeOpenRouter: { backgroundColor: "#f3e8ff" },
  badgePaid: { paddingHorizontal: 6, paddingVertical: 2, borderRadius: 4, backgroundColor: "#fef3c7" },
  badgeOff: { paddingHorizontal: 6, paddingVertical: 2, borderRadius: 4, backgroundColor: "#fee2e2" },
  badgeText: { fontSize: 10, fontWeight: "700" },
  caps: { flexDirection: "row", flexWrap: "wrap", gap: 6 },
  cap: { paddingHorizontal: 6, paddingVertical: 2, borderRadius: 4, backgroundColor: "#f1f5f9" },
  capText: { fontSize: 10, opacity: 0.8 },
  capWarning: { paddingHorizontal: 6, paddingVertical: 2, borderRadius: 4, backgroundColor: "#fff7ed" },
  capWarningText: { fontSize: 10, color: "#c2410c" },
  close: { alignItems: "center", paddingVertical: 12 },
  closeText: { fontSize: 15, fontWeight: "600" },
});
