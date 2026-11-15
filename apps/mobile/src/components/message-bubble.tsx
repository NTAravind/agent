import { Image } from 'expo-image';
import { Card, Chip, Typography } from 'heroui-native';
import { Linking, View } from 'react-native';

type Props = {
  role: 'user' | 'assistant' | 'system' | 'tool';
  parts: { type: string; [key: string]: unknown }[];
  /** Model that produced this reply (assistant only). */
  modelLabel?: string | null;
};

type ToolPart = {
  type: string;
  state?: string;
  input?: unknown;
  output?: unknown;
  errorText?: string;
};

export function MessageBubble({ role, parts, modelLabel }: Props) {
  const isUser = role === 'user';

  return (
    <View className={isUser ? 'items-end' : 'items-start'}>
      <Card className={`max-w-[88%] rounded-2xl ${isUser ? 'bg-accent' : 'bg-surface'}`}>
        <Card.Body className="gap-2 px-3 py-2">
          {parts.map((part, index) => {
            if (part.type === 'text') {
              return (
                <Typography
                  key={index}
                  type="body"
                  className={isUser ? 'text-accent-foreground' : 'text-foreground'}
                >
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
                <Typography
                  key={index}
                  type="body-sm"
                  className={isUser ? 'text-accent-foreground' : 'text-foreground'}
                >
                  {`📎 ${String(part.filename ?? 'attachment')}`}
                </Typography>
              );
            }
            if (part.type.startsWith('tool-')) {
              return <ToolPartView key={index} part={part as ToolPart} />;
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

/** Renders a tool call as a compact chip (with citations for web search). */
function ToolPartView({ part }: { part: ToolPart }) {
  const name = part.type.replace(/^tool-/, '');
  const state = part.state ?? 'input-available';
  const label = TOOL_LABELS[name] ?? name;

  const results = extractSearchResults(part.output);

  return (
    <View className="gap-1.5">
      <View className="flex-row items-center gap-1.5">
        <Chip variant="soft" size="sm" color={state === 'output-error' ? 'danger' : 'default'}>
          <Chip.Label>{`${label} · ${TOOL_STATES[state] ?? state}`}</Chip.Label>
        </Chip>
      </View>

      {results.length > 0 ? (
        <View className="flex-row flex-wrap gap-1">
          {results.map((result, index) => (
            <Chip
              key={`${result.url}-${index}`}
              variant="secondary"
              size="sm"
              onPress={() => void Linking.openURL(result.url)}
              accessibilityLabel={`Open ${result.title}`}
            >
              <Chip.Label>{`[${index + 1}] ${result.title}`}</Chip.Label>
            </Chip>
          ))}
        </View>
      ) : null}

      {part.errorText ? (
        <Typography type="body-xs" className="text-danger">
          {part.errorText}
        </Typography>
      ) : null}
    </View>
  );
}

const TOOL_LABELS: Record<string, string> = {
  web_search: 'Web search',
  fetch_page: 'Read page',
  search_notes: 'Search notes',
  read_note: 'Read note',
  recall_memory: 'Recall memory',
  save_memory: 'Save memory',
  list_memories: 'List memories',
};

const TOOL_STATES: Record<string, string> = {
  'input-streaming': 'running',
  'input-available': 'running',
  'output-available': 'done',
  'output-error': 'failed',
};

function extractSearchResults(output: unknown): { title: string; url: string }[] {
  if (!output || typeof output !== 'object') return [];
  const results = (output as { results?: unknown }).results;
  if (!Array.isArray(results)) return [];

  return results
    .filter((item): item is { title: string; url: string } =>
      Boolean(item && typeof item === 'object' && typeof (item as { url?: string }).url === 'string'),
    )
    .map((item) => ({ title: item.title ?? item.url, url: item.url }));
}
