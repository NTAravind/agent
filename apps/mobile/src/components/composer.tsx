import { useState } from 'react';
import { Button, Chip, Spinner, TextArea, Typography } from 'heroui-native';
import { View } from 'react-native';

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
    <View className="gap-2 border-t border-separator bg-background px-3 py-2">
      {attachments.length > 0 ? (
        <View className="flex-row flex-wrap gap-1.5">
          {attachments.map((attachment) => (
            <Chip
              key={attachment.documentId}
              variant="soft"
              size="sm"
              onPress={() => onRemoveAttachment(attachment.documentId)}
            >
              <Chip.Label>{attachment.name}</Chip.Label>
            </Chip>
          ))}
        </View>
      ) : null}

      <View className="flex-row items-end gap-2">
        <Button
          size="sm"
          variant="secondary"
          isIconOnly
          onPress={() => void withBusy(onAttachImage)}
          isDisabled={uploading}
          accessibilityLabel="Attach an image"
        >
          {uploading ? <Spinner size="sm" /> : <Typography type="body-sm">🖼</Typography>}
        </Button>

        <Button
          size="sm"
          variant="secondary"
          isIconOnly
          onPress={() => void withBusy(onAttachDocument)}
          isDisabled={uploading}
          accessibilityLabel="Attach a document"
        >
          <Typography type="body-sm">📄</Typography>
        </Button>

        <TextArea
          className="flex-1"
          placeholder="Message…"
          value={value}
          onChangeText={onChangeText}
          editable={!disabled}
          numberOfLines={1}
          rows={1}
        />

        <Button
          size="sm"
          onPress={onSend}
          isDisabled={!canSend}
          accessibilityLabel="Send message"
        >
          {isStreaming ? <Spinner size="sm" color="default" /> : <Button.Label>Send</Button.Label>}
        </Button>
      </View>
    </View>
  );
}
