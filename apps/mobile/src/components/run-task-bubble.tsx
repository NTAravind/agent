import { Spinner, Typography } from 'heroui-native';
import { Pressable, View } from 'react-native';

import type { RunEvent } from '@agent/shared';
import { SCREEN_ICONS } from '@/constants/icons';
import type { RunDetail, RunListItem } from '@/lib/agents';

type Props = {
  /** The run to surface inside the chat timeline. */
  run: RunListItem;
  /** Live detail (events) when this is the primary active run being polled. */
  detail?: RunDetail | null;
  /** Navigates to /run/[id]. */
  onViewTask: (runId: string) => void;
};

const ACTIVE = new Set(['queued', 'running', 'awaiting_approval']);

const STATUS_BADGE: Record<string, { bg: string; border: string; text: string; dot: string }> = {
  queued: { bg: 'bg-white/5', border: 'border-white/10', text: 'text-zinc-400', dot: 'bg-zinc-400' },
  running: { bg: 'bg-amber-500/15', border: 'border-amber-500/30', text: 'text-amber-300', dot: 'bg-amber-400' },
  awaiting_approval: { bg: 'bg-orange-500/15', border: 'border-orange-500/30', text: 'text-orange-300', dot: 'bg-orange-400' },
  paused: { bg: 'bg-violet-500/15', border: 'border-violet-500/30', text: 'text-violet-300', dot: 'bg-violet-400' },
  succeeded: { bg: 'bg-emerald-500/15', border: 'border-emerald-500/30', text: 'text-emerald-300', dot: 'bg-emerald-400' },
  failed: { bg: 'bg-red-500/15', border: 'border-red-500/30', text: 'text-red-300', dot: 'bg-red-400' },
  cancelled: { bg: 'bg-white/5', border: 'border-white/10', text: 'text-zinc-400', dot: 'bg-zinc-500' },
};

const STATUS_LABEL: Record<string, string> = {
  queued: 'Queued',
  running: 'Running',
  awaiting_approval: 'Awaiting approval',
  paused: 'Paused',
  succeeded: 'Completed',
  failed: 'Failed',
  cancelled: 'Cancelled',
};

/** Human labels for graph nodes (mirrors src/app/run.tsx). */
const NODE_LABEL: Record<string, string> = {
  plan: 'Making a plan',
  act: 'Researching',
  observe: 'Checking progress',
  self_correct: 'Adjusting approach',
  finalize: 'Writing the result',
  act_llm: 'Thinking',
  tool_gate: 'Running tools',
  // Supervisor graph
  delegate: 'Delegating to specialists',
  fan_out: 'Specialists researching',
  verify: 'Cross-checking results',
  merge: 'Merging the report',
};

/**
 * The run's current step, derived from the event timeline: an open
 * `tool_call` wins over an open `node_start` (LIFO pairing).
 */
export function deriveRunStep(
  events: RunEvent[],
): { label: string; kind: 'tool' | 'node' } | null {
  const openNodes: string[] = [];
  const openTools: string[] = [];

  for (const event of events) {
    const payload = (event.payload ?? {}) as Record<string, unknown>;
    if (event.type === 'node_start') {
      openNodes.push(String(payload.node ?? ''));
    } else if (event.type === 'node_end') {
      openNodes.pop();
    } else if (event.type === 'tool_call') {
      openTools.push(String(payload.tool ?? 'tool'));
    } else if (event.type === 'tool_result') {
      openTools.pop();
    }
  }

  const tool = openTools[openTools.length - 1];
  if (tool) return { label: tool, kind: 'tool' };

  const node = openNodes[openNodes.length - 1];
  if (node) return { label: NODE_LABEL[node] ?? node, kind: 'node' };

  return null;
}

/** The most recent tool calls of a run, for the chip row (newest last). */
function recentTools(events: RunEvent[], limit = 3): string[] {
  const tools: string[] = [];
  for (const event of events) {
    if (event.type !== 'tool_call') continue;
    const payload = (event.payload ?? {}) as Record<string, unknown>;
    tools.push(String(payload.tool ?? 'tool'));
  }
  return tools.slice(-limit);
}

/**
 * Grok-style autonomous agent run task card:
 * goal, live glowing pulse, current step + recent tool chips, and "View task" action.
 */
export function RunTaskBubble({ run, detail, onViewTask }: Props) {
  const isActive = ACTIVE.has(run.status);
  const events = detail?.events ?? [];
  const step = isActive ? deriveRunStep(events) : null;
  const tools = isActive ? recentTools(events) : [];
  const badge = STATUS_BADGE[run.status] ?? STATUS_BADGE.queued;

  return (
    <View className="my-1.5 gap-2.5 rounded-2xl border border-white/10 bg-[#121216] p-3.5 shadow-lg">
      <View className="flex-row items-start justify-between gap-3">
        <View className="flex-1 gap-1.5">
          <Typography type="body" weight="semibold" className="text-white" numberOfLines={2}>
            {run.goal}
          </Typography>

          <View className="flex-row flex-wrap items-center gap-2">
            {/* Status Chip */}
            <View className={`flex-row items-center gap-1.5 rounded-full border px-2.5 py-1 ${badge.bg} ${badge.border}`}>
              <View className={`h-1.5 w-1.5 rounded-full ${badge.dot}`} />
              <Typography type="body-xs" weight="medium" className={badge.text}>
                {STATUS_LABEL[run.status] ?? run.status}
              </Typography>
            </View>

            {/* Live Step Line */}
            {isActive && step ? (
              <View className="flex-1 flex-row items-center gap-1.5" accessibilityLiveRegion="polite">
                {run.status === 'running' ? <Spinner size="sm" color="default" /> : null}
                {step.kind === 'tool' ? (
                  <SCREEN_ICONS.wrench size={11} color="#a1a1aa" strokeWidth={2} />
                ) : null}
                <Typography type="body-xs" className="text-zinc-400" numberOfLines={1}>
                  {step.label}
                </Typography>
              </View>
            ) : null}
          </View>

          {/* Recent tool chips */}
          {tools.length > 0 ? (
            <View className="mt-1 flex-row flex-wrap gap-1.5">
              {tools.map((tool, index) => (
                <View
                  key={`${tool}-${index}`}
                  className="rounded-full border border-white/10 bg-white/5 px-2.5 py-0.5"
                >
                  <Typography type="body-xs" className="text-zinc-400" numberOfLines={1}>
                    {tool}
                  </Typography>
                </View>
              ))}
            </View>
          ) : null}
        </View>

        {/* View Task Button */}
        <Pressable
          onPress={() => onViewTask(run.id)}
          accessibilityRole="button"
          accessibilityLabel="View task"
          accessibilityHint="Opens the run detail screen with the live timeline"
          className="rounded-full border border-white/15 bg-white/10 px-3 py-1.5 active:bg-white/20"
        >
          <Typography type="body-xs" weight="medium" className="text-white">
            View task →
          </Typography>
        </Pressable>
      </View>
    </View>
  );
}
