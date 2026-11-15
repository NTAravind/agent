import { useState } from 'react';
import { Button, Chip, Spinner } from 'heroui-native';
import { Alert, TextInput, View } from 'react-native';

import type { PendingAttachment } from '@/lib/attachments';

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

/**
 * Single-card composer. Text input on top, then a toolbar
 * row with a single "+" attach button on the left and a round send button on
 * the right.
 */
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

  const openAttachMenu = () => {
    Alert.alert('Add to chat', undefined, [
      { text: 'Photo', onPress: () => void withBusy(onAttachImage) },
      { text: 'Document (PDF)', onPress: () => void withBusy(onAttachDocument) },
      { text: 'Cancel', style: 'cancel' },
    ]);
  };

  return (
    <View className="gap-2 rounded-3xl border border-border bg-surface px-3 pb-2 pt-3">
      {attachments.length > 0 ? (
        <View className="flex-row flex-wrap gap-1.5">
          {attachments.map((attachment) => (
            <Chip
              key={attachment.documentId}
              variant="soft"
              size="sm"
              onPress={() => onRemoveAttachment(attachment.documentId)}
              accessibilityLabel={`Remove ${attachment.name}`}
            >
              <Chip.Label numberOfLines={1}>{`${attachment.name}  ✕`}</Chip.Label>
            </Chip>
          ))}
        </View>
      ) : null}

      <TextInput
        className="max-h-40 min-h-[40px] px-1 text-base text-foreground"
        placeholder="Message…"
        placeholderTextColor="#9ca3af"
        value={value}
        onChangeText={onChangeText}
        editable={!disabled}
        multiline
        textAlignVertical="top"
      />

      <View className="flex-row items-center justify-between">
        <Button
          size="sm"
          variant="ghost"
          isIconOnly
          className="rounded-full"
          onPress={openAttachMenu}
          isDisabled={uploading || disabled}
          accessibilityLabel="Add attachment"
        >
          {uploading ? <Spinner size="sm" /> : <Button.Label>＋</Button.Label>}
        </Button>

        <Button
          size="sm"
          isIconOnly
          className="rounded-full"
          onPress={onSend}
          isDisabled={!canSend}
          accessibilityLabel="Send message"
        >
          {isStreaming ? <Spinner size="sm" color="default" /> : <Button.Label>↑</Button.Label>}
        </Button>
      </View>
    </View>
  );
}
