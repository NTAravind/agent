import { useMemo } from 'react';
import { Select, Typography } from 'heroui-native';
import { View } from 'react-native';

import type { ModelOption } from '@/lib/models';

type Props = {
  models: ModelOption[];
  selectedId: string | null;
  onSelect: (id: string) => void;
};

const CAPABILITIES = ['tools', 'vision', 'structuredOutput', 'reasoning', 'pdf'] as const;

function capabilitySummary(model: ModelOption): string {
  const enabled = CAPABILITIES.filter((capability) => model.capabilities[capability]);
  return enabled.length > 0 ? enabled.join(' · ') : 'text only';
}

export function ModelPicker({ models, selectedId, onSelect }: Props) {
  const value = useMemo(() => {
    if (!selectedId) return undefined;
    const model = models.find((entry) => entry.id === selectedId);
    return { value: selectedId, label: model?.label ?? selectedId };
  }, [models, selectedId]);

  return (
    <Select
      value={value}
      onValueChange={(option) => {
        if (option) onSelect(option.value);
      }}
      presentation="bottom-sheet"
    >
      <Select.Trigger className="max-w-[220px] flex-row items-center gap-1 rounded-full border border-border bg-surface px-3 py-2">
        <Select.Value placeholder="Select model" numberOfLines={1} className="shrink" />
        <Select.TriggerIndicator />
      </Select.Trigger>

      <Select.Content presentation="bottom-sheet">
        {models.map((model) => (
          <Select.Item key={model.id} value={model.id} label={model.label}>
            <View className="flex-1 gap-1">
              <Select.ItemLabel />
              <Select.ItemDescription>
                {`${model.provider} · ${capabilitySummary(model)}${
                  model.tier === 'paid' ? ' · paid' : ''
                }${model.available ? '' : ' · no key'}${model.privateOk ? '' : ' · no private context'}`}
              </Select.ItemDescription>
            </View>
          </Select.Item>
        ))}
      </Select.Content>
    </Select>
  );
}

export function ModelBadges({ model }: { model: ModelOption | null }) {
  if (!model) return null;

  return (
    <View className="flex-row flex-wrap gap-1">
      <Typography type="body-xs" color="muted">
        {model.provider}
      </Typography>
      {CAPABILITIES.filter((capability) => model.capabilities[capability]).map((capability) => (
        <Typography key={capability} type="body-xs" color="muted">
          {`· ${capability}`}
        </Typography>
      ))}
    </View>
  );
}
