import { useMemo, useState } from 'react';
import { FlatList, Modal, Pressable, StyleSheet, Text, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { Check, ChevronDown, SlidersHorizontal } from 'lucide-react-native';

import { PROVIDER_LABELS } from '@agent/shared';
import { colors, radius, shadow, space } from '@/theme';
import type { ModelOption } from '@/lib/models';

type Props = {
  models: ModelOption[];
  selectedId: string | null;
  onSelect: (id: string) => void;
};

const CAPABILITIES = [
  'tools',
  'vision',
  'structuredOutput',
  'reasoning',
  'pdf',
] as const;

const CAPABILITY_LABELS: Record<
  (typeof CAPABILITIES)[number],
  string
> = {
  tools: 'Tools',
  vision: 'Vision',
  structuredOutput: 'Structured',
  reasoning: 'Reasoning',
  pdf: 'PDF',
};

/** Display name for a provider id ("huggingface" → "Hugging Face"). */
function providerLabel(provider: string): string {
  return PROVIDER_LABELS[provider as keyof typeof PROVIDER_LABELS] ?? provider;
}

function capabilitySummary(model: ModelOption): string {
  const enabled = CAPABILITIES.filter(
    (capability) => model.capabilities[capability],
  );

  return enabled.length > 0
    ? enabled.map((capability) => CAPABILITY_LABELS[capability]).join(' · ')
    : 'Text only';
}

/** Short status tags shown below each model. */
function statusTags(model: ModelOption): string[] {
  const tags: string[] = [];

  if (model.tier === 'paid') tags.push('Paid');
  if (!model.available) tags.push('No key');
  if (!model.privateOk) tags.push('No private context');

  return tags;
}

/**
 * Clean monochrome model picker conforming to design.md:
 * - Surface-filled capsule trigger with floating shadow.
 * - Clean white bottom sheet with rounded top corners.
 * - No dark obsidian or neon elements.
 */
export function ModelPicker({
  models,
  selectedId,
  onSelect,
}: Props) {
  const [open, setOpen] = useState(false);
  const insets = useSafeAreaInsets();
  const value = useMemo(() => {
    if (!selectedId) return undefined;

    const model = models.find((entry) => entry.id === selectedId);

    return {
      value: selectedId,
      label: model?.label ?? selectedId,
    };
  }, [models, selectedId]);

  return (
    <>
      <Pressable
        accessibilityRole="button"
        accessibilityLabel={`Choose model${value ? `, selected ${value.label}` : ''}`}
        accessibilityHint="Opens the model list"
        onPress={() => setOpen(true)}
        style={({ pressed }) => [
          styles.trigger,
          shadow.floating,
          { opacity: pressed ? 0.6 : 1 },
        ]}
      >
        <SlidersHorizontal size={14} color={colors.textPrimary} strokeWidth={1.75} />
        <Text numberOfLines={1} style={styles.triggerText}>
          {value?.label ?? 'Select model'}
        </Text>
        <ChevronDown size={14} color={colors.textSecondary} strokeWidth={1.75} />
      </Pressable>

      <Modal
        visible={open}
        transparent
        animationType="slide"
        onRequestClose={() => setOpen(false)}
        statusBarTranslucent
      >
        <View style={styles.modalOverlay}>
          <Pressable
            accessibilityLabel="Close model picker"
            onPress={() => setOpen(false)}
            style={styles.backdrop}
          />
          <View
            style={[
              styles.sheetContainer,
              { paddingBottom: Math.max(insets.bottom, space.md) },
            ]}
          >
            {/* Sheet Handle */}
            <View style={styles.handleContainer}>
              <View style={styles.handle} />
            </View>

            <View style={styles.sheetHeader}>
              <View>
                <Text style={styles.sheetTitle}>Choose Model</Text>
                <Text style={styles.sheetSubtitle}>Select model and capabilities</Text>
              </View>
              <Pressable
                onPress={() => setOpen(false)}
                accessibilityRole="button"
                accessibilityLabel="Close model picker"
                style={({ pressed }) => [{ opacity: pressed ? 0.6 : 1 }]}
              >
                <Text style={styles.doneText}>Done</Text>
              </Pressable>
            </View>

            <FlatList
              data={models}
              keyExtractor={(item) => item.id}
              keyboardShouldPersistTaps="handled"
              contentContainerStyle={styles.listContent}
              renderItem={({ item: model }) => {
                const tags = statusTags(model);
                const isSelected = model.id === selectedId;

                return (
                  <Pressable
                    accessibilityRole="button"
                    accessibilityState={{ selected: isSelected, disabled: !model.available }}
                    onPress={() => {
                      onSelect(model.id);
                      setOpen(false);
                    }}
                    style={({ pressed }) => [
                      styles.modelRow,
                      isSelected && styles.modelRowSelected,
                      !model.available && { opacity: 0.4 },
                      { opacity: pressed ? 0.6 : 1 },
                    ]}
                  >
                    <View style={styles.modelInfo}>
                      <View style={styles.titleRow}>
                        <Text style={styles.modelName}>{model.label}</Text>
                        {isSelected ? (
                          <View style={styles.statusDot} />
                        ) : null}
                      </View>
                      <Text style={styles.modelSubtitle}>
                        {`${providerLabel(model.provider)} · ${capabilitySummary(model)}`}
                      </Text>

                      {tags.length > 0 && (
                        <View style={styles.tagRow}>
                          {tags.map((tag) => (
                            <View key={tag} style={styles.tagPill}>
                              <Text style={styles.tagText}>{tag}</Text>
                            </View>
                          ))}
                        </View>
                      )}
                    </View>
                    {isSelected ? (
                      <Check size={18} color={colors.success} strokeWidth={2.5} />
                    ) : null}
                  </Pressable>
                );
              }}
            />
          </View>
        </View>
      </Modal>
    </>
  );
}

export function ModelBadges({
  model,
}: {
  model: ModelOption | null;
}) {
  if (!model) return null;

  return (
    <View style={styles.badgeContainer}>
      <Text style={styles.badgeText}>
        {providerLabel(model.provider)}
      </Text>

      {CAPABILITIES.filter(
        (capability) => model.capabilities[capability],
      ).map((capability) => (
        <Text key={capability} style={styles.badgeSubtext}>
          {`· ${CAPABILITY_LABELS[capability]}`}
        </Text>
      ))}
    </View>
  );
}

const styles = StyleSheet.create({
  trigger: {
    maxWidth: 220,
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
    borderRadius: radius.pill,
    backgroundColor: colors.surfaceRaised,
    paddingHorizontal: 12,
    paddingVertical: 7,
  },
  triggerText: {
    fontSize: 14,
    lineHeight: 18,
    fontWeight: '600',
    color: colors.textPrimary,
    flexShrink: 1,
  },
  modalOverlay: {
    flex: 1,
    justifyContent: 'flex-end',
  },
  backdrop: {
    ...StyleSheet.absoluteFill,
    backgroundColor: colors.overlay,
  },
  sheetContainer: {
    maxHeight: '82%',
    borderTopLeftRadius: radius.sheet,
    borderTopRightRadius: radius.sheet,
    backgroundColor: colors.surfaceRaised,
    ...shadow.floating,
  },
  handleContainer: {
    alignItems: 'center',
    paddingTop: space.sm,
    paddingBottom: space.xs,
  },
  handle: {
    height: 4,
    width: 36,
    borderRadius: radius.pill,
    backgroundColor: colors.divider,
  },
  sheetHeader: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingHorizontal: space.lg,
    paddingVertical: space.sm,
  },
  sheetTitle: {
    fontSize: 20,
    lineHeight: 26,
    fontWeight: '600',
    color: colors.textPrimary,
  },
  sheetSubtitle: {
    fontSize: 14,
    lineHeight: 18,
    color: colors.textSecondary,
    marginTop: 2,
  },
  doneText: {
    fontSize: 17,
    fontWeight: '600',
    color: colors.link,
  },
  listContent: {
    paddingHorizontal: space.md,
    paddingBottom: space.lg,
    gap: space.xs,
  },
  modelRow: {
    flexDirection: 'row',
    alignItems: 'center',
    borderRadius: radius.inner,
    paddingHorizontal: space.md,
    paddingVertical: space.sm + 2,
    backgroundColor: 'transparent',
  },
  modelRowSelected: {
    backgroundColor: colors.surface,
  },
  modelInfo: {
    flex: 1,
    gap: 2,
  },
  titleRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: space.xs,
  },
  modelName: {
    fontSize: 16,
    lineHeight: 22,
    fontWeight: '600',
    color: colors.textPrimary,
  },
  statusDot: {
    width: 6,
    height: 6,
    borderRadius: radius.pill,
    backgroundColor: colors.success,
  },
  modelSubtitle: {
    fontSize: 13,
    lineHeight: 17,
    color: colors.textSecondary,
  },
  tagRow: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: space.xs,
    marginTop: 4,
  },
  tagPill: {
    backgroundColor: colors.surfaceRaised,
    borderRadius: radius.pill,
    paddingHorizontal: 8,
    paddingVertical: 2,
  },
  tagText: {
    fontSize: 11,
    lineHeight: 14,
    color: colors.textSecondary,
  },
  badgeContainer: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: 4,
  },
  badgeText: {
    fontSize: 12,
    color: colors.textSecondary,
  },
  badgeSubtext: {
    fontSize: 12,
    color: colors.textTertiary,
  },
});
