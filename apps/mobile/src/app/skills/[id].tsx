import { useCallback, useState } from 'react';
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
import { ChevronLeft, Trash2 } from 'lucide-react-native';
import { SymbolIcon } from '@/components/symbol-icon';
import type { Skill } from '@agent/shared';

import { AppHeader, useHeaderInset } from '@/components/app-header';
import { reportAppError } from '@/components/error-dialog-provider';
import {
  GroupedCard,
  HairlineDivider,
  InlineError,
  PillButton,
  RoundButton,
  SectionLabel,
} from '@/components/design-system';
import { colors, radius, space } from '@/theme';
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
      reportAppError(err, { title: 'Could not save skill' });
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
                reportAppError(err, { title: 'Could not delete skill' }),
              );
          },
        },
      ],
    );
  }, [id, router]);

  const handleBack = useCallback(() => {
    if (router.canGoBack()) {
      router.back();
    } else {
      router.replace('/skills' as never);
    }
  }, [router]);

  const headerInset = useHeaderInset();

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
          <Text style={{ fontSize: 20, lineHeight: 26, fontWeight: '600', color: colors.textPrimary }}>
            {isNew ? 'New skill' : 'Edit skill'}
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
            paddingTop: headerInset,
            paddingHorizontal: space.lg,
            paddingBottom: insets.bottom + space.xxl,
            gap: space.xl,
          }}
          keyboardShouldPersistTaps="handled"
        >
          {error ? <InlineError message={error} onRetry={() => void load()} /> : null}

          {/* Vault path Card */}
          <GroupedCard style={{ padding: space.lg, gap: space.xs }}>
            <Text style={styles.metaLabel}>Vault path</Text>
            <Text style={styles.metaValue}>
              skills/{(slug || 'your-slug') + '/SKILL.md'}
            </Text>
            <Text style={styles.metaDescription}>
              Committed to your GitHub vault on save. Agents only see the name and description until
              they call load_skill.
            </Text>
          </GroupedCard>

          <View style={{ gap: space.lg }}>
            <View>
              <SectionLabel text="Name" />
              <TextInput
                value={name}
                onChangeText={setName}
                placeholder="e.g. Research Brief"
                placeholderTextColor={colors.textSecondary}
                style={styles.input}
              />
            </View>

            <View>
              <SectionLabel text={`Slug ${isNew ? '' : '(fixed)'}`} />
              <TextInput
                value={slug}
                onChangeText={(next) => setSlug(next.toLowerCase())}
                editable={isNew}
                autoCapitalize="none"
                autoCorrect={false}
                placeholder="research-brief"
                placeholderTextColor={colors.textSecondary}
                style={[styles.input, !isNew && { opacity: 0.6 }]}
              />
            </View>

            <View>
              <SectionLabel text="Description (shown in the agent's prompt)" />
              <TextInput
                value={description}
                onChangeText={setDescription}
                placeholder="One line: when should the agent use this skill?"
                placeholderTextColor={colors.textSecondary}
                multiline
                style={[styles.input, styles.multilineInput]}
              />
            </View>

            <View>
              <SectionLabel text="Tool allowlist (optional, narrows only)" />
              <TextInput
                value={toolsText}
                onChangeText={setToolsText}
                autoCapitalize="none"
                autoCorrect={false}
                placeholder="web_search, fetch_page"
                placeholderTextColor={colors.textSecondary}
                style={styles.input}
              />
              <Text style={styles.fieldHelp}>
                Comma-separated. When the skill is loaded, the agent only keeps these tools (it can
                never gain tools it does not already have).
              </Text>
            </View>

            <View>
              <SectionLabel text="Instructions (markdown)" />
              <TextInput
                value={body}
                onChangeText={setBody}
                placeholder={DEFAULT_BODY}
                placeholderTextColor={colors.textSecondary}
                multiline
                textAlignVertical="top"
                style={[styles.input, styles.codeAreaInput]}
              />
            </View>

            {!isNew ? (
              <GroupedCard style={{ padding: space.lg, flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between' }}>
                <View style={{ flex: 1, paddingRight: space.lg }}>
                  <Text style={styles.toggleTitle}>Enabled</Text>
                  <Text style={styles.toggleSubtitle}>
                    Disabled skills stay in the vault but are hidden from agents.
                  </Text>
                </View>
                <Switch
                  isSelected={enabled}
                  onSelectedChange={setEnabled}
                  accessibilityLabel="Toggle skill enabled"
                />
              </GroupedCard>
            ) : null}
          </View>

          {!isNew ? (
            <View style={{ paddingTop: space.xs }}>
              <Pressable
                onPress={handleDelete}
                accessibilityRole="button"
                accessibilityLabel="Delete skill"
                style={styles.deleteButton}
              >
                <SymbolIcon icon={Trash2} size={16} color={colors.danger} />
                <Text style={styles.deleteButtonText}>Delete skill</Text>
              </Pressable>
            </View>
          ) : null}
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
  metaLabel: {
    fontSize: 13,
    fontWeight: '600',
    color: colors.textSecondary,
  },
  metaValue: {
    fontSize: 15,
    color: colors.textPrimary,
    fontWeight: '500',
  },
  metaDescription: {
    fontSize: 13,
    color: colors.textSecondary,
    lineHeight: 18,
    marginTop: space.xs,
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
    minHeight: 80,
    textAlignVertical: 'top',
    lineHeight: 22,
  },
  codeAreaInput: {
    minHeight: 220,
    fontFamily: Platform.OS === 'ios' ? 'Menlo' : 'monospace',
    fontSize: 14,
    lineHeight: 20,
  },
  fieldHelp: {
    fontSize: 13,
    color: colors.textSecondary,
    lineHeight: 18,
    paddingHorizontal: space.xs,
    // The section wrapper no longer carries a gap, so the help text keeps its
    // own 4pt separation from the field above it.
    marginTop: space.xs,
  },
  toggleTitle: {
    fontSize: 17,
    fontWeight: '500',
    color: colors.textPrimary,
  },
  toggleSubtitle: {
    fontSize: 13,
    color: colors.textSecondary,
    marginTop: 2,
    lineHeight: 18,
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
});
