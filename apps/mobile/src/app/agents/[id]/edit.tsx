import type { Agent, AgentAvatar as AgentAvatarType, Skill } from '@agent/shared';
import { useCallback, useMemo, useState } from 'react';
import {
  Alert as RNAlert,
  FlatList,
  KeyboardAvoidingView,
  Platform,
  Pressable,
  StyleSheet,
  Text,
  TextInput,
  View,
} from 'react-native';
import { Spinner, Switch } from 'heroui-native';
import { useFocusEffect, useLocalSearchParams, useRouter } from 'expo-router';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { BookMarked, Check, ChevronLeft, ChevronRight, Blocks, Trash2, Upload, Wrench } from 'lucide-react-native';
import { SymbolIcon } from '@/components/symbol-icon';

import { AppHeader, useHeaderInset } from '@/components/app-header';
import { AgentToolsSheet } from '@/components/agent-tools-sheet';
import { reportAppError } from '@/components/error-dialog-provider';
import {
  GroupedCard,
  HairlineDivider,
  InlineError,
  PillButton,
  RoundButton,
  SectionLabel,
} from '@/components/design-system';
import { colors, radius, shadow, space } from '@/theme';
import { hapticSelect } from '@/lib/haptics';
import {
  AgentAvatar,
  AVATAR_ICONS,
  CREATURE_SHAPES,
  PALETTE_COLORS,
  PICKABLE_AVATAR_ICONS,
  PICKABLE_CREATURE_SHAPES,
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

const ICON_CHOICES = PICKABLE_AVATAR_ICONS;

/**
 * The Skills card is split into virtualized slices so a long skill list does
 * not render every row at once: one head slice (the card's title row), then
 * one slice per skill — or a single state slice when there is nothing to
 * list. The slices stack into one continuous card: the head slice carries the
 * top corners, the last slice the bottom ones.
 */
type SkillCell =
  | { kind: 'head' }
  | { kind: 'state' }
  | { kind: 'skill'; skill: Skill; isFirst: boolean; isLast: boolean };

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
  const [toolsSheetOpen, setToolsSheetOpen] = useState(false);
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
    hapticSelect();
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
        reportAppError(err, { title: 'Could not update skills' });
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
      reportAppError(err, { title: 'Could not upload avatar' });
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
      reportAppError(err, { title: 'Could not save agent' });
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
                reportAppError(err, { title: 'Could not delete agent' });
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

  const headerInset = useHeaderInset();

  const skillCells = useMemo<SkillCell[]>(() => {
    if (isNew || skillsLoading || skills.length === 0) {
      return [{ kind: 'head' }, { kind: 'state' }];
    }
    return [
      { kind: 'head' },
      ...skills.map((skill, index): SkillCell => ({
        kind: 'skill',
        skill,
        isFirst: index === 0,
        isLast: index === skills.length - 1,
      })),
    ];
  }, [isNew, skillsLoading, skills]);

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
            {isNew ? 'Create agent' : 'Edit agent'}
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
        <FlatList
          data={skillCells}
          keyExtractor={(cell, index) =>
            cell.kind === 'skill' ? cell.skill.id : `${cell.kind}-${index}`
          }
          renderItem={({ item: cell }) => {
            if (cell.kind === 'head') {
              return (
                <View style={[styles.cardSlice, styles.cardSliceTop, styles.cardSliceHead]}>
                  <View style={styles.skillsHeadRow}>
                    <View style={{ flex: 1, paddingRight: space.md }}>
                      <Text style={styles.fieldTitle}>Instruction bundles</Text>
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
                </View>
              );
            }

            if (cell.kind === 'state') {
              return (
                <View style={[styles.cardSlice, styles.cardSliceBottom, styles.cardSliceState]}>
                  {isNew ? (
                    <Text style={styles.fieldHelp}>
                      Save the agent first, then come back to assign skills.
                    </Text>
                  ) : skillsLoading ? (
                    <Spinner size="sm" color="default" />
                  ) : (
                    <Pressable
                      onPress={() => router.push('/skills')}
                      accessibilityRole="button"
                      style={styles.emptySkillsBox}
                    >
                      <Text style={styles.emptySkillsText}>
                        No skills yet — tap to create one
                      </Text>
                    </Pressable>
                  )}
                </View>
              );
            }

            return (
              <View
                style={[
                  styles.cardSlice,
                  !cell.isFirst && styles.cardSliceSkillSpaced,
                  cell.isLast && styles.cardSliceBottom,
                  cell.isLast && styles.cardSliceSkillLast,
                ]}
              >
                {cell.isFirst ? null : (
                  <>
                    <HairlineDivider />
                    <View style={{ height: space.md }} />
                  </>
                )}
                <View style={styles.skillRow}>
                  <View style={{ flex: 1, minWidth: 0 }}>
                    <Text numberOfLines={1} style={styles.skillName}>
                      {cell.skill.name}
                    </Text>
                    <Text numberOfLines={1} style={styles.skillDescription}>
                      {cell.skill.description}
                    </Text>
                  </View>
                  <Switch
                    isSelected={assignedSkillIds.has(cell.skill.id)}
                    onSelectedChange={(next) => void toggleSkill(cell.skill.id, next)}
                    accessibilityLabel={`Assign skill ${cell.skill.name}`}
                  />
                </View>
              </View>
            );
          }}
          ListHeaderComponent={
            <View>
              {error ? (
                <View style={{ marginBottom: space.xl }}>
                  <InlineError message={error} onRetry={() => void load()} />
                </View>
              ) : null}

              {/* Top Live Preview Hero Card */}
              <GroupedCard style={[styles.heroCard, { marginBottom: space.xl }]}>
                <View style={{ width: 84, height: 84, alignItems: 'center', justifyContent: 'center' }}>
                  <AgentAvatar avatar={avatar} name={name || 'Agent'} size={76} />
                </View>
                <Text numberOfLines={1} style={styles.heroName}>
                  {name.trim() || 'Agent name'}
                </Text>
                <Text numberOfLines={1} style={styles.heroRole}>
                  {role.trim() || (isSupervisor ? 'Supervisor' : 'Specialist agent')}
                </Text>
              </GroupedCard>

              {/* Avatar Customization Card */}
              <View style={{ marginBottom: space.xl }}>
                <SectionLabel text="Avatar customization" />
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
                      {PICKABLE_CREATURE_SHAPES.map((shape) => {
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
                                <SymbolIcon icon={Upload} size={16} color={colors.textSecondary} />
                                <Text style={styles.uploadButtonText}>
                                  {avatar.type === 'image' ? 'Replace photo' : 'Upload photo'}
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
                    <Text style={styles.paletteLabel}>Theme color</Text>
                    <View style={styles.paletteRow}>
                      {PALETTE_COLORS.map((color) => {
                        const isSelected = avatar.color === color;
                        return (
                          <Pressable
                            key={color}
                            onPress={() => pickColor(color)}
                            accessibilityLabel={`Pick color ${color}`}
                            accessibilityRole="button"
                            hitSlop={8}
                            style={({ pressed }) => [
                              styles.colorCircle,
                              { backgroundColor: color },
                              isSelected && styles.colorCircleSelected,
                              { opacity: pressed ? 0.6 : 1 },
                            ]}
                          >
                            {isSelected && <SymbolIcon icon={Check} size={14} color={colors.onPrimary} strokeWidth={3} />}
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
                <View>
                  <SectionLabel text="Agent name" />
                  <TextInput
                    value={name}
                    onChangeText={setName}
                    placeholder="e.g. Sales Outbound, Talent Scout, EA"
                    placeholderTextColor={colors.textSecondary}
                    style={styles.input}
                  />
                </View>

                {/* Role / Short Bio */}
                <View>
                  <SectionLabel text="Role / specialty" />
                  <TextInput
                    value={role}
                    onChangeText={setRole}
                    placeholder="e.g. Executive assistant, Lead prospecting"
                    placeholderTextColor={colors.textSecondary}
                    style={styles.input}
                  />
                </View>

                {/* Instructions */}
                <View>
                  <SectionLabel text="System instructions & behavior" />
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

              {/* Skills: assign reusable instruction bundles. The label closes
                  the header; the card itself is the virtualized list below. */}
              </View>

              <SectionLabel
                text="Skills"
                style={{ marginTop: space.lg, marginBottom: space.sm }}
              />
            </View>
          }
          ListFooterComponent={
            <View style={{ marginTop: space.lg }}>
              <View style={{ gap: space.lg }}>
                {/* Integrations & Tools Section (Opens Bottom Sheet) */}
                <View>
                  <SectionLabel text="Integrations & tools" />
                  <GroupedCard style={{ padding: space.lg, gap: space.md }}>
                    <View style={{ flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between' }}>
                      <View style={{ flex: 1, paddingRight: space.md }}>
                        <Text style={styles.fieldTitle}>External tools</Text>
                        <Text style={styles.fieldSubtitle}>
                          {isNew
                            ? 'Save the agent first, then configure its tools and integrations.'
                            : toolCount > 0
                              ? `${toolCount} tools active across integrations`
                              : 'No tools enabled yet'}
                        </Text>
                      </View>
                      {!isNew && (
                        <RoundButton
                          icon={Wrench}
                          onPress={() => setToolsSheetOpen(true)}
                          accessibilityLabel="Manage integrations and tools"
                        />
                      )}
                    </View>

                    {isNew ? (
                      <Text style={styles.fieldHelp}>
                        Save the agent first, then come back to turn integrations and tools on or off.
                      </Text>
                    ) : (
                      <Pressable
                        onPress={() => setToolsSheetOpen(true)}
                        accessibilityRole="button"
                        accessibilityLabel="Open integrations and tools bottom sheet"
                        style={({ pressed }) => [
                          styles.toolsActionRow,
                          { opacity: pressed ? 0.6 : 1 },
                        ]}
                      >
                        <View style={styles.toolsActionLeft}>
                          <SymbolIcon icon={Blocks} size={20} color={colors.textSecondary} strokeWidth={1.75} />
                          <Text style={styles.toolsActionText}>
                            {toolCount > 0
                              ? `View & manage ${toolCount} active tools`
                              : 'Select integrations & tools'}
                          </Text>
                        </View>
                        <SymbolIcon icon={ChevronRight} size={17} color={colors.textSecondary} strokeWidth={2} />
                      </Pressable>
                    )}
                  </GroupedCard>
                </View>

                {/* Supervisor Toggle Card */}
                <View>
                  <SectionLabel text="Orchestration" />
                  <GroupedCard style={{ padding: space.lg, flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between' }}>
                    <View style={{ flex: 1, paddingRight: space.lg }}>
                      <Text style={styles.fieldTitle}>Supervisor mode</Text>
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
                <View>
                  <SectionLabel text="Model" />
                  <GroupedCard style={{ padding: space.lg }}>
                    <View style={{ flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between' }}>
                      <View style={{ flex: 1, paddingRight: space.md }}>
                        <Text style={styles.fieldTitle}>Primary model</Text>
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
                <View style={{ marginTop: space.xl, paddingTop: space.xs }}>
                  <Pressable
                    onPress={handleDelete}
                    accessibilityRole="button"
                    accessibilityLabel="Delete agent"
                    style={styles.deleteButton}
                  >
                    <SymbolIcon icon={Trash2} size={16} color={colors.danger} />
                    <Text style={styles.deleteButtonText}>Delete agent</Text>
                  </Pressable>
                </View>
              )}
            </View>
          }
          contentContainerStyle={{
            paddingTop: headerInset,
            paddingHorizontal: space.lg,
            paddingBottom: insets.bottom + space.xxl,
          }}
          keyboardShouldPersistTaps="handled"
        />
      )}

      {/* Integrations & Tools Bottom Sheet */}
      {!isNew && (
        <AgentToolsSheet
          agentId={id}
          agentName={name}
          visible={toolsSheetOpen}
          onClose={() => setToolsSheetOpen(false)}
          onToolCountChanged={(count) => setToolCount(count)}
        />
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
      fontVariant: ['tabular-nums'],
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
    // The Skills card is rendered as stacked slices so the rows can be
    // virtualized. The slices share one background and between them carry the
    // card's rounded corners, so they read as a single card.
    cardSlice: {
      backgroundColor: colors.surface,
      paddingHorizontal: space.lg,
    },
    cardSliceTop: {
      borderTopLeftRadius: radius.card,
      borderTopRightRadius: radius.card,
    },
    cardSliceBottom: {
      borderBottomLeftRadius: radius.card,
      borderBottomRightRadius: radius.card,
    },
    cardSliceHead: {
      paddingTop: space.lg,
      // The card's 12pt gap between the head row and the first body row.
      paddingBottom: space.md,
    },
    cardSliceState: {
      paddingBottom: space.lg,
    },
    cardSliceSkillSpaced: {
      // The card's 12pt gap above the hairline that follows the previous row.
      paddingTop: space.md,
    },
    cardSliceSkillLast: {
      paddingBottom: space.lg,
    },
    skillsHeadRow: {
      flexDirection: 'row',
      alignItems: 'center',
      justifyContent: 'space-between',
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
    backgroundColor: colors.surface,
    borderRadius: radius.card,
    paddingVertical: space.md,
  },
  deleteButtonText: {
    fontSize: 15,
    fontWeight: '600',
    color: colors.danger,
  },
  toolsActionRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    backgroundColor: colors.surfaceRaised,
    borderRadius: radius.card,
    paddingHorizontal: space.md,
    paddingVertical: space.md,
    marginTop: space.xs,
  },
  toolsActionLeft: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: space.sm,
  },
  toolsActionText: {
    fontSize: 15,
    fontWeight: '500',
    color: colors.textPrimary,
    fontVariant: ['tabular-nums'],
  },
});
