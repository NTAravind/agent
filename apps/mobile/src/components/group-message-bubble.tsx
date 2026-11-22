import type { AgentGroupMember, StoredMessage } from '@agent/shared';
import { ArrowUpRight, GitBranch } from 'lucide-react-native';
import { Pressable, StyleSheet, Text, View } from 'react-native';

import { AgentAvatar } from '@/components/agent-avatar';
import { colors, radius, space } from '@/theme';

type Props = {
  message: StoredMessage;
  members: AgentGroupMember[];
  /** Opens the persisted run timeline for this message. */
  onOpenRun: (runId: string) => void;
};

function messageText(message: StoredMessage): string {
  return message.parts
    .filter((part) => part.type === 'text')
    .map((part) => String((part as { text?: unknown }).text ?? ''))
    .join('\n')
    .trim();
}

/**
 * A persisted message in a group conversation.
 *
 * Unlike the regular chat bubble, this keeps the server-owned group metadata:
 * the authoring agent avatar, the handoff marker and the child-run link.
 */
export function GroupMessageBubble({ message, members, onOpenRun }: Props) {
  const text = messageText(message);
  const fromAgent =
    message.fromAgent ??
    members.find((member) => member.agentId === message.from_agent_id)?.agent ??
    null;
  const toAgent =
    message.toAgent ??
    members.find((member) => member.agentId === message.to_agent_id)?.agent ??
    null;

  const handoffFrom =
    members.find((member) => member.agentId === message.handoff?.from)?.agent ?? fromAgent;
  const handoffTo =
    members.find((member) => member.agentId === message.handoff?.to)?.agent ?? toAgent;
  const runId = message.run_id ?? message.handoff?.runId ?? null;

  if (message.role === 'user') {
    return (
      <View style={styles.userContainer}>
        <View style={styles.userBubble}>
          {text ? <Text style={styles.userText}>{text}</Text> : null}
        </View>
      </View>
    );
  }

  if (message.role === 'system' || message.role === 'tool') {
    return (
      <View style={styles.systemPill}>
        <Text style={styles.systemText}>{text || message.role}</Text>
      </View>
    );
  }

  return (
    <View style={styles.agentContainer}>
      <View style={styles.avatarGutter}>
        {fromAgent ? (
          <AgentAvatar avatar={fromAgent.avatar} name={fromAgent.name} size={28} />
        ) : (
          <View style={styles.fallbackAvatar}>
            <Text style={{ fontSize: 11, fontWeight: '600', color: colors.textSecondary }}>A</Text>
          </View>
        )}
      </View>

      <View style={styles.contentColumn}>
        {fromAgent ? (
          <Text style={styles.authorLabel}>{fromAgent.name}</Text>
        ) : null}

        {message.handoff ? (
          <View style={styles.handoffCard}>
            <View style={styles.handoffHeader}>
              <GitBranch size={14} color={colors.textSecondary} />
              {handoffFrom ? (
                <AgentAvatar avatar={handoffFrom.avatar} name={handoffFrom.name} size={20} />
              ) : null}
              <Text style={styles.handoffAgentText}>
                {handoffFrom?.name ?? 'Agent'}
              </Text>
              <ArrowUpRight size={12} color={colors.textSecondary} />
              {handoffTo ? (
                <AgentAvatar avatar={handoffTo.avatar} name={handoffTo.name} size={20} />
              ) : null}
              <Text style={styles.handoffAgentText}>
                {handoffTo?.name ?? 'Agent'}
              </Text>
            </View>
            {message.handoff.task ? (
              <Text style={styles.handoffTask}>
                {message.handoff.task}
              </Text>
            ) : null}
          </View>
        ) : null}

        {text && !message.handoff ? (
          <View style={styles.agentBubble}>
            <Text style={styles.agentText}>{text}</Text>
          </View>
        ) : null}

        <View style={styles.footerRow}>
          <Text style={styles.timeText}>
            {new Date(message.created_at).toLocaleTimeString([], {
              hour: 'numeric',
              minute: '2-digit',
            })}
          </Text>
          {runId ? (
            <Pressable
              onPress={() => onOpenRun(runId)}
              accessibilityRole="button"
              accessibilityLabel="View run timeline"
              accessibilityHint="Opens the run timeline for this group message"
              style={styles.runTimelinePill}
            >
              <Text style={styles.runTimelineText}>View run timeline</Text>
              <ArrowUpRight size={11} color={colors.textSecondary} />
            </Pressable>
          ) : null}
        </View>
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  userContainer: {
    alignItems: 'flex-end',
    marginVertical: 4,
  },
  userBubble: {
    maxWidth: '80%',
    borderRadius: radius.card,
    backgroundColor: colors.primary,
    paddingHorizontal: 16,
    paddingVertical: 14,
  },
  userText: {
    fontSize: 17,
    lineHeight: 22,
    color: colors.onPrimary,
  },
  systemPill: {
    alignSelf: 'center',
    marginVertical: 4,
    borderRadius: radius.pill,
    backgroundColor: colors.surface,
    paddingHorizontal: 12,
    paddingVertical: 6,
  },
  systemText: {
    fontSize: 13,
    color: colors.textSecondary,
  },
  agentContainer: {
    flexDirection: 'row',
    alignItems: 'flex-start',
    gap: space.sm,
    marginVertical: 6,
  },
  avatarGutter: {
    marginTop: 2,
  },
  fallbackAvatar: {
    width: 28,
    height: 28,
    borderRadius: radius.pill,
    backgroundColor: colors.surface,
    alignItems: 'center',
    justifyContent: 'center',
  },
  contentColumn: {
    flex: 1,
    gap: space.xs,
  },
  authorLabel: {
    fontSize: 13,
    fontWeight: '600',
    color: colors.textSecondary,
    marginBottom: 2,
  },
  handoffCard: {
    alignSelf: 'flex-start',
    borderRadius: radius.inner,
    backgroundColor: colors.surfaceRaised,
    paddingHorizontal: space.md,
    paddingVertical: space.sm,
    gap: space.xs,
  },
  handoffHeader: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: space.xs,
  },
  handoffAgentText: {
    fontSize: 13,
    fontWeight: '500',
    color: colors.textPrimary,
  },
  handoffTask: {
    fontSize: 13,
    lineHeight: 18,
    color: colors.textSecondary,
  },
  agentBubble: {
    maxWidth: '85%',
    alignSelf: 'flex-start',
    borderRadius: radius.card,
    backgroundColor: colors.surface,
    paddingHorizontal: 16,
    paddingVertical: 14,
  },
  agentText: {
    fontSize: 17,
    lineHeight: 22,
    color: colors.textPrimary,
  },
  footerRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingTop: 4,
  },
  timeText: {
    fontSize: 12,
    color: colors.textSecondary,
  },
  runTimelinePill: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 4,
    borderRadius: radius.pill,
    backgroundColor: colors.surface,
    paddingHorizontal: 8,
    paddingVertical: 3,
  },
  runTimelineText: {
    fontSize: 11,
    fontWeight: '500',
    color: colors.textSecondary,
  },
});
