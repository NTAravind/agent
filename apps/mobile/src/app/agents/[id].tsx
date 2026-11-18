import type { Agent, AgentAvatar } from '@agent/shared';
import { DEFAULT_AGENT_AVATAR } from '@agent/shared';
import { useCallback, useState } from 'react';
import {
  Alert as RNAlert,
  KeyboardAvoidingView,
  Platform,
  Pressable,
  ScrollView,
  Text,
  View,
} from 'react-native';
import { Button, Chip, Input, Spinner, Typography } from 'heroui-native';
import { useFocusEffect, useLocalSearchParams, useRouter } from 'expo-router';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import { AppHeader } from '@/components/app-header';
import { AgentAvatar as AgentAvatarBadge } from '@/components/agent-avatar';
import { ModelPicker } from '@/components/model-picker';
import {
  createAgent,
  deleteAgent,
  fetchAgents,
  updateAgent,
  uploadAgentAvatar,
} from '@/lib/agents';
import { fetchEnabledModels, type ModelOption } from '@/lib/models';

type AvatarTab = 'emoji' | 'icon' | 'upload';

const EMOJI_CHOICES = [
  '🤖', '🎯', '⚡', '📚', '🔬', '🧭', '✅', '📈',
  '🛡️', '🎨', '🧠', '🔍', '🚀', '🛠️', '💡', '🌿',
];
const ICON_CHOICES = ['★', '⚙', '▲', '●', '◆', '✦', '❖', '⬢', '☾', '⌘', '✚', '◐'];
const AVATAR_COLORS = [
  '#7F9DFF', '#22C55E', '#F59E0B', '#EF4444',
  '#A855F7', '#14B8A6', '#0EA5E9', '#64748B',
];

/**
 * Agent editor: name, role, instructions, primary model + fallback order and
 * the avatar picker (Emoji / Icon / Upload tabs + color swatches). Route
 * param `new` creates; any other id edits (the list endpoint supplies the
 * agent — GET /api/agents/:id is not in the spec). Per-tool MCP permissions
 * live on the integration screen, not here.
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
  const [avatar, setAvatar] = useState<AgentAvatar>(DEFAULT_AGENT_AVATAR);
  const [avatarTab, setAvatarTab] = useState<AvatarTab>('emoji');
  const [uploadingAvatar, setUploadingAvatar] = useState(false);
  const [toolCount, setToolCount] = useState(0);
  const [models, setModels] = useState<ModelOption[]>([]);

  const load = useCallback(async () => {
    try {
      const [modelResponse, agents] = await Promise.all([fetchEnabledModels(), fetchAgents()]);
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
        setToolCount(agent.toolCount);
        setModelId(
          agent.model && available.some((model) => model.id === agent.model)
            ? agent.model
            : appDefault,
        );
        // Keep only fallbacks the current catalog still knows, in saved order.
        setFallbacks(agent.fallbackModels.filter((saved) => available.some((m) => m.id === saved)));
      }
      setError(null);
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setLoading(false);
    }
  }, [id, isNew]);

  useFocusEffect(
    useCallback(() => {
      void load();
    }, [load]),
  );

  const handleSelectPrimary = useCallback(
    (next: string) => {
      setModelId(next);
      // The primary can't also be a fallback (the API rejects it).
      setFallbacks((current) => current.filter((entry) => entry !== next));
    },
    [],
  );

  const toggleFallback = useCallback((entry: string) => {
    setFallbacks((current) =>
      current.includes(entry)
        ? current.filter((value) => value !== entry)
        : [...current, entry],
    );
  }, []);

  const pickGlyph = useCallback((type: 'emoji' | 'icon', value: string) => {
    setAvatar((current) => ({ type, value, color: current.color }));
  }, []);

  const pickColor = useCallback((color: string) => {
    setAvatar((current) => ({ ...current, color }));
  }, []);

  /** Uploads a photo now (saves the image avatar immediately) via signed URL. */
  const handleUploadAvatar = useCallback(async () => {
    if (isNew) return;
    setUploadingAvatar(true);
    try {
      const path = await uploadAgentAvatar(id);
      if (!path) return; // picker canceled
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
      RNAlert.alert('Name required', 'Give the agent a name.');
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
      };
      if (isNew) await createAgent(payload);
      else await updateAgent(id, payload);
      router.back();
    } catch (err) {
      RNAlert.alert('Could not save', err instanceof Error ? err.message : String(err));
    } finally {
      setSaving(false);
    }
  }, [avatar, fallbacks, instructions, isNew, id, modelId, name, role, router]);

  const handleDelete = useCallback(() => {
    RNAlert.alert(
      'Delete this agent?',
      'MCP integrations attached to it are removed. Run history is kept.',
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
      className="flex-1 bg-background"
      behavior={Platform.OS === 'ios' ? 'padding' : undefined}
    >
      <AppHeader
        left={
          <Button size="md" variant="ghost" onPress={() => router.back()}>
            <Button.Label>Cancel</Button.Label>
          </Button>
        }
        center={<Typography type="h4">{isNew ? 'New agent' : 'Edit agent'}</Typography>}
      />

      {loading ? (
        <View className="flex-1 items-center justify-center">
          <Spinner />
        </View>
      ) : (
        <ScrollView
          contentContainerStyle={{ padding: 16, paddingBottom: insets.bottom + 24, gap: 16 }}
          keyboardShouldPersistTaps="handled"
        >
          {error ? (
            <Typography type="body-sm" className="text-danger">
              {error}
            </Typography>
          ) : null}

          <View className="gap-2">
            <Typography type="body-sm" color="muted">
              Avatar
            </Typography>
            <View className="items-center gap-2">
              <AgentAvatarBadge avatar={avatar} size={56} />
              {!isNew && toolCount > 0 ? (
                <Typography type="body-sm" color="muted">
                  {toolCount} MCP tool{toolCount === 1 ? '' : 's'} enabled
                </Typography>
              ) : null}
            </View>

            {/* Tabs: Emoji · Icon · Upload */}
            <View className="flex-row gap-2">
              {(['emoji', 'icon', 'upload'] as const).map((tab) => (
                <Chip
                  key={tab}
                  variant={avatarTab === tab ? 'primary' : 'soft'}
                  size="sm"
                  disabled={tab === 'upload' && isNew}
                  onPress={() => setAvatarTab(tab)}
                >
                  <Chip.Label>
                    {tab === 'emoji' ? 'Emoji' : tab === 'icon' ? 'Icon' : 'Upload'}
                  </Chip.Label>
                </Chip>
              ))}
            </View>

            {avatarTab === 'emoji' || avatarTab === 'icon' ? (
              <View className="flex-row flex-wrap gap-2">
                {(avatarTab === 'emoji' ? EMOJI_CHOICES : ICON_CHOICES).map((glyph) => {
                  const selected = avatar.type === avatarTab && avatar.value === glyph;
                  return (
                    <Pressable
                      key={glyph}
                      onPress={() => pickGlyph(avatarTab, glyph)}
                      accessibilityLabel={`Avatar glyph ${glyph}`}
                      accessibilityState={{ selected }}
                      className="h-10 w-10 items-center justify-center rounded-full border active:opacity-60"
                      style={
                        selected
                          ? { backgroundColor: 'rgba(32,138,239,0.15)', borderColor: '#208AEF' }
                          : { borderColor: 'transparent' }
                      }
                    >
                      <Text style={{ fontSize: 20, fontWeight: avatarTab === 'icon' ? '700' : '400' }}>
                        {glyph}
                      </Text>
                    </Pressable>
                  );
                })}
              </View>
            ) : (
              <View className="gap-2">
                {isNew ? (
                  <Typography type="body-sm" color="muted">
                    Create the agent first, then upload a photo.
                  </Typography>
                ) : (
                  <>
                    <Button
                      variant="secondary"
                      isDisabled={uploadingAvatar}
                      onPress={() => void handleUploadAvatar()}
                    >
                      {uploadingAvatar ? (
                        <Spinner size="sm" />
                      ) : (
                        <Button.Label>
                          {avatar.type === 'image' ? 'Replace photo' : 'Choose a photo'}
                        </Button.Label>
                      )}
                    </Button>
                    <Typography type="body-sm" color="muted">
                      Stored privately in your bucket; the app renders a signed link.
                    </Typography>
                  </>
                )}
              </View>
            )}

            {/* Color swatches */}
            <View className="flex-row flex-wrap items-center gap-2">
              <Typography type="body-xs" color="muted">
                Color
              </Typography>
              {AVATAR_COLORS.map((color) => (
                <Pressable
                  key={color}
                  onPress={() => pickColor(color)}
                  accessibilityLabel={`Avatar color ${color}`}
                  accessibilityState={{ selected: avatar.color === color }}
                  className="h-7 w-7 rounded-full active:opacity-60"
                  style={{
                    backgroundColor: color,
                    borderWidth: avatar.color === color ? 2 : 0,
                    borderColor: '#0F172A',
                  }}
                />
              ))}
            </View>
          </View>

          <View className="gap-2">
            <Typography type="body-sm" color="muted">
              Name
            </Typography>
            <Input
              value={name}
              onChangeText={setName}
              placeholder="e.g. Researcher"
              maxLength={60}
            />
          </View>

          <View className="gap-2">
            <Typography type="body-sm" color="muted">
              Role
            </Typography>
            <Input
              value={role}
              onChangeText={setRole}
              placeholder="e.g. Finds and cites sources"
              maxLength={120}
            />
          </View>

          <View className="gap-2">
            <Typography type="body-sm" color="muted">
              Instructions
            </Typography>
            <Input
              value={instructions}
              onChangeText={setInstructions}
              placeholder="How this agent should work, what to avoid, how to answer…"
              multiline
            />
          </View>

          <View className="gap-2">
            <Typography type="body-sm" color="muted">
              Primary model
            </Typography>
            <ModelPicker models={models} selectedId={modelId} onSelect={handleSelectPrimary} />
          </View>

          <View className="gap-2">
            <Typography type="body-sm" color="muted">
              Fallback order
            </Typography>
            <Typography type="body-sm" color="muted">
              Tried when the primary is rate-limited or down. Tap to add or remove; the
              numbered order is the priority.
            </Typography>
            <View className="flex-row flex-wrap gap-2">
              {models
                .filter((model) => model.id !== modelId)
                .map((model) => {
                  const index = fallbacks.indexOf(model.id);
                  const selected = index >= 0;
                  return (
                    <Chip
                      key={model.id}
                      variant={selected ? 'primary' : 'soft'}
                      size="sm"
                      onPress={() => toggleFallback(model.id)}
                    >
                      <Chip.Label>
                        {selected ? `${index + 1}. ` : ''}
                        {model.label}
                      </Chip.Label>
                    </Chip>
                  );
                })}
            </View>
          </View>

          <Button
            onPress={() => void handleSave()}
            isDisabled={saving || name.trim().length === 0}
          >
            {saving ? (
              <Spinner size="sm" />
            ) : (
              <Button.Label>{isNew ? 'Create agent' : 'Save changes'}</Button.Label>
            )}
          </Button>

          {!isNew ? (
            <Button variant="danger" onPress={handleDelete}>
              <Button.Label>Delete agent</Button.Label>
            </Button>
          ) : null}
        </ScrollView>
      )}
    </KeyboardAvoidingView>
  );
}
