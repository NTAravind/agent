import type { Agent, AgentAvatar as AgentAvatarType, Skill } from '@agent/shared';
import { DEFAULT_AGENT_AVATAR } from '@agent/shared';
import React, { useCallback, useState } from 'react';
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
import { Spinner, Switch } from 'heroui-native';
import { useFocusEffect, useLocalSearchParams, useRouter } from 'expo-router';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { BookMarked, Check, ChevronLeft, Trash2, Upload } from 'lucide-react-native';

import { AppHeader } from '@/components/app-header';
import {
  GroupedCard,
  HairlineDivider,
  PillButton,
  RoundButton,
  SectionLabel,
} from '@/components/design-system';
import { colors, radius, shadow, space } from '@/theme';
import {
  AgentAvatar,
  AVATAR_ICONS,
  CREATURE_SHAPES,
  PALETTE_COLORS,
  type CreatureShape,
} from '@/components/agent-avatar';
import { ModelPicker } from '@/components/model-picker';
import {
  createAgent,
  deleteAgent,
  fetchAgents,
  updateAgent,
  uploadAgentAvatar,
} from '@/lib/agents';
import { fetchEnabledModels, type ModelOption } from '@/lib/models';
import { fetchSkills, setAgentSkills } from '@/lib/skills';

type AvatarTab = 'icon' | 'creature' | 'upload';

const ICON_CHOICES = Object.keys(AVATAR_ICONS);

/**
 * Modern Agent Editor & Creator Screen.
 * Features:
 *  - Prominent live creature / icon avatar preview
 *  - Vector icon picker (Lucide icons) & organic creature shape picker
 *  - Signature creature palette color swatches
 *  - Polished modern input cards with clear hierarchy
 *  - Supervisor delegation toggle & model selector
 */
export default function AgentEditorScreen() {
  const router = useRouter();
  const insets = useSafeAreaInsets();
  const params = useLocalSearchParams<{ id: string }>();
  const id = typeof params.id === 'string' ? params.id : '';
  const isNew = id === 'new';

  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const [name, setName] = useState('');
  const [role, setRole] = useState('');
  const [instructions, setInstructions] = useState('');
  const [modelId, setModelId] = useState<string | null>(null);
  const [fallbacks, setFallbacks] = useState<string[]>([]);
  const [avatar, setAvatar] = useState<AgentAvatarType>({
    type: 'icon',
    value: 'bot',
    color: colors.mark.purple,
  });
  const [avatarTab, setAvatarTab] = useState<AvatarTab>('icon');
  const [uploadingAvatar, setUploadingAvatar] = useState(false);
  const [isSupervisor, setIsSupervisor] = useState(false);
  const [toolCount, setToolCount] = useState(0);
  const [models, setModels] = useState<ModelOption[]>([]);
  const [skills, setSkills] = useState<Skill[]>([]);
  const [assignedSkillIds, setAssignedSkillIds] = useState<Set<string>>(new Set());
  const [skillsLoading, setSkillsLoading] = useState(false);

  const load = useCallback(async () => {
    setSkillsLoading(true);
    try {
      const [modelResponse, agents, allSkills] = await Promise.all([
        fetchEnabledModels(),
        fetchAgents(),
        fetchSkills().catch(() => [] as Skill[]),
      ]);
      setSkills(allSkills);
      const available =
        modelResponse?.models.filter(
          (model) => model.available && model.capabilities.tools && model.capabilities.structuredOutput,
        ) ?? [];
      setModels(available);
      const appDefault =
        available.find((model) => model.id === modelResponse?.defaultModel)?.id ??
        available[0]?.id ??
        null;

      if (isNew) {
        setModelId(appDefault);
      } else {
        const agent: Agent | undefined = agents.find((row) => row.id === id);
        if (!agent) {
          setError('This agent no longer exists.');
          return;
        }
        setName(agent.name);
        setRole(agent.role ?? '');
        setInstructions(agent.instructions ?? '');
        setAvatar(agent.avatar);
        // Switch tab based on existing avatar
        if (agent.avatar.type === 'image') {
          setAvatarTab('upload');
        } else if (CREATURE_SHAPES.includes(agent.avatar.value as CreatureShape)) {
          setAvatarTab('creature');
        } else {
          setAvatarTab('icon');
        }
        setIsSupervisor(agent.isSupervisor);
        setToolCount(agent.toolCount);
        setAssignedSkillIds(
          new Set(allSkills.filter((skill) => skill.assignedAgentIds.includes(id)).map((skill) => skill.id)),
        );
        setModelId(
          agent.model && available.some((model) => model.id === agent.model)
            ? agent.model
            : appDefault,
        );
        setFallbacks(agent.fallbackModels.filter((saved) => available.some((m) => m.id === saved)));
      }
      setError(null);
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setLoading(false);
      setSkillsLoading(false);
    }
  }, [id, isNew]);

  useFocusEffect(
    useCallback(() => {
      void load();
    }, [load]),
  );

  const pickIcon = useCallback((iconKey: string) => {
    setAvatar((current) => ({
      type: 'icon',
      value: iconKey,
      color: current.color ?? colors.mark.purple,
    }));
  }, []);

  const pickCreature = useCallback((shape: CreatureShape) => {
    setAvatar((current) => ({
      type: 'icon',
      value: shape,
      color: current.color ?? colors.mark.purple,
    }));
  }, []);

  const pickColor = useCallback((color: string) => {
    setAvatar((current) => ({ ...current, color }));
  }, []);

  /** Skill assignments save immediately (the server replaces the whole set). */
  const toggleSkill = useCallback(
    async (skillId: string, next: boolean) => {
      if (isNew) return;
      const previous = assignedSkillIds;
      const updated = new Set(previous);
      if (next) updated.add(skillId);
      else updated.delete(skillId);
      setAssignedSkillIds(updated);
      try {
        await setAgentSkills(id, [...updated]);
      } catch (err) {
        setAssignedSkillIds(previous);
        RNAlert.alert('Could not update skills', err instanceof Error ? err.message : String(err));
      }
    },
    [assignedSkillIds, id, isNew],
  );

  /** Uploads photo via signed storage URL */
  const handleUploadAvatar = useCallback(async () => {
    if (isNew) return;
    setUploadingAvatar(true);
    try {
      const path = await uploadAgentAvatar(id);
      if (!path) return;
      const saved = await updateAgent(id, {
        avatar: {
          type: 'image',
          value: path,
          ...(avatar.color ? { color: avatar.color } : {}),
        },
      });
      setAvatar(saved.avatar);
    } catch (err) {
      RNAlert.alert('Could not upload avatar', err instanceof Error ? err.message : String(err));
    } finally {
      setUploadingAvatar(false);
    }
  }, [avatar.color, id, isNew]);

  const handleSave = useCallback(async () => {
    const trimmed = name.trim();
    if (!trimmed) {
      RNAlert.alert('Name required', 'Please give the agent a name.');
      return;
    }
    setSaving(true);
    try {
      const payload = {
        name: trimmed,
        role: role.trim() || null,
        instructions: instructions.trim() || null,
        model: modelId,
        fallbackModels: fallbacks,
        avatar,
        isSupervisor,
      };
      if (isNew) await createAgent(payload);
      else await updateAgent(id, payload);
      router.back();
    } catch (err) {
      RNAlert.alert('Could not save', err instanceof Error ? err.message : String(err));
    } finally {
      setSaving(false);
    }
  }, [avatar, fallbacks, instructions, isSupervisor, isNew, id, modelId, name, role, router]);

  const handleDelete = useCallback(() => {
    RNAlert.alert(
      'Delete this agent?',
      'MCP integrations attached to it will be unlinked. Run history will be preserved.',
      [
        { text: 'Cancel', style: 'cancel' },
        {
          text: 'Delete',
          style: 'destructive',
          onPress: () => {
            void (async () => {
              try {
                await deleteAgent(id);
                router.back();
              } catch (err) {
                RNAlert.alert('Could not delete', err instanceof Error ? err.message : String(err));
              }
            })();
          },
        },
      ],
    );
  }, [id, router]);

  const handleBack = useCallback(() => {
    if (router.canGoBack()) {
      router.back();
    } else {
      router.replace('/agents' as never);
    }
  }, [router]);

  return (
    <KeyboardAvoidingView
      style={{ flex: 1, backgroundColor: colors.background }}
      behavior={Platform.OS === 'ios' ? 'padding' : undefined}
    >
      <AppHeader
        left={
          <RoundButton
            icon={ChevronLeft}
            onPress={handleBack}
            accessibilityLabel="Cancel"
          />
        }
        center={
          <Text style={styles.headerTitle}>
            {isNew ? 'Create Agent' : 'Edit Agent'}
          </Text>
        }
        right={
          <PillButton
            label={saving ? 'Saving…' : 'Save'}
            onPress={() => void handleSave()}
            disabled={saving || loading}
            variant="primary"
          />
        }
      />

      {loading ? (
        <View style={styles.center}>
          <Spinner size="lg" color="default" />
        </View>
      ) : (
        <ScrollView
          contentContainerStyle={{
            padding: space.lg,
            paddingBottom: insets.bottom + space.xxl,
            gap: space.xl,
          }}
          keyboardShouldPersistTaps="handled"
        >
          {error ? (
            <View style={styles.errorBox}>
              <Text style={styles.errorText}>{error}</Text>
            </View>
          ) : null}

          {/* Top Live Preview Hero Card */}
          <GroupedCard style={styles.heroCard}>
            <View style={{ width: 84, height: 84, alignItems: 'center', justifyContent: 'center' }}>
              <AgentAvatar avatar={avatar} name={name || 'Agent'} size={76} />
            </View>
            <Text numberOfLines={1} style={styles.heroName}>
              {name.trim() || 'Agent Name'}
            </Text>
            <Text numberOfLines={1} style={styles.heroRole}>
              {role.trim() || (isSupervisor ? 'Supervisor' : 'Specialist Agent')}
            </Text>
          </GroupedCard>

          {/* Avatar Customization Card */}
          <View style={{ gap: space.xs }}>
            <SectionLabel text="Avatar Customization" />
            <GroupedCard style={{ padding: space.lg, gap: space.md }}>
              {/* Mode Switcher Pills: Icons · Creatures · Photo */}
              <View style={styles.tabTrack}>
                {(['icon', 'creature', 'upload'] as const).map((tab) => {
                  const active = avatarTab === tab;
                  const label = tab === 'icon' ? 'Icons' : tab === 'creature' ? 'Creatures' : 'Photo';
                  return (
                    <Pressable
                      key={tab}
                      onPress={() => setAvatarTab(tab)}
                      disabled={tab === 'upload' && isNew}
                      accessibilityRole="button"
                      accessibilityState={{ selected: active }}
                      style={[
                        styles.tabSegment,
                        active && styles.tabSegmentActive,
                        active && shadow.floating,
                        tab === 'upload' && isNew && { opacity: 0.4 },
                      ]}
                    >
                      <Text
                        style={[
                          styles.tabSegmentText,
                          active && styles.tabSegmentTextActive,
                        ]}
                      >
                        {label}
                      </Text>
                    </Pressable>
                  );
                })}
              </View>

              {/* Tab 1: Vector Lucide Icons */}
              {avatarTab === 'icon' && (
                <View style={styles.iconGrid}>
                  {ICON_CHOICES.map((iconKey) => {
                    const IconComp = AVATAR_ICONS[iconKey];
                    if (!IconComp) return null;
                    const isSelected = avatar.type === 'icon' && avatar.value === iconKey;
                    return (
                      <Pressable
                        key={iconKey}
                        onPress={() => pickIcon(iconKey)}
                        accessibilityLabel={`Select ${iconKey} icon`}
                        accessibilityRole="button"
                        style={[
                          styles.iconTile,
                          isSelected && styles.iconTileSelected,
                        ]}
                      >
                        <IconComp
                          size={20}
                          color={isSelected ? colors.textPrimary : colors.textSecondary}
                          strokeWidth={2}
                        />
                      </Pressable>
                    );
                  })}
                </View>
              )}

              {/* Tab 2: Organic Creature Shapes */}
              {avatarTab === 'creature' && (
                <View style={styles.iconGrid}>
                  {CREATURE_SHAPES.map((shape) => {
                    const isSelected = avatar.type === 'icon' && avatar.value === shape;
                    return (
                      <Pressable
                        key={shape}
                        onPress={() => pickCreature(shape)}
                        accessibilityLabel={`Select ${shape} creature shape`}
                        accessibilityRole="button"
                        style={[
                          styles.creatureTile,
                          isSelected && styles.creatureTileSelected,
                        ]}
                      >
                        <AgentAvatar
                          avatar={{ type: 'icon', value: shape, color: avatar.color }}
                          size={34}
                        />
                      </Pressable>
                    );
                  })}
                </View>
              )}

              {/* Tab 3: Photo Upload */}
              {avatarTab === 'upload' && (
                <View style={{ paddingVertical: space.xs, gap: space.sm }}>
                  {isNew ? (
                    <Text style={styles.fieldHelp}>
                      Create the agent first, then you can upload a custom photo.
                    </Text>
                  ) : (
                    <>
                      <Pressable
                        onPress={() => void handleUploadAvatar()}
                        disabled={uploadingAvatar}
                        accessibilityRole="button"
                        style={styles.uploadButton}
                      >
                        {uploadingAvatar ? (
                          <Spinner size="sm" color="default" />
                        ) : (
                          <>
                            <Upload size={16} color={colors.textSecondary} />
                            <Text style={styles.uploadButtonText}>
                              {avatar.type === 'image' ? 'Replace Photo' : 'Upload Photo'}
                            </Text>
                          </>
                        )}
                      </Pressable>
                      <Text style={[styles.fieldHelp, { textAlign: 'center' }]}>
                        Stored securely in your private avatar bucket.
                      </Text>
                    </>
                  )}
                </View>
              )}

              {/* Signature Color Swatches Row */}
              <View style={styles.paletteSection}>
                <Text style={styles.paletteLabel}>Theme Color</Text>
                <View style={styles.paletteRow}>
                  {PALETTE_COLORS.map((color) => {
                    const isSelected = avatar.color === color;
                    return (
                      <Pressable
                        key={color}
                        onPress={() => pickColor(color)}
                        accessibilityLabel={`Pick color ${color}`}
                        accessibilityRole="button"
                        style={[
                          styles.colorCircle,
                          { backgroundColor: color },
                          isSelected && styles.colorCircleSelected,
                        ]}
                      >
                        {isSelected && <Check size={14} color={colors.onPrimary} strokeWidth={3} />}
                      </Pressable>
                    );
                  })}
                </View>
              </View>
            </GroupedCard>
          </View>

          {/* Form Fields Section */}
          <View style={{ gap: space.lg }}>
            {/* Name */}
            <View style={{ gap: space.xs }}>
              <SectionLabel text="Agent Name" />
              <TextInput
                value={name}
                onChangeText={setName}
                placeholder="e.g. Sales Outbound, Talent Scout, EA"
                placeholderTextColor={colors.textSecondary}
                style={styles.input}
              />
            </View>

            {/* Role / Short Bio */}
            <View style={{ gap: space.xs }}>
              <SectionLabel text="Role / Specialty" />
              <TextInput
                value={role}
                onChangeText={setRole}
                placeholder="e.g. Executive assistant, Lead prospecting"
                placeholderTextColor={colors.textSecondary}
                style={styles.input}
              />
            </View>

            {/* Instructions */}
            <View style={{ gap: space.xs }}>
              <SectionLabel text="System Instructions & Behavior" />
              <TextInput
                value={instructions}
                onChangeText={setInstructions}
                placeholder="Describe how the agent should think, analyze, research, and format responses…"
                placeholderTextColor={colors.textSecondary}
                multiline
                numberOfLines={4}
                textAlignVertical="top"
                style={[styles.input, styles.multilineInput]}
              />
            </View>

            {/* Skills: assign reusable instruction bundles */}
            <View style={{ gap: space.xs }}>
              <SectionLabel text="Skills" />
              <GroupedCard style={{ padding: space.lg, gap: space.md }}>
                <View style={{ flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between' }}>
                  <View style={{ flex: 1, paddingRight: space.md }}>
                    <Text style={styles.fieldTitle}>Instruction Bundles</Text>
                    <Text style={styles.fieldSubtitle}>
                      Reusable instruction bundles loaded on demand.
                    </Text>
                  </View>
                  <RoundButton
                    icon={BookMarked}
                    onPress={() => router.push('/skills')}
                    accessibilityLabel="Manage skills"
                  />
                </View>

                {isNew ? (
                  <Text style={styles.fieldHelp}>
                    Save the agent first, then come back to assign skills.
                  </Text>
                ) : skillsLoading ? (
                  <Spinner size="sm" color="default" />
                ) : skills.length === 0 ? (
                  <Pressable
                    onPress={() => router.push('/skills')}
                    accessibilityRole="button"
                    style={styles.emptySkillsBox}
                  >
                    <Text style={styles.emptySkillsText}>
                      No skills yet — tap to create one
                    </Text>
                  </Pressable>
                ) : (
                  skills.map((skill, index) => (
                    <React.Fragment key={skill.id}>
                      {index > 0 && <HairlineDivider />}
                      <View style={styles.skillRow}>
                        <View style={{ flex: 1, minWidth: 0 }}>
                          <Text numberOfLines={1} style={styles.skillName}>
                            {skill.name}
                          </Text>
                          <Text numberOfLines={1} style={styles.skillDescription}>
                            {skill.description}
                          </Text>
                        </View>
                        <Switch
                          isSelected={assignedSkillIds.has(skill.id)}
                          onSelectedChange={(next) => void toggleSkill(skill.id, next)}
                          accessibilityLabel={`Assign skill ${skill.name}`}
                        />
                      </View>
                    </React.Fragment>
                  ))
                )}
              </GroupedCard>
            </View>

            {/* Supervisor Toggle Card */}
            <View style={{ gap: space.xs }}>
              <SectionLabel text="Orchestration" />
              <GroupedCard style={{ padding: space.lg, flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between' }}>
                <View style={{ flex: 1, paddingRight: space.lg }}>
                  <Text style={styles.fieldTitle}>Supervisor Mode</Text>
                  <Text style={styles.fieldSubtitle}>
                    Orchestrates specialist agents in parallel, cross-checks results, and merges reports.
                  </Text>
                </View>
                <Switch
                  isSelected={isSupervisor}
                  onSelectedChange={setIsSupervisor}
                  accessibilityLabel="Toggle supervisor mode"
                />
              </GroupedCard>
            </View>

            {/* Preferred Model Card */}
            <View style={{ gap: space.xs }}>
              <SectionLabel text="Model" />
              <GroupedCard style={{ padding: space.lg }}>
                <View style={{ flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between' }}>
                  <View style={{ flex: 1, paddingRight: space.md }}>
                    <Text style={styles.fieldTitle}>Primary Model</Text>
                    <Text style={styles.fieldSubtitle}>
                      Model used for runs and responses
                    </Text>
                  </View>
                  <ModelPicker models={models} selectedId={modelId} onSelect={setModelId} />
                </View>
              </GroupedCard>
            </View>
          </View>

          {/* Danger Zone: Delete button (Edit mode only) */}
          {!isNew && (
            <View style={{ paddingTop: space.xs }}>
              <Pressable
                onPress={handleDelete}
                accessibilityRole="button"
                accessibilityLabel="Delete agent"
                style={styles.deleteButton}
              >
                <Trash2 size={16} color={colors.recording} />
                <Text style={styles.deleteButtonText}>Delete Agent</Text>
              </Pressable>
            </View>
          )}
        </ScrollView>
      )}
    </KeyboardAvoidingView>
  );
}

const styles = StyleSheet.create({
  center: {
    flex: 1,
    alignItems: 'center',
    justifyContent: 'center',
  },
  headerTitle: {
    fontSize: 20,
    lineHeight: 26,
    fontWeight: '600',
    color: colors.textPrimary,
  },
  errorBox: {
    backgroundColor: colors.recordingBg,
    borderRadius: radius.card,
    padding: space.lg,
  },
  errorText: {
    color: colors.recording,
    fontSize: 15,
    textAlign: 'center',
  },
  heroCard: {
    alignItems: 'center',
    justifyContent: 'center',
    padding: space.xl,
  },
  heroName: {
    marginTop: space.md,
    fontSize: 20,
    lineHeight: 26,
    fontWeight: '600',
    color: colors.textPrimary,
  },
  heroRole: {
    marginTop: 2,
    fontSize: 15,
    lineHeight: 20,
    color: colors.textSecondary,
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
  },
  tabSegmentTextActive: {
    color: colors.textPrimary,
    fontWeight: '600',
  },
  iconGrid: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: space.sm,
    paddingTop: space.xs,
  },
  iconTile: {
    width: 44,
    height: 44,
    alignItems: 'center',
    justifyContent: 'center',
    borderRadius: radius.tile,
    backgroundColor: colors.surfaceRaised,
  },
  iconTileSelected: {
    backgroundColor: colors.primary,
  },
  creatureTile: {
    width: 48,
    height: 48,
    alignItems: 'center',
    justifyContent: 'center',
    borderRadius: radius.tile,
    backgroundColor: colors.surfaceRaised,
  },
  creatureTileSelected: {
    backgroundColor: colors.surface,
  },
  uploadButton: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: space.sm,
    backgroundColor: colors.surfaceRaised,
    borderRadius: radius.card,
    paddingVertical: space.md,
  },
  uploadButtonText: {
    fontSize: 15,
    fontWeight: '600',
    color: colors.textPrimary,
  },
  paletteSection: {
    borderTopWidth: StyleSheet.hairlineWidth,
    borderTopColor: colors.divider,
    paddingTop: space.md,
  },
  paletteLabel: {
    fontSize: 13,
    fontWeight: '500',
    color: colors.textSecondary,
    marginBottom: space.sm,
  },
  paletteRow: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: space.sm,
  },
  colorCircle: {
    width: 28,
    height: 28,
    borderRadius: radius.pill,
    alignItems: 'center',
    justifyContent: 'center',
  },
  colorCircleSelected: {
    borderWidth: 2.5,
    borderColor: colors.surfaceRaised,
  },
  input: {
    backgroundColor: colors.surface,
    borderRadius: radius.card,
    paddingHorizontal: space.lg,
    paddingVertical: space.md,
    fontSize: 17,
    color: colors.textPrimary,
  },
  multilineInput: {
    minHeight: 100,
    textAlignVertical: 'top',
    lineHeight: 22,
  },
  fieldTitle: {
    fontSize: 17,
    fontWeight: '500',
    color: colors.textPrimary,
  },
  fieldSubtitle: {
    fontSize: 13,
    color: colors.textSecondary,
    marginTop: 2,
    lineHeight: 18,
  },
  fieldHelp: {
    fontSize: 13,
    color: colors.textSecondary,
    lineHeight: 18,
  },
  emptySkillsBox: {
    paddingVertical: space.md,
    alignItems: 'center',
  },
  emptySkillsText: {
    fontSize: 14,
    color: colors.textSecondary,
  },
  skillRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    gap: space.md,
    paddingVertical: space.xs,
  },
  skillName: {
    fontSize: 16,
    fontWeight: '500',
    color: colors.textPrimary,
  },
  skillDescription: {
    fontSize: 13,
    color: colors.textSecondary,
    marginTop: 2,
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
