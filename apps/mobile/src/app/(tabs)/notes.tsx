import React, { useCallback, useEffect, useMemo, useState } from 'react';
import {
  Alert,
  Modal,
  Pressable,
  RefreshControl,
  ScrollView,
  StyleSheet,
  Text,
  TextInput,
  View,
} from 'react-native';
import { Spinner } from 'heroui-native';
import { useFocusEffect, useRouter } from 'expo-router';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { FileText, Plus, RefreshCw, Search, X } from 'lucide-react-native';
import type { Note, NoteChunk } from '@agent/shared';

import { AppHeader } from '@/components/app-header';
import { reportAppError } from '@/components/error-dialog-provider';
import { PillButton, RoundButton } from '@/components/design-system';
import { colors, radius, shadow, space } from '@/theme';
import {
  deleteNote,
  fetchNote,
  fetchNotes,
  saveNote,
  searchNotes,
  suggestNotePath,
  syncVault,
} from '@/lib/knowledge';
import { useSession } from '@/lib/session';

import { NoteCard } from '@/components/notes/note-card';
import { QuickCreateGrid, type QuickCreateMode } from '@/components/notes/quick-create-grid';

export default function NotesScreen() {
  const router = useRouter();
  const insets = useSafeAreaInsets();
  const { session } = useSession();

  const [notes, setNotes] = useState<Note[]>([]);
  const [noteContents, setNoteContents] = useState<Record<string, string>>({});
  const [query, setQuery] = useState('');
  const [searchMatches, setSearchMatches] = useState<NoteChunk[] | null>(null);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [syncing, setSyncing] = useState(false);
  const [notice, setNotice] = useState<string | null>(null);
  const [toastMessage, setToastMessage] = useState<string | null>(null);

  const [newOpen, setNewOpen] = useState(false);
  const [newTitle, setNewTitle] = useState('');
  const [creating, setCreating] = useState(false);

  // Auto-dismiss toast
  useEffect(() => {
    if (!toastMessage) return;
    const timer = setTimeout(() => setToastMessage(null), 3000);
    return () => clearTimeout(timer);
  }, [toastMessage]);

  const load = useCallback(async () => {
    try {
      const items = await fetchNotes();
      // Sort pinned first, then newest updated_at
      const sorted = [...items].sort((a, b) => {
        const aPinned = Boolean(a.frontmatter?.pinned);
        const bPinned = Boolean(b.frontmatter?.pinned);
        if (aPinned && !bPinned) return -1;
        if (!aPinned && bPinned) return 1;
        return new Date(b.updated_at).getTime() - new Date(a.updated_at).getTime();
      });
      setNotes(sorted);

      // Fetch note content for previews (top 15 recent notes)
      const toFetch = sorted.slice(0, 15);
      void Promise.all(
        toFetch.map(async (n) => {
          try {
            const data = await fetchNote(n.path);
            return [n.path, data?.content ?? ''] as const;
          } catch {
            return [n.path, ''] as const;
          }
        }),
      ).then((entries) => {
        setNoteContents((prev) => {
          const next = { ...prev };
          for (const [p, c] of entries) {
            next[p] = c;
          }
          return next;
        });
      });
    } catch (error) {
      setNotice(error instanceof Error ? error.message : String(error));
    } finally {
      setLoading(false);
      setRefreshing(false);
    }
  }, []);

  useFocusEffect(
    useCallback(() => {
      void load();
    }, [load]),
  );

  const trimmedQuery = query.trim();

  const handleQueryChange = (text: string) => {
    setQuery(text);
    if (!text.trim()) {
      setSearchMatches(null);
    }
  };

  // Search effect: semantic + local
  useEffect(() => {
    if (!trimmedQuery) {
      return;
    }

    let active = true;
    const timer = setTimeout(() => {
      void searchNotes(trimmedQuery)
        .then((result) => {
          if (active) setSearchMatches(result);
        })
        .catch(() => {
          if (active) setSearchMatches([]);
        });
    }, 250);

    return () => {
      active = false;
      clearTimeout(timer);
    };
  }, [trimmedQuery]);

  // Filter notes: title, path, tags, body
  const filteredNotes = useMemo(() => {
    if (!trimmedQuery) return notes;
    const q = trimmedQuery.toLowerCase();
    const isTagSearch = q.startsWith('#');
    const tagTerm = isTagSearch ? q.slice(1) : q;

    return notes.filter((n) => {
      const titleMatch = (n.title ?? '').toLowerCase().includes(q);
      const pathMatch = n.path.toLowerCase().includes(q);

      // Tags match
      const tags = Array.isArray(n.frontmatter?.tags)
        ? (n.frontmatter.tags as string[]).map((t) => t.toLowerCase())
        : [];
      const tagMatch = tags.some((t) => t.includes(tagTerm));

      // Body content match
      const body = (noteContents[n.path] ?? '').toLowerCase();
      const bodyMatch = body.includes(q);

      // Semantic matches
      const semanticMatch = searchMatches?.some((m) => m.path === n.path);

      return titleMatch || pathMatch || tagMatch || bodyMatch || semanticMatch;
    });
  }, [notes, noteContents, trimmedQuery, searchMatches]);

  const handleSync = useCallback(async () => {
    setSyncing(true);
    setNotice(null);
    try {
      const summary = await syncVault();
      setToastMessage(summary.message ?? (summary.ok ? 'Vault synced' : 'Sync initiated'));
      await load();
    } catch (error) {
      reportAppError(error, { title: 'Could not sync notes' });
    } finally {
      setSyncing(false);
    }
  }, [load]);

  const handleCreate = useCallback(
    async (customTitle?: string) => {
      const title = (customTitle ?? newTitle).trim();
      if (!title) return;
      setCreating(true);
      try {
        const path = suggestNotePath(title);
        const initial = `# ${title}\n\n`;
        await saveNote(path, initial);
        setNewOpen(false);
        setNewTitle('');
        router.push({ pathname: '/note', params: { path } });
      } catch (error) {
        reportAppError(error, { title: 'Could not create note' });
      } finally {
        setCreating(false);
      }
    },
    [newTitle, router],
  );

  const handleQuickCreate = (mode: QuickCreateMode) => {
    if (mode === 'text') {
      setNewTitle('');
      setNewOpen(true);
      return;
    }

    if (mode === 'checklist') {
      const title = 'Checklist';
      const path = suggestNotePath(title);
      const template = `# Checklist\n\n- [ ] `;
      void (async () => {
        try {
          await saveNote(path, template);
          await load();
          router.push({ pathname: '/note', params: { path } });
        } catch {
          setNewTitle('Checklist');
          setNewOpen(true);
        }
      })();
      return;
    }
  };

  const handleDuplicate = async (note: Note) => {
    try {
      const raw = noteContents[note.path] ?? (await fetchNote(note.path))?.content ?? '';
      const newPath = note.path.replace(/\.md$/i, '-copy.md');
      await saveNote(newPath, raw);
      setToastMessage('Note duplicated');
      await load();
    } catch (err) {
      reportAppError(err, { title: 'Could not duplicate note' });
    }
  };

  const handleTogglePin = async (note: Note, pinned: boolean) => {
    try {
      const current = await fetchNote(note.path);
      const content = current?.content ?? '';
      let updatedContent = content;

      if (content.startsWith('---')) {
        const parts = content.split('---');
        if (parts.length >= 3) {
          let fmMatter = parts[1] ?? '';
          if (fmMatter.includes('pinned:')) {
            fmMatter = fmMatter.replace(/pinned:\s*(true|false)/, `pinned: ${pinned}`);
          } else {
            fmMatter += `\npinned: ${pinned}\n`;
          }
          updatedContent = `---${fmMatter}---${parts.slice(2).join('---')}`;
        }
      } else {
        updatedContent = `---\npinned: ${pinned}\n---\n\n${content}`;
      }

      await saveNote(note.path, updatedContent);
      setToastMessage(pinned ? 'Note pinned' : 'Note unpinned');
      await load();
    } catch (err) {
      reportAppError(err, { title: pinned ? 'Could not pin note' : 'Could not unpin note' });
    }
  };

  const handleDelete = (note: Note) => {
    Alert.alert('Delete note', `Are you sure you want to delete "${note.title ?? note.path}"?`, [
      { text: 'Cancel', style: 'cancel' },
      {
        text: 'Delete',
        style: 'destructive',
        onPress: async () => {
          try {
            await deleteNote(note.path);
            setToastMessage('Note deleted');
            await load();
          } catch (err) {
            reportAppError(err, { title: 'Could not delete note' });
          }
        },
      },
    ]);
  };

  const userInitial = session?.user.email ? session.user.email.slice(0, 2).toUpperCase() : 'FL';

  return (
    <View style={styles.screen}>
      {/* Floating AppHeader */}
      <AppHeader
        left={
          <Pressable
            onPress={() => router.push('/more')}
            accessibilityRole="button"
            accessibilityLabel="Open settings"
            style={({ pressed }) => [
              styles.initialsAvatar,
              shadow.floating,
              { opacity: pressed ? 0.6 : 1 },
            ]}
          >
            <Text style={styles.initialsText}>{userInitial}</Text>
          </Pressable>
        }
        center={<Text style={styles.headerTitle}>Notes</Text>}
        right={
          <View style={styles.headerActions}>
            <RoundButton
              icon={RefreshCw}
              onPress={() => {
                if (!syncing) void handleSync();
              }}
              accessibilityLabel="Sync vault"
              style={{ opacity: syncing ? 0.5 : 1 }}
            />
            <RoundButton
              icon={Plus}
              onPress={() => setNewOpen(true)}
              accessibilityLabel="New note"
            />
          </View>
        }
      />

      {/* Notice Banner */}
      {notice ? (
        <View style={styles.noticeBox}>
          <Text style={styles.noticeText}>{notice}</Text>
          <Pressable onPress={() => setNotice(null)} hitSlop={8}>
            <X size={16} color={colors.recording} />
          </Pressable>
        </View>
      ) : null}

      {/* Toast Notification */}
      {toastMessage ? (
        <View style={[styles.toastBox, shadow.floating]}>
          <Text style={styles.toastText}>{toastMessage}</Text>
        </View>
      ) : null}

      {loading ? (
        <View style={styles.center}>
          <Spinner size="lg" color="default" />
        </View>
      ) : (
        <ScrollView
          contentContainerStyle={{
            paddingBottom: insets.bottom + 100, // accommodate tab bar dock
            gap: space.xl,
          }}
          keyboardShouldPersistTaps="handled"
          showsVerticalScrollIndicator={false}
          refreshControl={
            <RefreshControl
              refreshing={refreshing}
              onRefresh={() => {
                setRefreshing(true);
                void load();
              }}
              tintColor={colors.textPrimary}
            />
          }
        >
          {/* 1. Pill Search Bar */}
          <View style={styles.searchSection}>
            <View style={styles.searchBar}>
              <Search size={18} color={colors.textSecondary} strokeWidth={2} />
              <TextInput
                style={styles.searchInput}
                placeholder="Search notes, tags..."
                placeholderTextColor={colors.textSecondary}
                value={query}
                onChangeText={handleQueryChange}
                autoCapitalize="none"
                autoCorrect={false}
              />
              {query ? (
                <Pressable
                  onPress={() => {
                    setQuery('');
                    setSearchMatches(null);
                  }}
                  accessibilityRole="button"
                  accessibilityLabel="Clear search"
                  hitSlop={8}
                >
                  <X size={16} color={colors.textSecondary} />
                </Pressable>
              ) : null}
            </View>
          </View>

          {/* 2. 2x2 Quick-Create Cards Grid (hidden during active search) */}
          {!trimmedQuery ? (
            <QuickCreateGrid onCreate={handleQuickCreate} />
          ) : null}

          {/* 3. Recent Notes Section */}
          <View style={styles.recentSection}>
            <View style={styles.sectionHeaderRow}>
              <Text style={styles.sectionTitle}>
                {trimmedQuery ? 'Search Results' : 'Recent Notes'}
              </Text>
              <Text style={styles.sectionCount}>
                {`${filteredNotes.length} ${filteredNotes.length === 1 ? 'note' : 'notes'}`}
              </Text>
            </View>

            {filteredNotes.length === 0 ? (
              <View style={styles.emptyContainer}>
                <View style={styles.emptyIconBox}>
                  <FileText size={32} color={colors.textSecondary} strokeWidth={1.5} />
                </View>
                <Text style={styles.emptyTitle}>
                  {trimmedQuery ? 'No matching notes' : 'No notes yet'}
                </Text>
                <Text style={styles.emptySubtitle}>
                  {trimmedQuery
                    ? `No notes found matching "${trimmedQuery}".`
                    : 'Create your first note above to start your second brain.'}
                </Text>
                {!trimmedQuery ? (
                  <PillButton
                    label="Create note"
                    onPress={() => setNewOpen(true)}
                    variant="primary"
                    style={{ marginTop: space.sm }}
                  />
                ) : null}
              </View>
            ) : (
              <View style={styles.notesList}>
                {filteredNotes.map((item) => (
                  <NoteCard
                    key={item.id}
                    note={item}
                    content={noteContents[item.path]}
                    onPress={() =>
                      router.push({ pathname: '/note', params: { path: item.path } })
                    }
                    onDelete={() => handleDelete(item)}
                    onDuplicate={() => void handleDuplicate(item)}
                    onTogglePin={(p) => void handleTogglePin(item, p)}
                  />
                ))}
              </View>
            )}
          </View>
        </ScrollView>
      )}

      {/* New Note Creation Modal */}
      <Modal
        visible={newOpen}
        transparent
        animationType="fade"
        onRequestClose={() => setNewOpen(false)}
      >
        <View style={styles.modalBackdrop}>
          <View style={[styles.modalCard, shadow.floating]}>
            <View style={styles.modalHeader}>
              <Text style={styles.modalTitle}>New Note</Text>
              <Pressable
                onPress={() => setNewOpen(false)}
                accessibilityRole="button"
                accessibilityLabel="Close dialog"
                hitSlop={8}
              >
                <X size={20} color={colors.textSecondary} />
              </Pressable>
            </View>
            <TextInput
              autoFocus
              style={styles.modalInput}
              placeholder="Note title (e.g. Daily Journal Entry)"
              placeholderTextColor={colors.textSecondary}
              value={newTitle}
              onChangeText={setNewTitle}
              onSubmitEditing={() => void handleCreate()}
              returnKeyType="done"
            />
            <PillButton
              label={creating ? 'Creating…' : 'Create note'}
              onPress={() => void handleCreate()}
              disabled={creating || !newTitle.trim()}
              variant="primary"
            />
          </View>
        </View>
      </Modal>
    </View>
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
  headerTitle: {
    fontSize: 20,
    lineHeight: 26,
    fontWeight: '600',
    color: colors.textPrimary,
  },
  initialsAvatar: {
    width: 44,
    height: 44,
    borderRadius: radius.pill,
    backgroundColor: colors.surfaceRaised,
    alignItems: 'center',
    justifyContent: 'center',
  },
  initialsText: {
    fontSize: 17,
    lineHeight: 22,
    fontWeight: '600',
    color: colors.textPrimary,
  },
  headerActions: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: space.sm,
  },
  noticeBox: {
    marginHorizontal: space.lg,
    marginBottom: space.sm,
    padding: space.md,
    borderRadius: radius.card,
    backgroundColor: colors.recordingBg,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
  },
  noticeText: {
    fontSize: 13,
    color: colors.recording,
    flex: 1,
  },
  toastBox: {
    position: 'absolute',
    top: 100,
    alignSelf: 'center',
    backgroundColor: colors.primary,
    borderRadius: radius.pill,
    paddingHorizontal: space.lg,
    paddingVertical: 10,
    zIndex: 999,
  },
  toastText: {
    color: colors.onPrimary,
    fontSize: 13,
    fontWeight: '600',
  },
  searchSection: {
    paddingHorizontal: space.lg,
    paddingTop: space.xs,
  },
  searchBar: {
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: colors.surface,
    borderRadius: radius.pill,
    paddingHorizontal: space.md,
    height: 44,
    gap: space.sm,
  },
  searchInput: {
    flex: 1,
    fontSize: 16,
    color: colors.textPrimary,
  },
  recentSection: {
    paddingHorizontal: space.lg,
    gap: space.md,
  },
  sectionHeaderRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
  },
  sectionTitle: {
    fontSize: 20,
    lineHeight: 26,
    fontWeight: '700',
    color: colors.textPrimary,
  },
  sectionCount: {
    fontSize: 13,
    fontWeight: '500',
    color: colors.textSecondary,
  },
  notesList: {
    gap: space.md,
  },
  emptyContainer: {
    alignItems: 'center',
    paddingVertical: 48,
    gap: space.xs,
  },
  emptyIconBox: {
    width: 64,
    height: 64,
    borderRadius: radius.card,
    backgroundColor: colors.surface,
    alignItems: 'center',
    justifyContent: 'center',
    marginBottom: space.sm,
  },
  emptyTitle: {
    fontSize: 17,
    fontWeight: '600',
    color: colors.textPrimary,
  },
  emptySubtitle: {
    fontSize: 14,
    lineHeight: 20,
    color: colors.textSecondary,
    textAlign: 'center',
    maxWidth: 280,
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
    fontSize: 20,
    fontWeight: '700',
    color: colors.textPrimary,
  },
  modalInput: {
    backgroundColor: colors.surface,
    borderRadius: radius.card,
    paddingHorizontal: space.lg,
    paddingVertical: space.md,
    fontSize: 16,
    color: colors.textPrimary,
  },
});
