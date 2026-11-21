import type { Agent, AgentAvatar as AgentAvatarType, Skill } from '@agent/shared';
import { DEFAULT_AGENT_AVATAR } from '@agent/shared';
import { useCallback, useState } from 'react';
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
import { Button, Chip, Spinner, Switch, Typography } from 'heroui-native';
import { useFocusEffect, useLocalSearchParams, useRouter } from 'expo-router';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { BookMarked, Check, Trash2, Upload } from 'lucide-react-native';

import { AppHeader } from '@/components/app-header';
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
    color: '#8B5CF6',
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
      color: current.color ?? '#8B5CF6',
    }));
  }, []);

  const pickCreature = useCallback((shape: CreatureShape) => {
    setAvatar((current) => ({
      type: 'icon',
      value: shape,
      color: current.color ?? '#8B5CF6',
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

  return (
    <KeyboardAvoidingView
      className="flex-1 bg-white dark:bg-[#09090b]"
      behavior={Platform.OS === 'ios' ? 'padding' : undefined}
    >
      <AppHeader
        left={
          <Pressable
            onPress={() => router.back()}
            accessibilityRole="button"
            accessibilityLabel="Cancel"
            className="px-2 py-1 active:opacity-60"
          >
            <Typography type="body" className="text-zinc-500 dark:text-zinc-400">
              Cancel
            </Typography>
          </Pressable>
        }
        center={
          <Typography type="body" weight="semibold" className="text-zinc-900 dark:text-white">
            {isNew ? 'Create Agent' : 'Edit Agent'}
          </Typography>
        }
        right={
          <Button
            size="sm"
            variant="primary"
            className="rounded-full px-4"
            isDisabled={saving || loading}
            onPress={() => void handleSave()}
            accessibilityRole="button"
            accessibilityLabel="Save agent"
          >
            {saving ? <Spinner size="sm" color="default" /> : <Button.Label>Save</Button.Label>}
          </Button>
        }
      />

      {loading ? (
        <View className="flex-1 items-center justify-center">
          <Spinner size="lg" color="default" />
        </View>
      ) : (
        <ScrollView
          contentContainerStyle={{ padding: 20, paddingBottom: insets.bottom + 32, gap: 24 }}
          keyboardShouldPersistTaps="handled"
        >
          {error ? (
            <Typography type="body-sm" className="text-red-500 text-center">
              {error}
            </Typography>
          ) : null}

          {/* Top Live Preview Hero Card */}
          <View className="items-center justify-center rounded-3xl border border-zinc-200 dark:border-white/10 bg-zinc-50 dark:bg-[#121215] p-6 shadow-sm">
            <View className="items-center justify-center" style={{ width: 84, height: 84 }}>
              <AgentAvatar avatar={avatar} name={name || 'Agent'} size={76} />
            </View>
            <Text
              numberOfLines={1}
              className="mt-3 text-lg font-bold text-zinc-900 dark:text-white"
            >
              {name.trim() || 'Agent Name'}
            </Text>
            <Text
              numberOfLines={1}
              className="mt-0.5 text-xs text-zinc-500 dark:text-zinc-400"
            >
              {role.trim() || (isSupervisor ? 'Supervisor' : 'Specialist Agent')}
            </Text>
          </View>

          {/* Avatar Customization Card */}
          <View className="rounded-3xl border border-zinc-200 dark:border-white/10 bg-zinc-50 dark:bg-[#121215] p-4 gap-4">
            <Text className="text-xs font-semibold uppercase tracking-wider text-zinc-400 dark:text-zinc-500">
              Avatar Customization
            </Text>

            {/* Mode Switcher Pills: Icons · Creatures · Photo */}
            <View className="flex-row rounded-full border border-zinc-200 dark:border-white/10 bg-zinc-100 dark:bg-white/5 p-1 gap-1">
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
                    className={`flex-1 items-center justify-center rounded-full py-1.5 transition-all ${
                      active
                        ? 'bg-white dark:bg-white/15 shadow-sm'
                        : 'bg-transparent'
                    } ${tab === 'upload' && isNew ? 'opacity-40' : ''}`}
                  >
                    <Text
                      className={`text-xs font-semibold ${
                        active
                          ? 'text-zinc-900 dark:text-white'
                          : 'text-zinc-500 dark:text-zinc-400'
                      }`}
                    >
                      {label}
                    </Text>
                  </Pressable>
                );
              })}
            </View>

            {/* Tab 1: Vector Lucide Icons */}
            {avatarTab === 'icon' && (
              <View className="flex-row flex-wrap justify-between gap-2.5 pt-1">
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
                      className={`h-11 w-11 items-center justify-center rounded-2xl border transition-all active:opacity-75 ${
                        isSelected
                          ? 'border-2 border-zinc-900 dark:border-white bg-zinc-200 dark:bg-white/20'
                          : 'border-zinc-200 dark:border-white/10 bg-white dark:bg-white/5'
                      }`}
                    >
                      <IconComp
                        size={20}
                        color={isSelected ? '#000000' : '#71717a'}
                        strokeWidth={2.2}
                      />
                    </Pressable>
                  );
                })}
              </View>
            )}

            {/* Tab 2: Organic Creature Shapes */}
            {avatarTab === 'creature' && (
              <View className="flex-row flex-wrap justify-between gap-2.5 pt-1">
                {CREATURE_SHAPES.map((shape) => {
                  const isSelected = avatar.type === 'icon' && avatar.value === shape;
                  return (
                    <Pressable
                      key={shape}
                      onPress={() => pickCreature(shape)}
                      accessibilityLabel={`Select ${shape} creature shape`}
                      accessibilityRole="button"
                      className={`h-12 w-12 items-center justify-center rounded-2xl border transition-all active:opacity-75 ${
                        isSelected
                          ? 'border-2 border-zinc-900 dark:border-white bg-zinc-200 dark:bg-white/20'
                          : 'border-zinc-200 dark:border-white/10 bg-white dark:bg-white/5'
                      }`}
                    >
                      <AgentAvatar
                        avatar={{ type: 'icon', value: shape, color: avatar.color }}
                        size={36}
                      />
                    </Pressable>
                  );
                })}
              </View>
            )}

            {/* Tab 3: Photo Upload */}
            {avatarTab === 'upload' && (
              <View className="py-2 gap-2">
                {isNew ? (
                  <Text className="text-xs text-zinc-500">
                    Create the agent first, then you can upload a custom photo.
                  </Text>
                ) : (
                  <>
                    <Pressable
                      onPress={() => void handleUploadAvatar()}
                      disabled={uploadingAvatar}
                      accessibilityRole="button"
                      className="flex-row items-center justify-center gap-2 rounded-2xl border border-zinc-200 dark:border-white/15 bg-white dark:bg-white/10 py-3 active:opacity-75"
                    >
                      {uploadingAvatar ? (
                        <Spinner size="sm" color="default" />
                      ) : (
                        <>
                          <Upload size={16} color="#71717a" />
                          <Text className="text-sm font-semibold text-zinc-800 dark:text-zinc-200">
                            {avatar.type === 'image' ? 'Replace Photo' : 'Upload Photo'}
                          </Text>
                        </>
                      )}
                    </Pressable>
                    <Text className="text-xs text-zinc-500 text-center">
                      Stored securely in your private avatar bucket.
                    </Text>
                  </>
                )}
              </View>
            )}

            {/* Signature Color Swatches Row */}
            <View className="border-t border-zinc-200 dark:border-white/10 pt-3">
              <Text className="mb-2 text-xs font-medium text-zinc-500">
                Theme Color
              </Text>
              <View className="flex-row flex-wrap gap-2">
                {PALETTE_COLORS.map((color) => {
                  const isSelected = avatar.color === color;
                  return (
                    <Pressable
                      key={color}
                      onPress={() => pickColor(color)}
                      accessibilityLabel={`Pick color ${color}`}
                      accessibilityRole="button"
                      className="h-7 w-7 items-center justify-center rounded-full active:opacity-75"
                      style={{
                        backgroundColor: color,
                        borderWidth: isSelected ? 2.5 : 0,
                        borderColor: '#FFFFFF',
                      }}
                    >
                      {isSelected && <Check size={13} color="#FFFFFF" strokeWidth={3} />}
                    </Pressable>
                  );
                })}
              </View>
            </View>
          </View>

          {/* Form Fields Section */}
          <View className="gap-4">
            {/* Name */}
            <View>
              <Text className="mb-1.5 text-xs font-semibold uppercase tracking-wider text-zinc-400 dark:text-zinc-500">
                Agent Name
              </Text>
              <TextInput
                value={name}
                onChangeText={setName}
                placeholder="e.g. Sales Outbound, Talent Scout, EA"
                placeholderTextColor="#71717a"
                className="rounded-2xl border border-zinc-200 dark:border-white/10 bg-zinc-50 dark:bg-[#121215] px-4 py-3 text-base text-zinc-900 dark:text-white"
              />
            </View>

            {/* Role / Short Bio */}
            <View>
              <Text className="mb-1.5 text-xs font-semibold uppercase tracking-wider text-zinc-400 dark:text-zinc-500">
                Role / Specialty
              </Text>
              <TextInput
                value={role}
                onChangeText={setRole}
                placeholder="e.g. Executive assistant, Lead prospecting"
                placeholderTextColor="#71717a"
                className="rounded-2xl border border-zinc-200 dark:border-white/10 bg-zinc-50 dark:bg-[#121215] px-4 py-3 text-base text-zinc-900 dark:text-white"
              />
            </View>

            {/* Instructions */}
            <View>
              <Text className="mb-1.5 text-xs font-semibold uppercase tracking-wider text-zinc-400 dark:text-zinc-500">
                System Instructions & Behavior
              </Text>
              <TextInput
                value={instructions}
                onChangeText={setInstructions}
                placeholder="Describe how the agent should think, analyze, research, and format responses…"
                placeholderTextColor="#71717a"
                multiline
                numberOfLines={4}
                textAlignVertical="top"
                className="min-h-[100px] rounded-2xl border border-zinc-200 dark:border-white/10 bg-zinc-50 dark:bg-[#121215] px-4 py-3 text-base text-zinc-900 dark:text-white leading-5"
              />
            </View>

            {/* Skills: assign reusable instruction bundles (saved immediately) */}
            <View className="rounded-3xl border border-zinc-200 dark:border-white/10 bg-zinc-50 dark:bg-[#121215] p-4 gap-3">
              <View className="flex-row items-start justify-between gap-3">
                <View className="flex-1">
                  <Text className="text-base font-semibold text-zinc-900 dark:text-white">
                    Skills
                  </Text>
                  <Text className="mt-0.5 text-xs text-zinc-500 dark:text-zinc-400 leading-4">
                    Reusable instruction bundles. The agent only sees their name and description
                    until it calls load_skill.
                  </Text>
                </View>
                <Pressable
                  onPress={() => router.push('/skills')}
                  accessibilityRole="button"
                  accessibilityLabel="Manage skills"
                  className="h-9 w-9 items-center justify-center rounded-full border border-zinc-200 dark:border-white/10 active:opacity-70"
                >
                  <BookMarked size={16} color="#06B6D4" />
                </Pressable>
              </View>

              {isNew ? (
                <Text className="text-xs text-zinc-400">
                  Save the agent first, then come back to assign skills.
                </Text>
              ) : skillsLoading ? (
                <Spinner size="sm" color="default" />
              ) : skills.length === 0 ? (
                <Pressable
                  onPress={() => router.push('/skills')}
                  accessibilityRole="button"
                  className="rounded-xl border border-dashed border-zinc-300 dark:border-white/10 py-3 active:opacity-70"
                >
                  <Text className="text-xs text-zinc-500 dark:text-zinc-400 text-center">
                    No skills yet — tap to create one
                  </Text>
                </Pressable>
              ) : (
                skills.map((skill) => (
                  <View
                    key={skill.id}
                    className="flex-row items-center justify-between gap-3 border-t border-zinc-100 dark:border-white/5 pt-3 first:border-t-0 first:pt-0"
                  >
                    <View className="flex-1 min-w-0">
                      <Text
                        numberOfLines={1}
                        className="text-sm font-medium text-zinc-800 dark:text-zinc-100"
                      >
                        {skill.name}
                      </Text>
                      <Text numberOfLines={1} className="text-xs text-zinc-400 mt-0.5">
                        {skill.description}
                      </Text>
                    </View>
                    <Switch
                      isSelected={assignedSkillIds.has(skill.id)}
                      onSelectedChange={(next) => void toggleSkill(skill.id, next)}
                      accessibilityLabel={`Assign skill ${skill.name}`}
                    />
                  </View>
                ))
              )}
            </View>

            {/* Supervisor Toggle Card */}
            <View className="flex-row items-center justify-between rounded-3xl border border-zinc-200 dark:border-white/10 bg-zinc-50 dark:bg-[#121215] p-4">
              <View className="flex-1 pr-4">
                <Text className="text-base font-semibold text-zinc-900 dark:text-white">
                  Supervisor Mode
                </Text>
                <Text className="mt-0.5 text-xs text-zinc-500 dark:text-zinc-400">
                  Orchestrates specialist agents in parallel, cross-checks results, and merges reports.
                </Text>
              </View>
              <Switch
                isSelected={isSupervisor}
                onSelectedChange={setIsSupervisor}
                accessibilityLabel="Toggle supervisor mode"
              />
            </View>

            {/* Preferred Model Card */}
            <View className="rounded-3xl border border-zinc-200 dark:border-white/10 bg-zinc-50 dark:bg-[#121215] p-4">
              <View className="flex-row items-center justify-between">
                <View>
                  <Text className="text-base font-semibold text-zinc-900 dark:text-white">
                    Primary Model
                  </Text>
                  <Text className="text-xs text-zinc-500 dark:text-zinc-400">
                    Model used for agent runs and responses
                  </Text>
                </View>
                <ModelPicker models={models} selectedId={modelId} onSelect={setModelId} />
              </View>
            </View>
          </View>

          {/* Danger Zone: Delete button (Edit mode only) */}
          {!isNew && (
            <View className="pt-2">
              <Pressable
                onPress={handleDelete}
                accessibilityRole="button"
                accessibilityLabel="Delete agent"
                className="flex-row items-center justify-center gap-2 rounded-2xl border border-red-500/20 bg-red-500/10 py-3 active:opacity-75"
              >
                <Trash2 size={16} color="#ef4444" />
                <Text className="text-sm font-semibold text-red-500">
                  Delete Agent
                </Text>
              </Pressable>
            </View>
          )}
        </ScrollView>
      )}
    </KeyboardAvoidingView>
  );
}
