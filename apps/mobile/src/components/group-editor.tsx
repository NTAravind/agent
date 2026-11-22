import type { Agent, AgentGroup, GroupMode } from '@agent/shared';
import React, { useCallback, useMemo, useState } from 'react';
import {
  Alert as RNAlert,
  KeyboardAvoidingView,
  Platform,
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  TextInput,
  View,
} from 'react-native';
import { Spinner } from 'heroui-native';
import { useFocusEffect } from 'expo-router';
import { Check, Minus, Plus, Trash2, Users } from 'lucide-react-native';

import { AgentAvatar } from '@/components/agent-avatar';
import {
  GroupedCard,
  HairlineDivider,
  PillButton,
  SectionLabel,
} from '@/components/design-system';
import { colors, radius, shadow, space } from '@/theme';
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
      <View style={{ flex: 1, alignItems: 'center', justifyContent: 'center', backgroundColor: colors.background }}>
        <Spinner size="lg" color="default" />
      </View>
    );
  }

  return (
    <KeyboardAvoidingView
      style={{ flex: 1, backgroundColor: colors.background }}
      behavior={Platform.OS === 'ios' ? 'padding' : undefined}
    >
      <ScrollView
        contentContainerStyle={{ padding: space.lg, paddingBottom: 48, gap: space.xl }}
        keyboardShouldPersistTaps="handled"
      >
        {error ? (
          <View style={{ backgroundColor: colors.recordingBg, borderRadius: radius.card, padding: space.md }}>
            <Text style={{ fontSize: 13, color: colors.recording }}>{error}</Text>
          </View>
        ) : null}

        <GroupedCard style={{ alignItems: 'center', gap: space.sm, padding: space.xl }}>
          <View style={{ flexDirection: 'row', marginRight: 4 }}>
            {agents
              .filter((agent) => memberIds.has(agent.id))
              .slice(0, 4)
              .map((agent, i) => (
                <View
                  key={agent.id}
                  style={[
                    { borderRadius: radius.pill, borderWidth: 2, borderColor: colors.surface },
                    i > 0 && { marginLeft: -12 },
                  ]}
                >
                  <AgentAvatar avatar={agent.avatar} name={agent.name} size={38} />
                </View>
              ))}
          </View>
          <Text style={{ fontSize: 18, fontWeight: '600', color: colors.textPrimary, marginTop: space.xs }}>
            {name.trim() || 'New agent group'}
          </Text>
          <Text style={{ fontSize: 13, color: colors.textSecondary }}>
            {selectedCount} member{selectedCount === 1 ? '' : 's'} · {mode}
          </Text>
        </GroupedCard>

        <View style={{ gap: space.lg }}>
          <View style={{ gap: space.xs }}>
            <SectionLabel text="Name" />
            <TextInput
              value={name}
              onChangeText={setName}
              placeholder="e.g. Research Crew"
              placeholderTextColor={colors.textSecondary}
              style={styles.input}
            />
          </View>

          <View style={{ gap: space.xs }}>
            <SectionLabel text="Description" />
            <TextInput
              value={description}
              onChangeText={setDescription}
              placeholder="What should this group accomplish?"
              placeholderTextColor={colors.textSecondary}
              multiline
              style={[styles.input, { minHeight: 72, textAlignVertical: 'top' }]}
            />
          </View>
        </View>

        <View style={{ gap: space.xs }}>
          <SectionLabel text="Collaboration Mode" />
          <View style={styles.tabTrack}>
            {(['handoff', 'roundtable'] as const).map((value) => {
              const selected = mode === value;
              return (
                <Pressable
                  key={value}
                  onPress={() => setMode(value)}
                  accessibilityRole="button"
                  accessibilityState={{ selected }}
                  style={[
                    styles.tabSegment,
                    selected && styles.tabSegmentActive,
                    selected && shadow.floating,
                  ]}
                >
                  <Text
                    style={[
                      styles.tabSegmentText,
                      selected && styles.tabSegmentTextActive,
                    ]}
                  >
                    {value}
                  </Text>
                </Pressable>
              );
            })}
          </View>
          <Text style={styles.helpText}>
            {mode === 'handoff'
              ? 'Members pass control to the best next agent and the lead finalizes.'
              : 'Every member takes one turn, then the lead finalizes.'}
          </Text>
        </View>

        <View style={{ gap: space.xs }}>
          <SectionLabel text="Lead Agent" />
          <GroupedCard>
            {agents.map((agent, index) => {
              const selected = leadAgentId === agent.id;
              return (
                <React.Fragment key={agent.id}>
                  {index > 0 && <HairlineDivider inset={56} />}
                  <Pressable
                    onPress={() => chooseLead(agent.id)}
                    accessibilityRole="radio"
                    accessibilityState={{ selected }}
                    style={{
                      flexDirection: 'row',
                      alignItems: 'center',
                      gap: space.md,
                      padding: space.md,
                    }}
                  >
                    <AgentAvatar avatar={agent.avatar} name={agent.name} size={34} />
                    <View style={{ flex: 1 }}>
                      <Text style={{ fontSize: 15, fontWeight: '600', color: colors.textPrimary }}>{agent.name}</Text>
                      <Text style={{ fontSize: 12, color: colors.textSecondary, marginTop: 1 }}>
                        {agent.role ?? 'Group member'}
                      </Text>
                    </View>
                    {selected ? <Check size={18} color={colors.textPrimary} strokeWidth={2.5} /> : null}
                  </Pressable>
                </React.Fragment>
              );
            })}
          </GroupedCard>
        </View>

        <View style={{ gap: space.xs }}>
          <SectionLabel text="Members" />
          {agents.length === 0 ? (
            <GroupedCard style={{ alignItems: 'center', gap: space.sm, padding: space.xl }}>
              <Users size={20} color={colors.textSecondary} />
              <Text style={{ fontSize: 13, color: colors.textSecondary }}>Create an agent before building a group.</Text>
            </GroupedCard>
          ) : (
            <GroupedCard>
              {agents.map((agent, index) => {
                const isLead = leadAgentId === agent.id;
                const selected = memberIds.has(agent.id);
                return (
                  <React.Fragment key={agent.id}>
                    {index > 0 && <HairlineDivider inset={56} />}
                    <Pressable
                      onPress={() => toggleMember(agent.id)}
                      disabled={isLead}
                      accessibilityRole="checkbox"
                      accessibilityState={{ checked: selected, disabled: isLead }}
                      style={{
                        flexDirection: 'row',
                        alignItems: 'center',
                        gap: space.md,
                        padding: space.md,
                        opacity: isLead ? 0.75 : 1,
                      }}
                    >
                      <AgentAvatar avatar={agent.avatar} name={agent.name} size={34} />
                      <View style={{ flex: 1 }}>
                        <Text style={{ fontSize: 15, fontWeight: '600', color: colors.textPrimary }}>{agent.name}</Text>
                        <Text style={{ fontSize: 12, color: colors.textSecondary, marginTop: 1 }}>
                          {isLead ? 'Lead · always included' : agent.role ?? 'Member'}
                        </Text>
                      </View>
                      <View
                        style={[
                          {
                            width: 20,
                            height: 20,
                            alignItems: 'center',
                            justifyContent: 'center',
                            borderRadius: radius.tile / 2,
                            backgroundColor: selected ? colors.primary : colors.surfaceRaised,
                          },
                        ]}
                      >
                        {selected ? <Check size={13} color={colors.onPrimary} strokeWidth={2.5} /> : null}
                      </View>
                    </Pressable>
                  </React.Fragment>
                );
              })}
            </GroupedCard>
          )}
        </View>

        <View style={{ gap: space.xs }}>
          <SectionLabel text="Guardrails" />
          <GroupedCard style={{ padding: space.md, gap: space.md }}>
            <View style={{ flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between' }}>
              <View style={{ flex: 1, paddingRight: space.md }}>
                <Text style={{ fontSize: 15, fontWeight: '600', color: colors.textPrimary }}>Maximum hops</Text>
                <Text style={{ fontSize: 12, color: colors.textSecondary, marginTop: 1 }}>Stops runaway handoffs.</Text>
              </View>
              <Pressable
                onPress={() => setMaxHops((value) => Math.max(1, value - 1))}
                accessibilityRole="button"
                accessibilityLabel="Decrease maximum hops"
                style={styles.stepperButton}
              >
                <Minus size={14} color={colors.textPrimary} />
              </Pressable>
              <Text style={{ width: 40, textAlign: 'center', fontSize: 15, fontWeight: '600', color: colors.textPrimary }}>{maxHops}</Text>
              <Pressable
                onPress={() => setMaxHops((value) => Math.min(20, value + 1))}
                accessibilityRole="button"
                accessibilityLabel="Increase maximum hops"
                style={styles.stepperButton}
              >
                <Plus size={14} color={colors.textPrimary} />
              </Pressable>
            </View>

            <HairlineDivider />

            <View style={{ flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between' }}>
              <View style={{ flex: 1, paddingRight: space.md }}>
                <Text style={{ fontSize: 15, fontWeight: '600', color: colors.textPrimary }}>Token budget</Text>
                <Text style={{ fontSize: 12, color: colors.textSecondary, marginTop: 1 }}>Cumulative across the group run.</Text>
              </View>
              <Pressable
                onPress={() => setTokenBudget((value) => Math.max(1_000, value - 5_000))}
                accessibilityRole="button"
                accessibilityLabel="Decrease token budget"
                style={styles.stepperButton}
              >
                <Minus size={14} color={colors.textPrimary} />
              </Pressable>
              <Text style={{ width: 60, textAlign: 'center', fontSize: 15, fontWeight: '600', color: colors.textPrimary }}>
                {Math.round(tokenBudget / 1_000)}k
              </Text>
              <Pressable
                onPress={() => setTokenBudget((value) => Math.min(500_000, value + 5_000))}
                accessibilityRole="button"
                accessibilityLabel="Increase token budget"
                style={styles.stepperButton}
              >
                <Plus size={14} color={colors.textPrimary} />
              </Pressable>
            </View>
          </GroupedCard>
        </View>

        <PillButton
          label={editing ? (saving ? 'Saving…' : 'Save Group') : (saving ? 'Creating…' : 'Create Group')}
          onPress={() => void handleSave()}
          disabled={saving || agents.length < 2}
          variant="primary"
        />

        {editing ? (
          <Pressable
            onPress={handleDelete}
            accessibilityRole="button"
            accessibilityLabel="Delete group"
            style={styles.deleteButton}
          >
            <Trash2 size={16} color={colors.recording} />
            <Text style={styles.deleteButtonText}>Delete Group</Text>
          </Pressable>
        ) : null}

        {leadAgent ? (
          <Text style={{ textAlign: 'center', fontSize: 13, color: colors.textSecondary }}>
            {leadAgent.name} leads and finalizes the group result.
          </Text>
        ) : null}
      </ScrollView>
    </KeyboardAvoidingView>
  );
}

const styles = StyleSheet.create({
  input: {
    backgroundColor: colors.surface,
    borderRadius: radius.card,
    paddingHorizontal: space.lg,
    paddingVertical: space.md,
    fontSize: 16,
    color: colors.textPrimary,
  },
  tabTrack: {
    flexDirection: 'row',
    backgroundColor: colors.surface,
    borderRadius: radius.pill,
    padding: 3,
  },
  tabSegment: {
    flex: 1,
    alignItems: 'center',
    justifyContent: 'center',
    borderRadius: radius.pill,
    paddingVertical: 7,
  },
  tabSegmentActive: {
    backgroundColor: colors.surfaceRaised,
  },
  tabSegmentText: {
    fontSize: 13,
    fontWeight: '500',
    color: colors.textSecondary,
    textTransform: 'capitalize',
  },
  tabSegmentTextActive: {
    color: colors.textPrimary,
    fontWeight: '600',
  },
  helpText: {
    fontSize: 12,
    lineHeight: 16,
    color: colors.textSecondary,
    paddingHorizontal: space.xs,
  },
  stepperButton: {
    width: 32,
    height: 32,
    alignItems: 'center',
    justifyContent: 'center',
    borderRadius: radius.pill,
    backgroundColor: colors.surfaceRaised,
  },
  deleteButton: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: space.sm,
    backgroundColor: colors.recordingBg,
    borderRadius: radius.card,
    paddingVertical: space.md,
  },
  deleteButtonText: {
    fontSize: 15,
    fontWeight: '600',
    color: colors.recording,
  },
});
