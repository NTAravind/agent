import { useCallback, useState } from 'react';
import {
  Alert,
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
import { useFocusEffect, useLocalSearchParams, useRouter } from 'expo-router';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { ChevronLeft, FileText, Link2, Pencil, Trash2 } from 'lucide-react-native';

import { AppHeader } from '@/components/app-header';
import { GroupedCard, PillButton, RoundButton } from '@/components/design-system';
import { MarkdownText } from '@/components/markdown-text';
import { colors, radius, shadow, space } from '@/theme';
import { deleteNote, fetchNote, saveNote } from '@/lib/knowledge';

export default function NoteScreen() {
  const router = useRouter();
  const insets = useSafeAreaInsets();
  const { path } = useLocalSearchParams<{ path: string }>();

  const [note, setNote] = useState<Awaited<ReturnType<typeof fetchNote>>>(null);
  const [loading, setLoading] = useState(Boolean(path));
  const [error, setError] = useState<string | null>(null);

  const [editing, setEditing] = useState(false);
  const [content, setContent] = useState('');
  const [draftPath, setDraftPath] = useState(path ?? '');
  const [saving, setSaving] = useState(false);
  const [notice, setNotice] = useState<string | null>(null);

  const handleBack = useCallback(() => {
    if (router.canGoBack()) {
      router.back();
    } else {
      router.replace('/notes' as never);
    }
  }, [router]);

  const load = useCallback(async () => {
    if (!path) return;
    try {
      const result = await fetchNote(path);
      setNote(result);
      setContent(result?.content ?? '');
      setDraftPath(path);
      setError(result ? null : `No note at ${path}.`);
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setLoading(false);
    }
  }, [path]);

  useFocusEffect(
    useCallback(() => {
      void load();
    }, [load]),
  );

  const openPath = (target: string) =>
    router.push({ pathname: '/note', params: { path: target } });

  const handleSave = useCallback(async () => {
    if (!path || saving) return;
    const nextPath = draftPath.trim();
    if (!nextPath.endsWith('.md')) {
      setNotice('Note paths must end with .md');
      return;
    }
    if (!content.trim()) {
      setNotice('A note cannot be empty.');
      return;
    }
    setSaving(true);
    setNotice(null);
    try {
      await saveNote(nextPath, content);
      if (nextPath !== path) {
        try {
          await deleteNote(path);
        } catch (error) {
          console.warn('[notes] could not remove old note:', error);
        }
        router.replace({ pathname: '/note', params: { path: nextPath } });
      }
      setEditing(false);
      await load();
    } catch (err) {
      setNotice(err instanceof Error ? err.message : String(err));
    } finally {
      setSaving(false);
    }
  }, [content, draftPath, load, path, router, saving]);

  const handleDelete = useCallback(() => {
    if (!path) return;
    Alert.alert('Delete note', 'Remove this note from the vault?', [
      { text: 'Cancel', style: 'cancel' },
      {
        text: 'Delete',
        style: 'destructive',
        onPress: () => {
          void deleteNote(path)
            .then(() => handleBack())
            .catch((err) => setNotice(err instanceof Error ? err.message : String(err)));
        },
      },
    ]);
  }, [handleBack, path]);

  return (
    <KeyboardAvoidingView
      behavior={Platform.OS === 'ios' ? 'padding' : undefined}
      style={styles.screen}
    >
      {/* 6.1 Floating AppHeader */}
      <AppHeader
        left={
          <RoundButton
            icon={ChevronLeft}
            onPress={handleBack}
            accessibilityLabel="Go back"
          />
        }
        center={
          <Text numberOfLines={1} style={styles.headerTitle}>
            {editing ? 'Edit note' : (note?.note.title ?? path ?? 'Note')}
          </Text>
        }
        right={
          editing ? (
            <PillButton
              label={saving ? 'Saving…' : 'Save'}
              onPress={() => void handleSave()}
              disabled={saving}
              variant="primary"
            />
          ) : (
            <View style={styles.headerActions}>
              <RoundButton
                icon={Pencil}
                onPress={() => setEditing(true)}
                accessibilityLabel="Edit note"
              />
              <RoundButton
                icon={Trash2}
                onPress={handleDelete}
                accessibilityLabel="Delete note"
              />
            </View>
          )
        }
      />

      {notice ? (
        <View style={styles.noticeBox}>
          <Text style={styles.noticeText}>{notice}</Text>
        </View>
      ) : null}

      {loading ? (
        <View style={styles.center}>
          <Spinner size="lg" color="default" />
        </View>
      ) : editing ? (
        <ScrollView
          contentContainerStyle={{ padding: space.lg, paddingBottom: insets.bottom + space.xxl, gap: space.md }}
          keyboardShouldPersistTaps="handled"
        >
          <View style={{ gap: space.xs }}>
            <Text style={styles.fieldLabel}>Path</Text>
            <TextInput
              style={styles.pathInput}
              value={draftPath}
              onChangeText={setDraftPath}
              autoCapitalize="none"
              autoCorrect={false}
              placeholder="folder/note.md"
              placeholderTextColor={colors.textSecondary}
            />
          </View>

          <View style={{ gap: space.xs }}>
            <Text style={styles.fieldLabel}>Markdown</Text>
            <TextInput
              style={styles.contentInput}
              value={content}
              onChangeText={setContent}
              multiline
              textAlignVertical="top"
              placeholder="# Title\n\nWrite in markdown…"
              placeholderTextColor={colors.textSecondary}
            />
          </View>
        </ScrollView>
      ) : (
        <ScrollView
          contentContainerStyle={{ padding: space.lg, paddingBottom: insets.bottom + space.xxl, gap: space.lg }}
        >
          {error ? (
            <View style={styles.noticeBox}>
              <Text style={styles.noticeText}>{error}</Text>
            </View>
          ) : null}

          {note ? (
            <>
              {/* Note Header Title */}
              <View style={styles.noteTitleSection}>
                <Text style={styles.noteTitle}>
                  {note.note.title ?? note.note.path}
                </Text>
                <View style={styles.notePathRow}>
                  <FileText size={16} color={colors.textSecondary} strokeWidth={1.75} />
                  <Text style={styles.notePathText}>
                    {note.note.path}
                  </Text>
                </View>
              </View>

              {/* Tappable Wikilinks */}
              {note.links.length > 0 ? (
                <View style={{ gap: space.sm }}>
                  <View style={styles.notePathRow}>
                    <Link2 size={16} color={colors.textSecondary} strokeWidth={1.75} />
                    <Text style={styles.fieldLabel}>Linked Notes</Text>
                  </View>
                  <View style={styles.linksRow}>
                    {note.links.map((link) => (
                      <Pressable
                        key={link}
                        onPress={() => openPath(link)}
                        accessibilityRole="button"
                        accessibilityLabel={`Link to ${link}`}
                        style={({ pressed }) => [styles.linkPill, { opacity: pressed ? 0.6 : 1 }]}
                      >
                        <Text style={styles.linkText}>
                          [[{link}]]
                        </Text>
                      </Pressable>
                    ))}
                  </View>
                </View>
              ) : null}

              {/* Note Body */}
              <GroupedCard style={{ paddingVertical: space.lg }}>
                <MarkdownText markdown={note.content} />
              </GroupedCard>
            </>
          ) : null}
        </ScrollView>
      )}
    </KeyboardAvoidingView>
  );
}

const styles = StyleSheet.create({
  screen: {
    flex: 1,
    backgroundColor: colors.background,
  },
  center: {
    flex: 1,
    alignItems: 'center',
    justifyContent: 'center',
  },
  headerBar: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingHorizontal: space.lg,
    paddingBottom: space.sm,
    gap: space.sm,
  },
  headerTitle: {
    fontSize: 20,
    lineHeight: 26,
    fontWeight: '600',
    color: colors.textPrimary,
    flex: 1,
    textAlign: 'center',
  },
  headerActions: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: space.sm,
  },
  noticeBox: {
    marginHorizontal: space.lg,
    marginTop: space.xs,
    backgroundColor: colors.recordingBg,
    borderRadius: radius.card,
    paddingHorizontal: space.md,
    paddingVertical: space.sm,
  },
  noticeText: {
    fontSize: 15,
    lineHeight: 20,
    color: colors.recording,
  },
  fieldLabel: {
    fontSize: 15,
    lineHeight: 20,
    color: colors.textSecondary,
    fontWeight: '400',
  },
  pathInput: {
    borderRadius: radius.pill,
    backgroundColor: colors.surface,
    paddingHorizontal: space.md,
    paddingVertical: 12,
    fontSize: 17,
    lineHeight: 22,
    color: colors.textPrimary,
  },
  contentInput: {
    borderRadius: radius.card,
    backgroundColor: colors.surface,
    paddingHorizontal: space.md,
    paddingVertical: space.md,
    fontSize: 17,
    lineHeight: 22,
    color: colors.textPrimary,
    minHeight: 280,
  },
  noteTitleSection: {
    paddingBottom: space.md,
    borderBottomWidth: StyleSheet.hairlineWidth,
    borderBottomColor: colors.divider,
    gap: space.xs,
  },
  noteTitle: {
    fontSize: 24,
    lineHeight: 30,
    fontWeight: '600',
    color: colors.textPrimary,
  },
  notePathRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: space.xs,
  },
  notePathText: {
    fontSize: 15,
    lineHeight: 20,
    color: colors.textSecondary,
  },
  linksRow: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: space.sm,
  },
  linkPill: {
    backgroundColor: colors.surface,
    borderRadius: radius.pill,
    paddingHorizontal: 12,
    paddingVertical: 6,
  },
  linkText: {
    fontSize: 15,
    lineHeight: 20,
    color: colors.link,
    textDecorationLine: 'underline',
  },
});
