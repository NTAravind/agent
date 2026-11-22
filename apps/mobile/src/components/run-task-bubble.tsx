import { Pressable, StyleSheet, Text, View } from 'react-native';
import { Spinner } from 'heroui-native';

import type { RunEvent } from '@agent/shared';
import { PillButton } from '@/components/design-system';
import { SCREEN_ICONS } from '@/constants/icons';
import type { RunDetail, RunListItem } from '@/lib/agents';
import { colors, radius, shadow, space, typography } from '@/theme';

type Props = {
  /** The run to surface inside the chat timeline. */
  run: RunListItem;
  /** Live detail (events) when this is the primary active run being polled. */
  detail?: RunDetail | null;
  /** Navigates to /run/[id]. */
  onViewTask: (runId: string) => void;
};

const ACTIVE = new Set(['queued', 'running', 'awaiting_approval']);

const STATUS_LABEL: Record<string, string> = {
  queued: 'Queued',
  running: 'Running',
  awaiting_approval: 'Awaiting approval',
  paused: 'Paused',
  succeeded: 'Completed',
  failed: 'Failed',
  cancelled: 'Cancelled',
};

const STATUS_DOT: Record<string, string> = {
  queued: colors.textTertiary,
  running: colors.textPrimary,
  awaiting_approval: colors.textSecondary,
  paused: colors.textSecondary,
  succeeded: colors.success,
  failed: colors.recording,
  cancelled: colors.textTertiary,
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
 * Agent run task card conforming to design.md.
 */
export function RunTaskBubble({ run, detail, onViewTask }: Props) {
  const isActive = ACTIVE.has(run.status);
  const events = detail?.events ?? [];
  const step = isActive ? deriveRunStep(events) : null;
  const tools = isActive ? recentTools(events) : [];
  const dotColor = STATUS_DOT[run.status] ?? colors.textTertiary;

  return (
    <View style={styles.card}>
      <View style={styles.header}>
        <View style={styles.content}>
          <Text style={styles.goalText} numberOfLines={2}>
            {run.goal}
          </Text>

          <View style={styles.statusRow}>
            {/* Status Chip */}
            <View style={styles.statusChip}>
              <View style={[styles.dot, { backgroundColor: dotColor }]} />
              <Text style={styles.statusText}>
                {STATUS_LABEL[run.status] ?? run.status}
              </Text>
            </View>

            {/* Live Step Line */}
            {isActive && step ? (
              <View style={styles.stepContainer} accessibilityLiveRegion="polite">
                {run.status === 'running' ? <Spinner size="sm" color="default" /> : null}
                {step.kind === 'tool' ? (
                  <SCREEN_ICONS.wrench size={12} color={colors.textSecondary} strokeWidth={1.75} />
                ) : null}
                <Text style={styles.stepText} numberOfLines={1}>
                  {step.label}
                </Text>
              </View>
            ) : null}
          </View>

          {/* Recent tool chips */}
          {tools.length > 0 ? (
            <View style={styles.toolChipsRow}>
              {tools.map((tool, index) => (
                <View key={`${tool}-${index}`} style={styles.toolChip}>
                  <Text style={styles.toolChipText} numberOfLines={1}>
                    {tool}
                  </Text>
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
          style={({ pressed }) => [
            styles.viewButton,
            { opacity: pressed ? 0.6 : 1 },
          ]}
        >
          <Text style={styles.viewButtonText}>
            View →
          </Text>
        </Pressable>
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  card: {
    marginVertical: space.xs,
    borderRadius: radius.card,
    backgroundColor: colors.surfaceRaised,
    padding: space.md,
  },
  header: {
    flexDirection: 'row',
    alignItems: 'flex-start',
    justifyContent: 'space-between',
    gap: space.md,
  },
  content: {
    flex: 1,
    gap: space.xs,
  },
  goalText: {
    ...typography.rowTitle,
    fontSize: 16,
    lineHeight: 22,
  },
  statusRow: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    alignItems: 'center',
    gap: space.sm,
  },
  statusChip: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
    borderRadius: radius.pill,
    backgroundColor: colors.surface,
    paddingHorizontal: 10,
    paddingVertical: 4,
  },
  dot: {
    width: 6,
    height: 6,
    borderRadius: radius.pill,
  },
  statusText: {
    fontSize: 12,
    fontWeight: '500',
    color: colors.textPrimary,
  },
  stepContainer: {
    flex: 1,
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
  },
  stepText: {
    fontSize: 12,
    color: colors.textSecondary,
  },
  toolChipsRow: {
    marginTop: 4,
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: 6,
  },
  toolChip: {
    borderRadius: radius.pill,
    backgroundColor: colors.surface,
    paddingHorizontal: 8,
    paddingVertical: 2,
  },
  toolChipText: {
    fontSize: 12,
    color: colors.textSecondary,
  },
  viewButton: {
    borderRadius: radius.pill,
    backgroundColor: colors.surface,
    paddingHorizontal: 12,
    paddingVertical: 6,
    alignSelf: 'flex-start',
  },
  viewButtonText: {
    fontSize: 13,
    fontWeight: '500',
    color: colors.textPrimary,
  },
});
