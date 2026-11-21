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
import { Button, Spinner, Switch, Typography } from 'heroui-native';
import { useFocusEffect, useLocalSearchParams, useRouter } from 'expo-router';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { Trash2 } from 'lucide-react-native';
import type { Skill } from '@agent/shared';

import { AppHeader } from '@/components/app-header';
import { createSkill, deleteSkill, fetchSkills, updateSkill } from '@/lib/skills';

const DEFAULT_BODY = '# Instructions\n\n';

/**
 * Skill editor: creates/edits `skills/<slug>/SKILL.md` in the GitHub vault
 * (user-initiated → no approval) and refreshes the Supabase index.
 */
export default function SkillEditorScreen() {
  const router = useRouter();
  const insets = useSafeAreaInsets();
  const params = useLocalSearchParams<{ id: string }>();
  const id = typeof params.id === 'string' ? params.id : '';
  const isNew = id === 'new';

  const [loading, setLoading] = useState(!isNew);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const [name, setName] = useState('');
  const [slug, setSlug] = useState('');
  const [description, setDescription] = useState('');
  const [toolsText, setToolsText] = useState('');
  const [body, setBody] = useState(DEFAULT_BODY);
  const [enabled, setEnabled] = useState(true);

  const load = useCallback(async () => {
    if (isNew) {
      setLoading(false);
      return;
    }
    try {
      const skills = await fetchSkills();
      const skill: Skill | undefined = skills.find((row) => row.id === id);
      if (!skill) {
        setError('This skill no longer exists.');
        return;
      }
      setName(skill.name);
      setSlug(skill.slug);
      setDescription(skill.description);
      setToolsText(skill.tools.join(', '));
      setBody(skill.body);
      setEnabled(skill.enabled);
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

  const tools = toolsText
    .split(',')
    .map((entry) => entry.trim())
    .filter(Boolean);

  const handleSave = useCallback(async () => {
    const trimmedName = name.trim();
    const trimmedDescription = description.trim();
    if (!trimmedName || !trimmedDescription) {
      RNAlert.alert('Name and description required', 'Both are shown to agents in the skill index.');
      return;
    }
    setSaving(true);
    try {
      if (isNew) {
        await createSkill({
          name: trimmedName,
          description: trimmedDescription,
          body: body.trim(),
          ...(slug.trim() ? { slug: slug.trim() } : {}),
          ...(tools.length > 0 ? { tools } : {}),
        });
      } else {
        await updateSkill(id, {
          name: trimmedName,
          description: trimmedDescription,
          body: body.trim(),
          tools,
          enabled,
        });
      }
      router.back();
    } catch (err) {
      RNAlert.alert('Could not save', err instanceof Error ? err.message : String(err));
    } finally {
      setSaving(false);
    }
  }, [body, description, enabled, id, isNew, name, router, slug, tools]);

  const handleDelete = useCallback(() => {
    RNAlert.alert(
      'Delete this skill?',
      'The SKILL.md file is removed from your vault and agents lose access to it.',
      [
        { text: 'Cancel', style: 'cancel' },
        {
          text: 'Delete',
          style: 'destructive',
          onPress: () => {
            void deleteSkill(id)
              .then(() => router.back())
              .catch((err: unknown) =>
                RNAlert.alert('Could not delete', err instanceof Error ? err.message : String(err)),
              );
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
            className="px-2 py-1 active:opacity-60"
          >
            <Typography type="body" className="text-zinc-500 dark:text-zinc-400">
              Cancel
            </Typography>
          </Pressable>
        }
        center={
          <Typography type="body" weight="semibold" className="text-zinc-900 dark:text-white">
            {isNew ? 'New Skill' : 'Edit Skill'}
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
            accessibilityLabel="Save skill"
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
          contentContainerStyle={{ padding: 20, paddingBottom: insets.bottom + 32, gap: 20 }}
          keyboardShouldPersistTaps="handled"
        >
          {error ? (
            <Typography type="body-sm" className="text-red-500 text-center">
              {error}
            </Typography>
          ) : null}

          <View className="rounded-3xl border border-zinc-200 dark:border-white/10 bg-zinc-50 dark:bg-[#121215] p-4 gap-1">
            <Text className="text-xs font-semibold uppercase tracking-wider text-zinc-400 dark:text-zinc-500">
              Vault path
            </Text>
            <Text className="text-sm text-zinc-600 dark:text-zinc-300">
              skills/{(slug || 'your-slug') + '/SKILL.md'}
            </Text>
            <Text className="text-xs text-zinc-400 leading-4">
              Committed to your GitHub vault on save. Agents only see the name and description until
              they call load_skill.
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
                placeholder="e.g. Research Brief"
                placeholderTextColor="#71717a"
                className="rounded-2xl border border-zinc-200 dark:border-white/10 bg-zinc-50 dark:bg-[#121215] px-4 py-3 text-base text-zinc-900 dark:text-white"
              />
            </View>

            <View>
              <Text className="mb-1.5 text-xs font-semibold uppercase tracking-wider text-zinc-400 dark:text-zinc-500">
                Slug {isNew ? '' : '(fixed)'}
              </Text>
              <TextInput
                value={slug}
                onChangeText={(next) => setSlug(next.toLowerCase())}
                editable={isNew}
                autoCapitalize="none"
                autoCorrect={false}
                placeholder="research-brief"
                placeholderTextColor="#71717a"
                className={`rounded-2xl border border-zinc-200 dark:border-white/10 bg-zinc-50 dark:bg-[#121215] px-4 py-3 text-base text-zinc-900 dark:text-white ${isNew ? '' : 'opacity-60'}`}
              />
            </View>

            <View>
              <Text className="mb-1.5 text-xs font-semibold uppercase tracking-wider text-zinc-400 dark:text-zinc-500">
                Description (shown in the agent&apos;s prompt)
              </Text>
              <TextInput
                value={description}
                onChangeText={setDescription}
                placeholder="One line: when should the agent use this skill?"
                placeholderTextColor="#71717a"
                multiline
                className="min-h-[60px] rounded-2xl border border-zinc-200 dark:border-white/10 bg-zinc-50 dark:bg-[#121215] px-4 py-3 text-base text-zinc-900 dark:text-white leading-5"
              />
            </View>

            <View>
              <Text className="mb-1.5 text-xs font-semibold uppercase tracking-wider text-zinc-400 dark:text-zinc-500">
                Tool allowlist (optional, narrows only)
              </Text>
              <TextInput
                value={toolsText}
                onChangeText={setToolsText}
                autoCapitalize="none"
                autoCorrect={false}
                placeholder="web_search, fetch_page"
                placeholderTextColor="#71717a"
                className="rounded-2xl border border-zinc-200 dark:border-white/10 bg-zinc-50 dark:bg-[#121215] px-4 py-3 text-sm text-zinc-900 dark:text-white"
              />
              <Text className="mt-1.5 text-xs text-zinc-400 leading-4">
                Comma-separated. When the skill is loaded, the agent only keeps these tools (it can
                never gain tools it does not already have).
              </Text>
            </View>

            <View>
              <Text className="mb-1.5 text-xs font-semibold uppercase tracking-wider text-zinc-400 dark:text-zinc-500">
                Instructions (markdown)
              </Text>
              <TextInput
                value={body}
                onChangeText={setBody}
                placeholder={DEFAULT_BODY}
                placeholderTextColor="#71717a"
                multiline
                textAlignVertical="top"
                className="min-h-[220px] rounded-2xl border border-zinc-200 dark:border-white/10 bg-zinc-50 dark:bg-[#121215] px-4 py-3 text-sm text-zinc-900 dark:text-white leading-5"
              />
            </View>

            {!isNew ? (
              <View className="flex-row items-center justify-between rounded-3xl border border-zinc-200 dark:border-white/10 bg-zinc-50 dark:bg-[#121215] p-4">
                <View className="flex-1 pr-4">
                  <Text className="text-base font-semibold text-zinc-900 dark:text-white">
                    Enabled
                  </Text>
                  <Text className="mt-0.5 text-xs text-zinc-500 dark:text-zinc-400">
                    Disabled skills stay in the vault but are hidden from agents.
                  </Text>
                </View>
                <Switch
                  isSelected={enabled}
                  onSelectedChange={setEnabled}
                  accessibilityLabel="Toggle skill enabled"
                />
              </View>
            ) : null}
          </View>

          {!isNew ? (
            <View className="pt-1">
              <Pressable
                onPress={handleDelete}
                accessibilityRole="button"
                accessibilityLabel="Delete skill"
                className="flex-row items-center justify-center gap-2 rounded-2xl border border-red-500/20 bg-red-500/10 py-3 active:opacity-75"
              >
                <Trash2 size={16} color="#ef4444" />
                <Text className="text-sm font-semibold text-red-500">Delete Skill</Text>
              </Pressable>
            </View>
          ) : null}
        </ScrollView>
      )}
    </KeyboardAvoidingView>
  );
}
