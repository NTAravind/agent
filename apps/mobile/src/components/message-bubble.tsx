import { useState } from 'react';
import type { AgentSummary } from '@agent/shared';
import { Image } from 'expo-image';
import { Button, Typography } from 'heroui-native';
import { Linking, Pressable, Share, View } from 'react-native';
import { CalendarClock } from 'lucide-react-native';

import { AgentAvatar } from '@/components/agent-avatar';
import { RoutineProposalCard, type RoutineProposal } from '@/components/routine-proposal-card';
import { MESSAGE_ICONS } from '@/constants/icons';

type Props = {
  role: 'user' | 'assistant' | 'system' | 'tool';
  parts: { type: string; [key: string]: unknown }[];
  /** Model that produced this reply (assistant only). */
  modelLabel?: string | null;
  /** Authoring agent's identity (assistant only) — avatar shown alongside. */
  agent?: AgentSummary | null;
  /** Run ID if this message is part of a background run. Shows "View task" button. */
  runId?: string | null;
  /** Callback when "View task" is pressed. */
  onViewTask?: (runId: string) => void;
  /** Called when the user taps "Edit" on a routine proposal. */
  onEditRoutine?: (routineId: string) => void;
};

type ToolPart = {
  type: string;
  state?: string;
  input?: unknown;
  output?: unknown;
  errorText?: string;
};

/**
 * Grok-inspired chat message layout:
 *  - User: sleek, dark graphite capsule bubble (`#1c1c22`) with smooth border
 *  - Assistant: clean full-width text flow directly on canvas (no enclosing box)
 *    with 24pt avatar, Grok-style collapsible "Thinking" accordion drawer,
 *    modern numbered citation capsules, and action toolbar.
 */
export function MessageBubble({
  role,
  parts,
  modelLabel,
  agent,
  runId,
  onViewTask,
  onEditRoutine,
}: Props) {
  const isUser = role === 'user';
  const [copied, setCopied] = useState(false);

  const fullAssistantText = parts
    .filter((p) => p.type === 'text')
    .map((p) => String(p.text ?? ''))
    .join('\n');

  const handleShareOrCopy = async () => {
    if (!fullAssistantText) return;
    try {
      setCopied(true);
      await Share.share({ message: fullAssistantText });
    } catch {
      // User cancelled share
    } finally {
      setTimeout(() => setCopied(false), 2000);
    }
  };

  const content = parts.map((part, index) => {
    if (part.type === 'text') {
      return (
        <Typography key={index} type="body" className="text-base leading-6 text-white">
          {String(part.text ?? '')}
        </Typography>
      );
    }
    if (part.type === 'reasoning') {
      return <ReasoningPartView key={index} text={String(part.text ?? '')} />;
    }
    if (part.type === 'file') {
      const url = part.url as string | undefined;
      const mediaType = String(part.mediaType ?? '');
      if (url && mediaType.startsWith('image/')) {
        return (
          <Image
            key={index}
            source={{ uri: url }}
            style={{ width: 220, height: 220, borderRadius: 16 }}
            contentFit="cover"
          />
        );
      }
      return (
        <View key={index} className="self-start rounded-xl border border-white/10 bg-white/5 px-3 py-2">
          <Typography type="body-sm" className="text-zinc-200">
            {`📎 ${String(part.filename ?? 'attachment')}`}
          </Typography>
        </View>
      );
    }
    if (part.type === 'data-routine-proposal') {
      const proposal = part.data as RoutineProposal | undefined;
      if (!proposal?.routineId) return null;
      return (
        <RoutineProposalCard
          key={index}
          proposal={proposal}
          {...(onEditRoutine ? { onEdit: onEditRoutine } : {})}
        />
      );
    }
    if (part.type === 'routine-trigger') {
      // A routine fired — the message is a chip, not something the user typed.
      return (
        <View
          key={index}
          className="flex-row items-center gap-1.5 self-start rounded-full border border-violet-500/25 bg-violet-500/10 px-2.5 py-1"
        >
          <CalendarClock size={11} color="#c084fc" />
          <Typography type="body-xs" className="text-violet-300">
            {`Routine · ${String(part.routine_name ?? 'scheduled run')}`}
          </Typography>
        </View>
      );
    }
    if (part.type.startsWith('tool-')) {
      return <ToolPartView key={index} part={part as ToolPart} />;
    }
    if (part.type === 'error') {
      return (
        <Typography key={index} type="body-sm" className="text-red-400">
          {String(part.errorText ?? 'Something went wrong.')}
        </Typography>
      );
    }
    return null;
  });

  // User Message
  if (isUser) {
    // A routine-triggered message is rendered as a chip, not a bubble.
    const isRoutine = parts.some((part) => part.type === 'routine-trigger');
    if (isRoutine) {
      return <View className="items-start my-1 gap-1.5">{content}</View>;
    }
    return (
      <View className="items-end my-1">
        <View className="max-w-[85%] gap-2 rounded-[22px] rounded-br-sm border border-white/10 bg-[#1c1c22] px-4 py-3 shadow-sm">
          {content}
        </View>
      </View>
    );
  }

  // Assistant Message (Full Bleed on Pitch Black Canvas)
  return (
    <View className="my-2 flex-row items-start gap-3">
      {/* Avatar or Grok-style glowing spark */}
      <View className="mt-0.5">
        {agent ? (
          <AgentAvatar avatar={agent.avatar} size={26} />
        ) : (
          <View className="h-6.5 w-6.5 items-center justify-center rounded-full border border-white/15 bg-white/10">
            <MESSAGE_ICONS.sparkles size={14} color="#ffffff" />
          </View>
        )}
      </View>

      <View className="flex-1 gap-2.5">
        {content}

        {/* Action bar under assistant reply */}
        <View className="mt-1 flex-row flex-wrap items-center justify-between gap-2 border-t border-white/5 pt-2">
          <View className="flex-row items-center gap-2">
            {/* Copy / Share button */}
            {fullAssistantText ? (
              <Pressable
                onPress={() => void handleShareOrCopy()}
                accessibilityRole="button"
                accessibilityLabel="Share or copy response"
                className="flex-row items-center gap-1 rounded-full border border-white/10 bg-white/5 px-2.5 py-1 active:bg-white/15"
              >
                {copied ? (
                  <MESSAGE_ICONS.check size={12} color="#4ade80" />
                ) : (
                  <MESSAGE_ICONS.copy size={12} color="#a1a1aa" />
                )}
                <Typography type="body-xs" className="text-zinc-400">
                  {copied ? 'Shared' : 'Copy'}
                </Typography>
              </Pressable>
            ) : null}

            {/* Subtext info (Agent name · Model label) */}
            <Typography type="body-xs" className="text-zinc-500">
              {[agent?.name, modelLabel].filter(Boolean).join(' · ')}
            </Typography>
          </View>

          {/* View Task button if linked to an active run */}
          {runId && onViewTask ? (
            <Button
              size="sm"
              variant="primary"
              className="rounded-full px-3 py-1"
              onPress={() => onViewTask(runId)}
              accessibilityRole="button"
              accessibilityLabel="View task"
              accessibilityHint="Opens the run detail screen"
            >
              <Button.Label>View task →</Button.Label>
            </Button>
          ) : null}
        </View>
      </View>
    </View>
  );
}

/**
 * Grok-style collapsible "Thinking" trace accordion.
 * Displays a glowing pill indicator ("✦ Thought trace ▾") that expands to show
 * the model's step-by-step reasoning tokens.
 */
function ReasoningPartView({ text }: { text: string }) {
  const [expanded, setExpanded] = useState(false);
  if (!text.trim()) return null;

  return (
    <View className="my-1">
      <Pressable
        onPress={() => setExpanded((prev) => !prev)}
        accessibilityRole="button"
        accessibilityLabel="Toggle thought trace"
        className="flex-row items-center gap-1.5 self-start rounded-full border border-purple-500/25 bg-purple-500/10 px-3 py-1 active:opacity-75"
      >
        <MESSAGE_ICONS.brain size={13} color="#c084fc" />
        <Typography type="body-xs" weight="medium" className="text-purple-300">
          Thought trace
        </Typography>
        {expanded ? (
          <MESSAGE_ICONS.chevronUp size={12} color="#c084fc" />
        ) : (
          <MESSAGE_ICONS.chevronDown size={12} color="#c084fc" />
        )}
      </Pressable>
      {expanded ? (
        <View className="mt-2 rounded-2xl border border-white/10 bg-[#121215] p-3.5">
          <Typography type="body-xs" className="font-mono text-zinc-300 leading-5">
            {text}
          </Typography>
        </View>
      ) : null}
    </View>
  );
}

/** Renders a tool call with citations and status badge. */
function ToolPartView({ part }: { part: ToolPart }) {
  const name = part.type.replace(/^tool-/, '');
  const state = part.state ?? 'input-available';
  const label = TOOL_LABELS[name] ?? name;
  const failed = state === 'output-error';

  const results = extractSearchResults(part.output);

  return (
    <View className="gap-2 my-0.5">
      {/* Status Pill */}
      <View className="flex-row items-center gap-2 self-start rounded-full border border-white/10 bg-[#141418] px-3 py-1.5">
        <View
          className={`h-2 w-2 rounded-full ${
            failed ? 'bg-red-400' : state === 'output-available' ? 'bg-emerald-400' : 'bg-sky-400'
          }`}
        />
        <Typography type="body-xs" className="text-zinc-300">
          {`${label} · ${TOOL_STATES[state] ?? state}`}
        </Typography>
      </View>

      {/* Grok-style Citation Badges */}
      {results.length > 0 ? (
        <View className="flex-row flex-wrap gap-1.5">
          {results.map((result, index) => {
            const domain = cleanDomain(result.url);
            return (
              <Pressable
                key={`${result.url}-${index}`}
                onPress={() => void Linking.openURL(result.url)}
                accessibilityRole="button"
                accessibilityLabel={`Open ${result.title}`}
                className="flex-row items-center gap-1.5 rounded-full border border-white/10 bg-white/5 px-2.5 py-1 active:bg-white/10"
              >
                <MESSAGE_ICONS.deepSearch size={11} color="#38bdf8" />
                <Typography type="body-xs" numberOfLines={1} className="max-w-[150px] text-zinc-300">
                  {`${index + 1} · ${domain || result.title}`}
                </Typography>
              </Pressable>
            );
          })}
        </View>
      ) : null}

      {part.errorText ? (
        <Typography type="body-xs" className="text-red-400">
          {part.errorText}
        </Typography>
      ) : null}
    </View>
  );
}

function cleanDomain(url: string): string {
  try {
    return url.replace(/^https?:\/\//i, '').split('/')[0].replace(/^www\./i, '');
  } catch {
    return url;
  }
}

const TOOL_LABELS: Record<string, string> = {
  web_search: 'DeepSearch',
  fetch_page: 'Read source',
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
