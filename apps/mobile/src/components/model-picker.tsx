
import { useMemo, useState } from 'react';
import { Button, Typography } from 'heroui-native';
import { FlatList, Modal, Pressable, Text, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import { PROVIDER_LABELS } from '@agent/shared';

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
        className="max-w-[240px] flex-row items-center justify-center gap-1 rounded-full px-3 py-2 active:opacity-60"
      >
        <Text numberOfLines={1} className="shrink text-base font-semibold text-foreground">
          {value?.label ?? 'Select model'}
        </Text>
        <Text className="text-sm text-muted">⌄</Text>
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
            className="absolute inset-0 bg-black/50"
          />
          <View
            className="max-h-[82%] rounded-t-3xl border-t border-border bg-background"
            style={{ paddingBottom: Math.max(insets.bottom, 16) }}
          >
            <View className="flex-row items-center justify-between px-5 pb-3 pt-5">
              <View>
                <Typography type="body" className="font-semibold text-foreground">Choose a model</Typography>
                <Typography type="body-xs" color="muted">Provider and capabilities</Typography>
              </View>
              <Button size="sm" variant="ghost" onPress={() => setOpen(false)} accessibilityLabel="Close model picker">
                <Button.Label>Done</Button.Label>
              </Button>
            </View>
            <FlatList
              data={models}
              keyExtractor={(item) => item.id}
              keyboardShouldPersistTaps="handled"
              contentContainerStyle={{ paddingHorizontal: 8, paddingBottom: 12 }}
              renderItem={({ item: model }) => {
          const tags = statusTags(model);

          return (
            <Pressable
              accessibilityRole="button"
              accessibilityState={{ selected: model.id === selectedId, disabled: !model.available }}
              onPress={() => {
                onSelect(model.id);
                setOpen(false);
              }}
              className={`mx-1 mb-1 min-h-16 flex-row items-center rounded-2xl px-4 py-3 active:bg-surface ${
                !model.available ? 'opacity-50' : ''
              } ${model.id === selectedId ? 'bg-surface' : ''}`}
            >
              <View className="flex-1 gap-1">
                <Text className="text-base font-medium text-foreground">{model.label}</Text>
                <Typography type="body-xs" color="muted">
                  {`${providerLabel(model.provider)} · ${capabilitySummary(model)}`}
                </Typography>

                {tags.length > 0 && (
                  <Typography type="body-xs" color="muted">
                    {tags.join(' · ')}
                  </Typography>
                )}
              </View>
              {model.id === selectedId ? <Text className="text-base text-accent">✓</Text> : null}
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
      <Typography type="body-xs" color="muted">
        {providerLabel(model.provider)}
      </Typography>

      {CAPABILITIES.filter(
        (capability) => model.capabilities[capability],
      ).map((capability) => (
        <Typography key={capability} type="body-xs" color="muted">
          {`· ${CAPABILITY_LABELS[capability]}`}
        </Typography>
      ))}
    </View>
  );
}
