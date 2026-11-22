import type { AgentGroupMember, StoredMessage } from '@agent/shared';
import { ArrowUpRight, GitBranch, Sparkles } from 'lucide-react-native';
import { Pressable, Text, View } from 'react-native';

import { AgentAvatar } from '@/components/agent-avatar';

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
      <View className="items-end my-1">
        <View className="max-w-[88%] rounded-[22px] rounded-br-sm border border-white/10 bg-[#1c1c22] px-4 py-3 shadow-sm">
          {text ? <Text className="text-base leading-6 text-white">{text}</Text> : null}
        </View>
      </View>
    );
  }

  if (message.role === 'system' || message.role === 'tool') {
    return (
      <View className="my-1 self-center rounded-full border border-white/10 bg-white/5 px-3 py-1.5">
        <Text className="text-xs text-zinc-400">{text || message.role}</Text>
      </View>
    );
  }

  return (
    <View className="my-2 flex-row items-start gap-3">
      <View className="mt-0.5">
        {fromAgent ? (
          <AgentAvatar avatar={fromAgent.avatar} name={fromAgent.name} size={28} />
        ) : (
          <View className="h-7 w-7 items-center justify-center rounded-full border border-white/15 bg-white/10">
            <Sparkles size={14} color="#ffffff" />
          </View>
        )}
      </View>

      <View className="flex-1 gap-2.5">
        {fromAgent ? (
          <Text className="text-xs font-semibold text-zinc-300">{fromAgent.name}</Text>
        ) : null}

        {message.handoff ? (
          <View className="self-start rounded-2xl border border-violet-500/25 bg-violet-500/10 px-3 py-2.5">
            <View className="flex-row items-center gap-2">
              <GitBranch size={14} color="#c084fc" />
              {handoffFrom ? (
                <AgentAvatar avatar={handoffFrom.avatar} name={handoffFrom.name} size={20} />
              ) : null}
              <Text className="text-xs font-semibold text-violet-200">
                {handoffFrom?.name ?? 'Agent'}
              </Text>
              <ArrowUpRight size={12} color="#a78bfa" />
              {handoffTo ? (
                <AgentAvatar avatar={handoffTo.avatar} name={handoffTo.name} size={20} />
              ) : null}
              <Text className="text-xs font-semibold text-violet-200">
                {handoffTo?.name ?? 'Agent'}
              </Text>
            </View>
            {message.handoff.task ? (
              <Text className="mt-1.5 text-xs leading-5 text-violet-100/80">
                {message.handoff.task}
              </Text>
            ) : null}
          </View>
        ) : null}

        {text && !message.handoff ? (
          <Text className="text-base leading-6 text-white">{text}</Text>
        ) : null}

        <View className="flex-row items-center justify-between gap-2 border-t border-white/5 pt-2">
          <Text className="text-[11px] text-zinc-500">
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
              className="flex-row items-center gap-1 rounded-full border border-white/10 bg-white/5 px-2.5 py-1 active:bg-white/10"
            >
              <Text className="text-[11px] font-medium text-zinc-300">View run timeline</Text>
              <ArrowUpRight size={11} color="#a1a1aa" />
            </Pressable>
          ) : null}
        </View>
      </View>
    </View>
  );
}
