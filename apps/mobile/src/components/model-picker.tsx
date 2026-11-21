import { useMemo, useState } from 'react';
import { Button, Typography } from 'heroui-native';
import { FlatList, Modal, Pressable, Text, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import { PROVIDER_LABELS } from '@agent/shared';
import { MESSAGE_ICONS } from '@/constants/icons';
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
 * Grok-inspired model picker.
 * Features a sleek capsule trigger and obsidian bottom sheet.
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
        className="max-w-[220px] flex-row items-center justify-center gap-1.5 rounded-full border border-white/10 bg-white/5 px-3 py-1.5 active:bg-white/10"
      >
        <MESSAGE_ICONS.sparkles size={13} color="#ffffff" />
        <Text numberOfLines={1} className="shrink text-sm font-semibold text-white">
          {value?.label ?? 'Select model'}
        </Text>
        <MESSAGE_ICONS.chevronDown size={13} color="#71717a" />
      </Pressable>

      <Modal
        visible={open}
        transparent
        animationType="slide"
        onRequestClose={() => setOpen(false)}
        statusBarTranslucent
      >
        <View className="flex-1 justify-end">
          <Pressable
            accessibilityLabel="Close model picker"
            onPress={() => setOpen(false)}
            className="absolute inset-0 bg-black/60"
          />
          <View
            className="max-h-[82%] rounded-t-[32px] border-t border-white/10 bg-[#101014]"
            style={{ paddingBottom: Math.max(insets.bottom, 16) }}
          >
            {/* Sheet Handle */}
            <View className="items-center pt-3 pb-1">
              <View className="h-1 w-10 rounded-full bg-white/20" />
            </View>

            <View className="flex-row items-center justify-between px-5 pb-3 pt-2">
              <View>
                <Typography type="body" weight="semibold" className="text-white">Choose Model</Typography>
                <Typography type="body-xs" className="text-zinc-400">Select model and capabilities</Typography>
              </View>
              <Button size="sm" variant="ghost" onPress={() => setOpen(false)} accessibilityLabel="Close model picker">
                <Button.Label>Done</Button.Label>
              </Button>
            </View>
            <FlatList
              data={models}
              keyExtractor={(item) => item.id}
              keyboardShouldPersistTaps="handled"
              contentContainerStyle={{ paddingHorizontal: 12, paddingBottom: 16 }}
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
                    className={`mx-1 mb-2 flex-row items-center rounded-2xl border px-4 py-3 active:opacity-75 ${
                      isSelected
                        ? 'border-white/25 bg-white/10'
                        : 'border-white/5 bg-[#16161b]'
                    } ${!model.available ? 'opacity-40' : ''}`}
                  >
                    <View className="flex-1 gap-1">
                      <View className="flex-row items-center gap-2">
                        <Text className="text-base font-semibold text-white">{model.label}</Text>
                        {isSelected ? (
                          <View className="h-2 w-2 rounded-full bg-emerald-400" />
                        ) : null}
                      </View>
                      <Typography type="body-xs" className="text-zinc-400">
                        {`${providerLabel(model.provider)} · ${capabilitySummary(model)}`}
                      </Typography>

                      {tags.length > 0 && (
                        <Typography type="body-xs" className="text-zinc-500">
                          {tags.join(' · ')}
                        </Typography>
                      )}
                    </View>
                    {isSelected ? (
                      <MESSAGE_ICONS.check size={16} color="#ffffff" />
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
    <View className="flex-row flex-wrap gap-1">
      <Typography type="body-xs" className="text-zinc-400">
        {providerLabel(model.provider)}
      </Typography>

      {CAPABILITIES.filter(
        (capability) => model.capabilities[capability],
      ).map((capability) => (
        <Typography key={capability} type="body-xs" className="text-zinc-500">
          {`· ${CAPABILITY_LABELS[capability]}`}
        </Typography>
      ))}
    </View>
  );
}
