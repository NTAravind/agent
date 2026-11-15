import { Image } from 'expo-image';
import { Chip, Typography } from 'heroui-native';
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

/**
 * Chat message layout:
 *  - user: right-aligned rounded bubble on a muted surface
 *  - assistant: plain full-width text, no bubble
 */
export function MessageBubble({ role, parts, modelLabel }: Props) {
  const isUser = role === 'user';

  const content = parts.map((part, index) => {
    if (part.type === 'text') {
      return (
        <Typography key={index} type="body" className="text-base leading-6 text-foreground">
          {String(part.text ?? '')}
        </Typography>
      );
    }
    if (part.type === 'reasoning') {
      return (
        <Typography key={index} type="body-sm" color="muted" className="italic">
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
            style={{ width: 200, height: 200, borderRadius: 16 }}
            contentFit="cover"
          />
        );
      }
      return (
        <View key={index} className="self-start rounded-xl bg-default px-3 py-2">
          <Typography type="body-sm" className="text-foreground">
            {`📎 ${String(part.filename ?? 'attachment')}`}
          </Typography>
        </View>
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
  });

  if (isUser) {
    return (
      <View className="items-end">
        <View className="max-w-[85%] gap-2 rounded-3xl bg-surface px-4 py-3">{content}</View>
      </View>
    );
  }

  return (
    <View className="gap-2">
      {content}
      {modelLabel ? (
        <Typography type="body-xs" color="muted">
          {modelLabel}
        </Typography>
      ) : null}
    </View>
  );
}

/** Renders a tool call as a quiet status line (with citations for web search). */
function ToolPartView({ part }: { part: ToolPart }) {
  const name = part.type.replace(/^tool-/, '');
  const state = part.state ?? 'input-available';
  const label = TOOL_LABELS[name] ?? name;
  const failed = state === 'output-error';

  const results = extractSearchResults(part.output);

  return (
    <View className="gap-1.5">
      <View className="flex-row items-center gap-2 self-start rounded-full bg-surface px-3 py-1.5">
        <View
          className={`h-1.5 w-1.5 rounded-full ${
            failed ? 'bg-danger' : state === 'output-available' ? 'bg-success' : 'bg-accent'
          }`}
        />
        <Typography type="body-xs" color="muted">
          {`${label} · ${TOOL_STATES[state] ?? state}`}
        </Typography>
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
              <Chip.Label numberOfLines={1}>{`${index + 1} · ${result.title}`}</Chip.Label>
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
