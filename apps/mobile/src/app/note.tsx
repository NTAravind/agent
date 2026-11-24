import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import {
  Alert,
  KeyboardAvoidingView,
  Modal,
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
import {
  Check,
  ChevronLeft,
  Tag,
  Trash2,
  X,
} from 'lucide-react-native';
import {
  EnrichedMarkdownTextInput,
  type EnrichedMarkdownTextInputInstance,
  type MarkdownTextInputStyle,
  type StyleState,
} from 'react-native-enriched-markdown';

import { AppHeader } from '@/components/app-header';
import { reportAppError } from '@/components/error-dialog-provider';
import { RoundButton } from '@/components/design-system';
import { EditorToolbar } from '@/components/notes/editor-toolbar';
import { TagChip } from '@/components/notes/tag-chip';
import { colors, radius, shadow, space } from '@/theme';
import { deleteNote, fetchNote, saveNote } from '@/lib/knowledge';
import { useKeyboardHeight } from '@/lib/use-keyboard-height';

type SaveStatus = 'saved' | 'saving' | 'unsaved';

/** Library default heading sizes matching MarkdownText */
const HEADING_SIZES = { h1: 30, h2: 24, h3: 20, h4: 18, h5: 16, h6: 14 };

/** Splits note content into frontmatter, title, and body */
function parseNoteContent(rawContent: string): {
  frontmatterBlock: string;
  parsedTitle: string;
  body: string;
} {
  let text = rawContent;
  let frontmatterBlock = '';

  // Extract YAML frontmatter if present
  if (text.startsWith('---')) {
    const endIdx = text.indexOf('\n---', 3);
    if (endIdx !== -1) {
      frontmatterBlock = text.slice(0, endIdx + 4) + '\n';
      text = text.slice(endIdx + 4).trimStart();
    }
  }

  // Extract first # Heading as title if present
  let parsedTitle = '';
  const lines = text.split('\n');
  if (lines.length > 0 && lines[0].startsWith('# ')) {
    parsedTitle = lines[0].replace(/^#\s+/, '').trim();
    lines.shift();
    // remove leading empty lines
    while (lines.length > 0 && lines[0].trim() === '') {
      lines.shift();
    }
    text = lines.join('\n');
  }

  return {
    frontmatterBlock,
    parsedTitle,
    body: text,
  };
}

/** Combines frontmatter, title, and body into plain markdown */
function buildFullMarkdown(
  frontmatterBlock: string,
  title: string,
  body: string,
): string {
  let result = frontmatterBlock ? frontmatterBlock.trimEnd() + '\n\n' : '';
  if (title.trim()) {
    result += `# ${title.trim()}\n\n`;
  }
  result += body;
  return result;
}

export default function NoteScreen() {
  const router = useRouter();
  const insets = useSafeAreaInsets();
  const { path } = useLocalSearchParams<{ path: string }>();

  const editorRef = useRef<EnrichedMarkdownTextInputInstance>(null);

  const [loading, setLoading] = useState(Boolean(path));
  const [error, setError] = useState<string | null>(null);

  const [title, setTitle] = useState('');
  const [bodyMarkdown, setBodyMarkdown] = useState('');
  const [frontmatter, setFrontmatter] = useState('');
  const [styleState, setStyleState] = useState<StyleState | null>(null);

  const [saveStatus, setSaveStatus] = useState<SaveStatus>('saved');
  const [linkModalOpen, setLinkModalOpen] = useState(false);
  const [linkUrl, setLinkUrl] = useState('');
  const [tagModalOpen, setTagModalOpen] = useState(false);
  const [newTag, setNewTag] = useState('');
  const [activeTags, setActiveTags] = useState<string[]>([]);

  const keyboardHeight = useKeyboardHeight();

  // Ref to track latest content for unmount/blur auto-save
  const latestDataRef = useRef({ title, bodyMarkdown, frontmatter, path });
  useEffect(() => {
    latestDataRef.current = { title, bodyMarkdown, frontmatter, path };
  }, [title, bodyMarkdown, frontmatter, path]);

  const handleBack = useCallback(() => {
    if (router.canGoBack()) {
      router.back();
    } else {
      router.replace('/notes' as never);
    }
  }, [router]);

  const handleRemoveTag = (tagToRemove: string) => {
    Alert.alert('Remove tag', `Remove #${tagToRemove} from this note?`, [
      { text: 'Cancel', style: 'cancel' },
      {
        text: 'Remove',
        style: 'destructive',
        onPress: () => {
          const updated = activeTags.filter((t) => t !== tagToRemove);
          setActiveTags(updated);
          let updatedFm = frontmatter;
          if (updatedFm.includes('tags:')) {
            updatedFm = updatedFm.replace(/tags:\s*\[[^\]]*\]/, `tags: [${updated.join(', ')}]`);
          }
          setFrontmatter(updatedFm);
          triggerSave(title, bodyMarkdown, updatedFm);
        },
      },
    ]);
  };

  // Load existing note
  const load = useCallback(async () => {
    if (!path) return;
    try {
      const result = await fetchNote(path);
      if (result) {
        const { frontmatterBlock, parsedTitle, body } = parseNoteContent(result.content);
        setFrontmatter(frontmatterBlock);
        setTitle(parsedTitle || (result.note.title ?? path.split('/').pop()?.replace('.md', '') ?? ''));
        setBodyMarkdown(body);

        // Extract tags from frontmatter
        if (Array.isArray(result.note.frontmatter?.tags)) {
          setActiveTags(result.note.frontmatter.tags as string[]);
        }

        setError(null);
      } else {
        setError(`No note found at ${path}.`);
      }
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

  // Auto-save logic
  const saveTimeoutRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  const triggerSave = useCallback(
    (nextTitle: string, nextBody: string, nextFm: string) => {
      if (!path) return;
      setSaveStatus('unsaved');

      if (saveTimeoutRef.current) {
        clearTimeout(saveTimeoutRef.current);
      }

      saveTimeoutRef.current = setTimeout(async () => {
        setSaveStatus('saving');
        try {
          const fullContent = buildFullMarkdown(nextFm, nextTitle, nextBody);
          await saveNote(path, fullContent);
          setSaveStatus('saved');
        } catch {
          setSaveStatus('unsaved');
        }
      }, 800);
    },
    [path],
  );

  // Flush save on unmount
  useEffect(() => {
    return () => {
      if (saveTimeoutRef.current) {
        clearTimeout(saveTimeoutRef.current);
      }
      const { title: t, bodyMarkdown: b, frontmatter: f, path: p } = latestDataRef.current;
      if (p) {
        const fullContent = buildFullMarkdown(f, t, b);
        void saveNote(p, fullContent).catch(() => {});
      }
    };
  }, []);

  const handleTitleChange = (nextTitle: string) => {
    setTitle(nextTitle);
    triggerSave(nextTitle, bodyMarkdown, frontmatter);
  };

  const handleBodyChange = (nextBody: string) => {
    setBodyMarkdown(nextBody);
    triggerSave(title, nextBody, frontmatter);
  };

  const handleDelete = () => {
    if (!path) return;
    Alert.alert('Delete note', 'Are you sure you want to delete this note from the vault?', [
      { text: 'Cancel', style: 'cancel' },
      {
        text: 'Delete',
        style: 'destructive',
        onPress: async () => {
          try {
            await deleteNote(path);
            handleBack();
          } catch (err) {
            reportAppError(err, { title: 'Could not delete note' });
          }
        },
      },
    ]);
  };

  // Toolbar Actions
  const handleToggleBold = () => editorRef.current?.toggleBold();
  const handleToggleItalic = () => editorRef.current?.toggleItalic();
  const handleToggleHeading = () => editorRef.current?.toggleHeading(2);
  const handleToggleList = () => editorRef.current?.toggleUnorderedList();
  const handleInsertChecklist = () => editorRef.current?.insertText('- [ ] ');
  const handleUndo = () => editorRef.current?.undo();
  const handleRedo = () => editorRef.current?.redo();

  const handleInsertLink = () => {
    setLinkUrl('');
    setLinkModalOpen(true);
  };

  const handleConfirmLink = () => {
    const url = linkUrl.trim();
    if (url) {
      editorRef.current?.setLink(url);
    }
    setLinkModalOpen(false);
  };

  const handleAddTag = () => {
    const clean = newTag.trim().replace(/^#/, '');
    if (clean && !activeTags.includes(clean)) {
      const updated = [...activeTags, clean];
      setActiveTags(updated);
      // Append tag to frontmatter or body
      let updatedFm = frontmatter;
      if (updatedFm.includes('tags:')) {
        updatedFm = updatedFm.replace(/tags:\s*\[(.*?)\]/, `tags: [${updated.join(', ')}]`);
      } else if (updatedFm.startsWith('---')) {
        updatedFm = updatedFm.replace('---', `---\ntags: [${updated.join(', ')}]`);
      } else {
        updatedFm = `---\ntags: [${updated.join(', ')}]\n---\n\n`;
      }
      setFrontmatter(updatedFm);
      triggerSave(title, bodyMarkdown, updatedFm);
    }
    setNewTag('');
    setTagModalOpen(false);
  };

  // Markdown styling mirroring EnrichedMarkdownText
  const markdownStyle: MarkdownTextInputStyle = useMemo(
    () => ({
      h1: { fontSize: HEADING_SIZES.h1, fontWeight: '700', color: colors.textPrimary },
      h2: { fontSize: HEADING_SIZES.h2, fontWeight: '700', color: colors.textPrimary },
      h3: { fontSize: HEADING_SIZES.h3, fontWeight: '600', color: colors.textPrimary },
      h4: { fontSize: HEADING_SIZES.h4, fontWeight: '600', color: colors.textPrimary },
      h5: { fontSize: HEADING_SIZES.h5, fontWeight: '600', color: colors.textPrimary },
      h6: { fontSize: HEADING_SIZES.h6, fontWeight: '600', color: colors.textPrimary },
      strong: { color: colors.textPrimary },
      em: { color: colors.textPrimary },
      link: { color: colors.link, underline: true },
      list: { itemSpacing: 4 },
    }),
    [],
  );

  return (
    <KeyboardAvoidingView
      behavior={Platform.OS === 'ios' ? 'padding' : undefined}
      keyboardVerticalOffset={Platform.OS === 'ios' ? insets.top : 0}
      style={styles.screen}
    >
      {/* Floating Header */}
      <AppHeader
        left={
          <RoundButton
            icon={ChevronLeft}
            onPress={handleBack}
            accessibilityLabel="Go back"
          />
        }
        center={
          <View style={styles.headerStatusRow}>
            {saveStatus === 'saving' && (
              <View style={styles.statusPill}>
                <Spinner size="sm" color="default" />
                <Text style={styles.statusText}>Saving…</Text>
              </View>
            )}
            {saveStatus === 'saved' && (
              <View style={styles.statusPill}>
                <Check size={13} color={colors.success} strokeWidth={2.5} />
                <Text style={styles.statusText}>Saved</Text>
              </View>
            )}
            {saveStatus === 'unsaved' && (
              <View style={styles.statusPill}>
                <View style={styles.unsavedDot} />
                <Text style={styles.statusText}>Unsaved</Text>
              </View>
            )}
          </View>
        }
        right={
          <RoundButton
            icon={Trash2}
            onPress={handleDelete}
            accessibilityLabel="Delete note"
          />
        }
      />

      {loading ? (
        <View style={styles.center}>
          <Spinner size="lg" color="default" />
        </View>
      ) : error ? (
        <View style={styles.errorContainer}>
          <Text style={styles.errorText}>{error}</Text>
          <Pressable onPress={handleBack} style={styles.goBackBtn}>
            <Text style={styles.goBackText}>Go back</Text>
          </Pressable>
        </View>
      ) : (
        <View style={styles.editorContainer}>
          <ScrollView
            contentContainerStyle={[
              styles.scrollContent,
              { paddingBottom: space.xl },
            ]}
            keyboardShouldPersistTaps="handled"
            showsVerticalScrollIndicator={false}
          >
            {/* Large Inline Title */}
            <TextInput
              style={styles.titleInput}
              value={title}
              onChangeText={handleTitleChange}
              placeholder="Note Title"
              placeholderTextColor={colors.textTertiary}
              multiline
              blurOnSubmit
            />

            {/* Tag Pills Row */}
            <View style={styles.pillsRow}>
              {activeTags.map((tag) => (
                <TagChip
                  key={tag}
                  label={tag}
                  onPress={() => handleRemoveTag(tag)}
                />
              ))}
              <Pressable
                onPress={() => setTagModalOpen(true)}
                accessibilityRole="button"
                accessibilityLabel="Add Tag"
                style={styles.actionPill}
              >
                <Tag size={13} color={colors.textSecondary} />
                <Text style={styles.actionPillText}>+ Add Tag</Text>
              </Pressable>
            </View>

            {/* Rich Markdown WYSIWYG Editor Input */}
            <EnrichedMarkdownTextInput
              ref={editorRef}
              defaultValue={bodyMarkdown}
              onChangeMarkdown={handleBodyChange}
              onChangeState={setStyleState}
              markdownShortcuts={true}
              markdownStyle={markdownStyle}
              placeholder="Write your notes…"
              placeholderTextColor={colors.textTertiary}
              multiline
              scrollEnabled={false}
              cursorColor={colors.primary}
              selectionColor={colors.overlay}
              style={styles.enrichedInput}
            />
          </ScrollView>

          {/* Formatting Toolbar Above Keyboard */}
          <EditorToolbar
            styleState={styleState}
            onToggleBold={handleToggleBold}
            onToggleItalic={handleToggleItalic}
            onToggleHeading={handleToggleHeading}
            onToggleList={handleToggleList}
            onInsertChecklist={handleInsertChecklist}
            onInsertLink={handleInsertLink}
            onUndo={handleUndo}
            onRedo={handleRedo}
            style={{
              paddingBottom:
                Platform.OS === 'ios'
                  ? keyboardHeight > 0
                    ? 4
                    : Math.max(insets.bottom, 4)
                  : 4,
            }}
          />
        </View>
      )}

      {/* Link Dialog */}
      <Modal
        visible={linkModalOpen}
        transparent
        animationType="fade"
        onRequestClose={() => setLinkModalOpen(false)}
      >
        <View style={styles.modalBackdrop}>
          <View style={[styles.modalCard, shadow.floating]}>
            <View style={styles.modalHeader}>
              <Text style={styles.modalTitle}>Insert Link</Text>
              <Pressable onPress={() => setLinkModalOpen(false)} hitSlop={8}>
                <X size={20} color={colors.textSecondary} />
              </Pressable>
            </View>
            <TextInput
              autoFocus
              style={styles.modalInput}
              placeholder="https://example.com"
              placeholderTextColor={colors.textSecondary}
              value={linkUrl}
              onChangeText={setLinkUrl}
              autoCapitalize="none"
              autoCorrect={false}
              keyboardType="url"
              onSubmitEditing={handleConfirmLink}
              returnKeyType="done"
            />
            <View style={styles.modalButtons}>
              <Pressable
                onPress={() => setLinkModalOpen(false)}
                style={styles.modalCancelBtn}
              >
                <Text style={styles.modalCancelText}>Cancel</Text>
              </Pressable>
              <Pressable
                onPress={handleConfirmLink}
                style={styles.modalConfirmBtn}
              >
                <Text style={styles.modalConfirmText}>Insert</Text>
              </Pressable>
            </View>
          </View>
        </View>
      </Modal>

      {/* Tag Dialog */}
      <Modal
        visible={tagModalOpen}
        transparent
        animationType="fade"
        onRequestClose={() => setTagModalOpen(false)}
      >
        <View style={styles.modalBackdrop}>
          <View style={[styles.modalCard, shadow.floating]}>
            <View style={styles.modalHeader}>
              <Text style={styles.modalTitle}>Add Tag</Text>
              <Pressable onPress={() => setTagModalOpen(false)} hitSlop={8}>
                <X size={20} color={colors.textSecondary} />
              </Pressable>
            </View>
            <TextInput
              autoFocus
              style={styles.modalInput}
              placeholder="e.g. personal, work, ideas"
              placeholderTextColor={colors.textSecondary}
              value={newTag}
              onChangeText={setNewTag}
              autoCapitalize="none"
              autoCorrect={false}
              onSubmitEditing={handleAddTag}
              returnKeyType="done"
            />
            <View style={styles.modalButtons}>
              <Pressable
                onPress={() => setTagModalOpen(false)}
                style={styles.modalCancelBtn}
              >
                <Text style={styles.modalCancelText}>Cancel</Text>
              </Pressable>
              <Pressable onPress={handleAddTag} style={styles.modalConfirmBtn}>
                <Text style={styles.modalConfirmText}>Add</Text>
              </Pressable>
            </View>
          </View>
        </View>
      </Modal>
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
  editorContainer: {
    flex: 1,
  },
  scrollContent: {
    paddingHorizontal: space.lg,
    paddingTop: space.sm,
    gap: space.md,
  },
  headerStatusRow: {
    alignItems: 'center',
    justifyContent: 'center',
  },
  statusPill: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 5,
    backgroundColor: colors.surfaceRaised,
    borderRadius: radius.pill,
    paddingHorizontal: 10,
    paddingVertical: 4,
    borderWidth: StyleSheet.hairlineWidth,
    borderColor: colors.divider,
  },
  statusText: {
    fontSize: 12,
    fontWeight: '500',
    color: colors.textSecondary,
  },
  unsavedDot: {
    width: 6,
    height: 6,
    borderRadius: 3,
    backgroundColor: colors.textSecondary,
  },
  titleInput: {
    fontSize: 26,
    lineHeight: 32,
    fontWeight: '700',
    color: colors.textPrimary,
    paddingVertical: space.xs,
  },
  pillsRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: space.sm,
    paddingVertical: space.xs,
  },
  actionPill: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 5,
    paddingHorizontal: 12,
    paddingVertical: 6,
    borderRadius: radius.pill,
    backgroundColor: colors.surfaceRaised,
    borderWidth: StyleSheet.hairlineWidth,
    borderColor: colors.divider,
  },
  actionPillText: {
    fontSize: 12,
    fontWeight: '500',
    color: colors.textSecondary,
  },
  enrichedInput: {
    fontSize: 17,
    lineHeight: 24,
    color: colors.textPrimary,
    minHeight: 320,
    paddingVertical: space.xs,
  },
  errorContainer: {
    flex: 1,
    alignItems: 'center',
    justifyContent: 'center',
    padding: space.xl,
    gap: space.md,
  },
  errorText: {
    fontSize: 16,
    color: colors.recording,
    textAlign: 'center',
  },
  goBackBtn: {
    paddingHorizontal: space.lg,
    paddingVertical: space.sm,
    backgroundColor: colors.surfaceRaised,
    borderRadius: radius.pill,
  },
  goBackText: {
    fontSize: 15,
    color: colors.link,
    fontWeight: '600',
  },
  modalBackdrop: {
    flex: 1,
    backgroundColor: colors.overlay,
    justifyContent: 'center',
    paddingHorizontal: space.xl,
  },
  modalCard: {
    backgroundColor: colors.surfaceRaised,
    borderRadius: radius.card,
    padding: space.xl,
    gap: space.lg,
    borderWidth: StyleSheet.hairlineWidth,
    borderColor: colors.divider,
  },
  modalHeader: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
  },
  modalTitle: {
    fontSize: 18,
    fontWeight: '700',
    color: colors.textPrimary,
  },
  modalInput: {
    backgroundColor: colors.surface,
    borderRadius: radius.card,
    paddingHorizontal: space.lg,
    paddingVertical: space.md,
    fontSize: 15,
    color: colors.textPrimary,
  },
  modalButtons: {
    flexDirection: 'row',
    justifyContent: 'flex-end',
    gap: space.sm,
  },
  modalCancelBtn: {
    paddingHorizontal: space.md,
    paddingVertical: space.sm,
  },
  modalCancelText: {
    fontSize: 15,
    color: colors.textSecondary,
    fontWeight: '500',
  },
  modalConfirmBtn: {
    paddingHorizontal: space.lg,
    paddingVertical: space.sm,
    backgroundColor: colors.primary,
    borderRadius: radius.pill,
  },
  modalConfirmText: {
    fontSize: 15,
    color: colors.onPrimary,
    fontWeight: '600',
  },
});
