import type { Agent, AgentGroup, GroupMode } from '@agent/shared';
import { useCallback, useMemo, useState } from 'react';
import {
  Alert as RNAlert,
  KeyboardAvoidingView,
  Platform,
  Pressable,
  ScrollView,
  Text,
  TextInput,
  View,
} from 'react-native';
import { Button, Spinner, Typography } from 'heroui-native';
import { useFocusEffect } from 'expo-router';
import { Check, Minus, Plus, Trash2, Users } from 'lucide-react-native';

import { AgentAvatar } from '@/components/agent-avatar';
import { fetchAgents } from '@/lib/agents';
import {
  createGroup,
  deleteGroup,
  fetchGroup,
  replaceGroupMembers,
  updateGroup,
} from '@/lib/groups';

type Props = {
  /** Existing group id; omitted for a new group. */
  groupId?: string;
  onSaved: (group: AgentGroup) => void;
  onDeleted?: () => void;
};

/**
 * Shared group create/edit form. Membership is a whole-set replacement: the
 * lead is always a member and is never duplicated.
 */
export function GroupEditor({ groupId, onSaved, onDeleted }: Props) {
  const editing = Boolean(groupId);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [agents, setAgents] = useState<Agent[]>([]);
  const [name, setName] = useState('');
  const [description, setDescription] = useState('');
  const [mode, setMode] = useState<GroupMode>('handoff');
  const [maxHops, setMaxHops] = useState(8);
  const [tokenBudget, setTokenBudget] = useState(50_000);
  const [leadAgentId, setLeadAgentId] = useState<string | null>(null);
  const [memberIds, setMemberIds] = useState<Set<string>>(new Set());

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const agentList = await fetchAgents();
      setAgents(agentList);
      if (groupId) {
        const group = await fetchGroup(groupId);
        setName(group.name);
        setDescription(group.description ?? '');
        setMode(group.mode);
        setMaxHops(group.maxHops);
        setTokenBudget(group.tokenBudget);
        setLeadAgentId(group.leadAgentId);
        setMemberIds(new Set(group.members.map((member) => member.agentId)));
        setError(null);
      } else {
        const first = agentList[0]?.id ?? null;
        setLeadAgentId(first);
        setMemberIds(new Set(first ? [first] : []));
        setError(null);
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setLoading(false);
    }
  }, [groupId]);

  useFocusEffect(
    useCallback(() => {
      void load();
    }, [load]),
  );

  const selectedCount = memberIds.size;
  const leadAgent = useMemo(
    () => agents.find((agent) => agent.id === leadAgentId) ?? null,
    [agents, leadAgentId],
  );

  const chooseLead = useCallback((id: string) => {
    setLeadAgentId(id);
    setMemberIds((current) => {
      const next = new Set(current);
      next.add(id);
      if (next.size > 12) {
        const removable = [...next].find((memberId) => memberId !== id);
        if (removable) next.delete(removable);
      }
      return next;
    });
  }, []);

  const toggleMember = useCallback((id: string) => {
    if (id === leadAgentId) return;
    setMemberIds((current) => {
      const next = new Set(current);
      if (next.has(id)) next.delete(id);
      else if (next.size < 12) next.add(id);
      return next;
    });
  }, [leadAgentId]);

  const handleSave = useCallback(async () => {
    const trimmedName = name.trim();
    if (!trimmedName) {
      RNAlert.alert('Name required', 'Give the group a name so members can recognize it.');
      return;
    }
    if (!leadAgentId) {
      RNAlert.alert('Lead required', 'Choose the agent that leads this group.');
      return;
    }
    if (selectedCount < 2) {
      RNAlert.alert('Add another member', 'A group needs at least two agents to collaborate.');
      return;
    }

    setSaving(true);
    try {
      const payloadMembers = [...memberIds].filter((id) => id !== leadAgentId).slice(0, 11);
      let saved: AgentGroup;
      if (groupId) {
        saved = await updateGroup(groupId, {
          name: trimmedName,
          description: description.trim() || null,
          mode,
          maxHops,
          tokenBudget,
        });
        saved = await replaceGroupMembers(groupId, {
          leadAgentId,
          memberIds: payloadMembers,
        });
      } else {
        saved = await createGroup({
          name: trimmedName,
          description: description.trim() || null,
          leadAgentId,
          memberIds: payloadMembers,
          mode,
          maxHops,
          tokenBudget,
        });
      }
      onSaved(saved);
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setSaving(false);
    }
  }, [description, groupId, leadAgentId, maxHops, memberIds, mode, name, onSaved, selectedCount, tokenBudget]);

  const handleDelete = useCallback(() => {
    if (!groupId) return;
    RNAlert.alert(
      'Delete this group?',
      'The group configuration is removed. Existing chat history is preserved.',
      [
        { text: 'Cancel', style: 'cancel' },
        {
          text: 'Delete',
          style: 'destructive',
          onPress: () => {
            void deleteGroup(groupId)
              .then(() => onDeleted?.())
              .catch((err: unknown) =>
                RNAlert.alert('Could not delete', err instanceof Error ? err.message : String(err)),
              );
          },
        },
      ],
    );
  }, [groupId, onDeleted]);

  if (loading) {
    return (
      <View className="flex-1 items-center justify-center bg-white dark:bg-[#09090b]">
        <Spinner size="lg" color="default" />
      </View>
    );
  }

  return (
    <KeyboardAvoidingView
      className="flex-1 bg-white dark:bg-[#09090b]"
      behavior={Platform.OS === 'ios' ? 'padding' : undefined}
    >
      <ScrollView
        contentContainerStyle={{ padding: 20, paddingBottom: 48, gap: 22 }}
        keyboardShouldPersistTaps="handled"
      >
        {error ? (
          <View className="rounded-2xl border border-red-500/20 bg-red-500/10 px-3.5 py-2.5">
            <Text className="text-xs text-red-500 dark:text-red-300">{error}</Text>
          </View>
        ) : null}

        <View className="items-center gap-3 rounded-3xl border border-zinc-200 dark:border-white/10 bg-zinc-50 dark:bg-[#121215] p-5">
          <View className="flex-row -space-x-2">
            {agents
              .filter((agent) => memberIds.has(agent.id))
              .slice(0, 4)
              .map((agent) => (
                <View
                  key={agent.id}
                  className="rounded-full border-2 border-zinc-50 dark:border-[#121215]"
                >
                  <AgentAvatar avatar={agent.avatar} name={agent.name} size={38} />
                </View>
              ))}
          </View>
          <Text className="text-base font-bold text-zinc-900 dark:text-white">
            {name.trim() || 'New agent group'}
          </Text>
          <Text className="text-xs text-zinc-500 dark:text-zinc-400">
            {selectedCount} member{selectedCount === 1 ? '' : 's'} · {mode}
          </Text>
        </View>

        <View className="gap-4">
          <View>
            <Text className="mb-1.5 text-xs font-semibold uppercase tracking-wider text-zinc-400 dark:text-zinc-500">
              Name
            </Text>
            <TextInput
              value={name}
              onChangeText={setName}
              placeholder="e.g. Research Crew"
              placeholderTextColor="#71717a"
              className="rounded-2xl border border-zinc-200 dark:border-white/10 bg-zinc-50 dark:bg-[#121215] px-4 py-3 text-base text-zinc-900 dark:text-white"
            />
          </View>

          <View>
            <Text className="mb-1.5 text-xs font-semibold uppercase tracking-wider text-zinc-400 dark:text-zinc-500">
              Description
            </Text>
            <TextInput
              value={description}
              onChangeText={setDescription}
              placeholder="What should this group accomplish?"
              placeholderTextColor="#71717a"
              multiline
              className="min-h-[72px] rounded-2xl border border-zinc-200 dark:border-white/10 bg-zinc-50 dark:bg-[#121215] px-4 py-3 text-base text-zinc-900 dark:text-white leading-5"
            />
          </View>
        </View>

        <View className="gap-2">
          <Text className="text-xs font-semibold uppercase tracking-wider text-zinc-400 dark:text-zinc-500">
            Collaboration mode
          </Text>
          <View className="flex-row rounded-full border border-zinc-200 dark:border-white/10 bg-zinc-100 dark:bg-white/5 p-1">
            {(['handoff', 'roundtable'] as const).map((value) => {
              const selected = mode === value;
              return (
                <Pressable
                  key={value}
                  onPress={() => setMode(value)}
                  accessibilityRole="button"
                  accessibilityState={{ selected }}
                  className={`flex-1 items-center rounded-full py-2 ${selected ? 'bg-white dark:bg-white/15' : ''}`}
                >
                  <Text
                    className={`text-xs font-semibold capitalize ${selected ? 'text-zinc-900 dark:text-white' : 'text-zinc-500'}`}
                  >
                    {value}
                  </Text>
                </Pressable>
              );
            })}
          </View>
          <Text className="text-xs leading-4 text-zinc-400">
            {mode === 'handoff'
              ? 'Members pass control to the best next agent and the lead finalizes.'
              : 'Every member takes one turn, then the lead finalizes.'}
          </Text>
        </View>

        <View className="gap-2">
          <Text className="text-xs font-semibold uppercase tracking-wider text-zinc-400 dark:text-zinc-500">
            Lead agent
          </Text>
          <View className="overflow-hidden rounded-2xl border border-zinc-200 dark:border-white/10 bg-zinc-50 dark:bg-[#121215]">
            {agents.map((agent, index) => {
              const selected = leadAgentId === agent.id;
              return (
                <Pressable
                  key={agent.id}
                  onPress={() => chooseLead(agent.id)}
                  accessibilityRole="radio"
                  accessibilityState={{ selected }}
                  className={`flex-row items-center gap-3 p-3.5 active:bg-zinc-100 dark:active:bg-white/5 ${index > 0 ? 'border-t border-zinc-100 dark:border-white/5' : ''}`}
                >
                  <AgentAvatar avatar={agent.avatar} name={agent.name} size={34} />
                  <View className="flex-1">
                    <Text className="text-sm font-semibold text-zinc-900 dark:text-white">{agent.name}</Text>
                    <Text className="text-[11px] text-zinc-500 dark:text-zinc-400">
                      {agent.role ?? 'Group member'}
                    </Text>
                  </View>
                  {selected ? <Check size={17} color="#8b5cf6" /> : null}
                </Pressable>
              );
            })}
          </View>
        </View>

        <View className="gap-2">
          <Text className="text-xs font-semibold uppercase tracking-wider text-zinc-400 dark:text-zinc-500">
            Members
          </Text>
          {agents.length === 0 ? (
            <View className="items-center gap-2 rounded-2xl border border-zinc-200 dark:border-white/10 bg-zinc-50 dark:bg-[#121215] p-5">
              <Users size={20} color="#71717a" />
              <Text className="text-xs text-zinc-500">Create an agent before building a group.</Text>
            </View>
          ) : (
            <View className="overflow-hidden rounded-2xl border border-zinc-200 dark:border-white/10 bg-zinc-50 dark:bg-[#121215]">
              {agents.map((agent, index) => {
                const isLead = leadAgentId === agent.id;
                const selected = memberIds.has(agent.id);
                return (
                  <Pressable
                    key={agent.id}
                    onPress={() => toggleMember(agent.id)}
                    disabled={isLead}
                    accessibilityRole="checkbox"
                    accessibilityState={{ checked: selected, disabled: isLead }}
                    className={`flex-row items-center gap-3 p-3.5 active:bg-zinc-100 dark:active:bg-white/5 ${index > 0 ? 'border-t border-zinc-100 dark:border-white/5' : ''}`}
                  >
                    <AgentAvatar avatar={agent.avatar} name={agent.name} size={34} />
                    <View className="flex-1">
                      <Text className="text-sm font-semibold text-zinc-900 dark:text-white">{agent.name}</Text>
                      <Text className="text-[11px] text-zinc-500 dark:text-zinc-400">
                        {isLead ? 'Lead · always included' : agent.role ?? 'Member'}
                      </Text>
                    </View>
                    <View
                      className={`h-5 w-5 items-center justify-center rounded-md border ${selected ? 'border-violet-500 bg-violet-500' : 'border-zinc-300 dark:border-white/20'}`}
                    >
                      {selected ? <Check size={13} color="#ffffff" /> : null}
                    </View>
                  </Pressable>
                );
              })}
            </View>
          )}
        </View>

        <View className="gap-3">
          <Text className="text-xs font-semibold uppercase tracking-wider text-zinc-400 dark:text-zinc-500">
            Guardrails
          </Text>
          <View className="flex-row items-center justify-between rounded-2xl border border-zinc-200 dark:border-white/10 bg-zinc-50 dark:bg-[#121215] p-4">
            <View className="flex-1 pr-3">
              <Text className="text-sm font-semibold text-zinc-900 dark:text-white">Maximum hops</Text>
              <Text className="text-[11px] text-zinc-500 dark:text-zinc-400">Stops runaway handoffs.</Text>
            </View>
            <Pressable
              onPress={() => setMaxHops((value) => Math.max(1, value - 1))}
              accessibilityRole="button"
              accessibilityLabel="Decrease maximum hops"
              className="h-8 w-8 items-center justify-center rounded-full bg-zinc-100 dark:bg-white/10"
            >
              <Minus size={14} color="#71717a" />
            </Pressable>
            <Text className="w-10 text-center text-sm font-bold text-zinc-900 dark:text-white">{maxHops}</Text>
            <Pressable
              onPress={() => setMaxHops((value) => Math.min(20, value + 1))}
              accessibilityRole="button"
              accessibilityLabel="Increase maximum hops"
              className="h-8 w-8 items-center justify-center rounded-full bg-zinc-100 dark:bg-white/10"
            >
              <Plus size={14} color="#71717a" />
            </Pressable>
          </View>
          <View className="flex-row items-center justify-between rounded-2xl border border-zinc-200 dark:border-white/10 bg-zinc-50 dark:bg-[#121215] p-4">
            <View className="flex-1 pr-3">
              <Text className="text-sm font-semibold text-zinc-900 dark:text-white">Token budget</Text>
              <Text className="text-[11px] text-zinc-500 dark:text-zinc-400">Cumulative across the group run.</Text>
            </View>
            <Pressable
              onPress={() => setTokenBudget((value) => Math.max(1_000, value - 5_000))}
              accessibilityRole="button"
              accessibilityLabel="Decrease token budget"
              className="h-8 w-8 items-center justify-center rounded-full bg-zinc-100 dark:bg-white/10"
            >
              <Minus size={14} color="#71717a" />
            </Pressable>
            <Text className="w-16 text-center text-sm font-bold text-zinc-900 dark:text-white">
              {Math.round(tokenBudget / 1_000)}k
            </Text>
            <Pressable
              onPress={() => setTokenBudget((value) => Math.min(500_000, value + 5_000))}
              accessibilityRole="button"
              accessibilityLabel="Increase token budget"
              className="h-8 w-8 items-center justify-center rounded-full bg-zinc-100 dark:bg-white/10"
            >
              <Plus size={14} color="#71717a" />
            </Pressable>
          </View>
        </View>

        <Button
          size="lg"
          variant="primary"
          className="rounded-full"
          isDisabled={saving || agents.length < 2}
          onPress={() => void handleSave()}
          accessibilityLabel={editing ? 'Save group' : 'Create group'}
        >
          {saving ? <Spinner size="sm" color="default" /> : <Button.Label>{editing ? 'Save Group' : 'Create Group'}</Button.Label>}
        </Button>

        {editing ? (
          <Pressable
            onPress={handleDelete}
            accessibilityRole="button"
            accessibilityLabel="Delete group"
            className="flex-row items-center justify-center gap-2 rounded-2xl border border-red-500/20 bg-red-500/10 py-3 active:opacity-75"
          >
            <Trash2 size={16} color="#ef4444" />
            <Text className="text-sm font-semibold text-red-500">Delete Group</Text>
          </Pressable>
        ) : null}

        {leadAgent ? (
          <Typography type="body-xs" className="text-center text-zinc-400">
            {leadAgent.name} leads and finalizes the group result.
          </Typography>
        ) : null}
      </ScrollView>
    </KeyboardAvoidingView>
  );
}
