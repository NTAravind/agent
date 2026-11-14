import { Image } from 'expo-image';
import { Card, Typography } from 'heroui-native';
import { View } from 'react-native';

type Props = {
  role: 'user' | 'assistant' | 'system' | 'tool';
  parts: { type: string; [key: string]: unknown }[];
  /** Model that produced this reply (assistant only). */
  modelLabel?: string | null;
};

export function MessageBubble({ role, parts, modelLabel }: Props) {
  const isUser = role === 'user';

  return (
    <View className={isUser ? 'items-end' : 'items-start'}>
      <Card className="max-w-[88%]">
        <Card.Body className="gap-2">
          {parts.map((part, index) => {
            if (part.type === 'text') {
              return (
                <Typography key={index} type="body">
                  {String(part.text ?? '')}
                </Typography>
              );
            }
            if (part.type === 'reasoning') {
              return (
                <Typography key={index} type="body-sm" color="muted">
                  {String(part.text ?? '')}
                </Typography>
              );
            }
            if (part.type === 'file') {
              const url = part.url as string | undefined;
              const mediaType = String(part.mediaType ?? '');
              if (url && mediaType.startsWith('image/')) {
                return (
                  <Image
                    key={index}
                    source={{ uri: url }}
                    style={{ width: 180, height: 180, borderRadius: 12 }}
                    contentFit="cover"
                  />
                );
              }
              return (
                <Typography key={index} type="body-sm">
                  {`📎 ${String(part.filename ?? 'attachment')}`}
                </Typography>
              );
            }
            if (part.type === 'error') {
              return (
                <Typography key={index} type="body-sm" className="text-danger">
                  {String(part.errorText ?? 'Something went wrong.')}
                </Typography>
              );
            }
            return null;
          })}

          {!isUser && modelLabel ? (
            <Typography type="body-xs" color="muted" className="self-end">
              {modelLabel}
            </Typography>
          ) : null}
        </Card.Body>
      </Card>
    </View>
  );
}
