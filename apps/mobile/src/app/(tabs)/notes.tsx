import React, { useCallback, useEffect, useMemo, useState } from 'react';
import {
  Alert,
  Pressable,
  RefreshControl,
  FlatList,
  StyleSheet,
  Text,
  TextInput,
  View,
} from 'react-native';
import { Spinner } from 'heroui-native';
import { useFocusEffect, useRouter } from 'expo-router';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { FileText, Plus, RefreshCw, Search, X } from 'lucide-react-native';
import { SymbolIcon } from '@/components/symbol-icon';
import type { Note, NoteChunk } from '@agent/shared';

import { AppHeader, HeaderAvatar, useHeaderInset } from '@/components/app-header';
import { reportAppError } from '@/components/error-dialog-provider';
import { InlineError, PillButton, RoundButton } from '@/components/design-system';
import { Sheet, SheetHeader } from '@/components/sheet';
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

/** First meaningful line of a note, for the search result subtitle. */
function notePreviewLine(note: Note, content?: string): string {
  let body = content ?? '';
  if (body.startsWith('---')) {
    const end = body.indexOf('---', 3);
    if (end >= 0) body = body.slice(end + 3);
  }
  for (const raw of body.split('\n')) {
    const line = raw.trim();
    if (!line || line.startsWith('#') || line.startsWith('---')) continue;
    const check = line.match(/^[-*]\s*\[[ xX]\]\s*(.*)$/);
    if (check) return check[1].trim() || line;
    return line.replace(/^[-*]\s+/, '');
  }
  return note.path;
}

/** Renders `text` with the first `term` occurrence bold (DESIGN §6.9). */
function Highlight({ text, term }: { text: string; term: string }) {
  const needle = term.trim().toLowerCase();
  if (!needle) return <>{text}</>;
  const index = text.toLowerCase().indexOf(needle);
  if (index < 0) return <>{text}</>;
  return (
    <>
      {text.slice(0, index)}
      <Text style={styles.resultMatch}>{text.slice(index, index + needle.length)}</Text>
      {text.slice(index + needle.length)}
    </>
  );
}

/** 6.9 Result row: 60pt tile, title 20/500, one-line preview 17 secondary. */
function SearchResultRow({
  note,
  content,
  term,
  onPress,
}: {
  note: Note;
  content?: string;
  term: string;
  onPress: () => void;
}) {
  const title = note.title || (note.path.split('/').pop()?.replace('.md', '') ?? 'Untitled');
  const preview = notePreviewLine(note, content);
  return (
    <Pressable
      onPress={onPress}
      accessibilityRole="button"
      accessibilityLabel={`Open note ${title}`}
      style={({ pressed }) => [styles.resultRow, pressed && styles.resultRowPressed]}
    >
      <View style={styles.resultTile}>
        <SymbolIcon icon={FileText} size={24} color={colors.textSecondary} strokeWidth={1.75} />
      </View>
      <View style={styles.resultText}>
        <Text numberOfLines={1} style={styles.resultTitle}>
          {title}
        </Text>
        <Text numberOfLines={1} style={styles.resultSubtitle}>
          <Highlight text={preview} term={term} />
        </Text>
      </View>
    </Pressable>
  );
}

/** Spacer between virtualized note rows — matches the old `notesList` gap. */
function NoteRowSeparator() {
  return <View style={{ height: space.md }} />;
}

/**
 * Note preview contents, cached outside the component so returning to the tab
 * does not re-read every note. The note's `updated_at` is stored alongside
 * the content: a note that changed since it was cached is read again.
 */
const previewCache = new Map<string, { updatedAt: string; content: string }>();

export default function NotesScreen() {
  const router = useRouter();
  const insets = useSafeAreaInsets();
  const { session } = useSession();

  const [notes, setNotes] = useState<Note[]>([]);
  const [noteContents, setNoteContents] = useState<Record<string, string>>({});
  const [query, setQuery] = useState('');
  const [searchMatches, setSearchMatches] = useState<NoteChunk[] | null>(null);
  const [searchOpen, setSearchOpen] = useState(false);
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

      // Fetch note content for previews (top 15 recent notes). Cached
      // previews are reused until the note itself changes.
      const toFetch = sorted.slice(0, 15);
      void Promise.all(
        toFetch.map(async (n) => {
          const cached = previewCache.get(n.path);
          if (cached && cached.updatedAt === n.updated_at) {
            return [n.path, cached.content] as const;
          }
          try {
            const data = await fetchNote(n.path);
            const content = data?.content ?? '';
            previewCache.set(n.path, { updatedAt: n.updated_at, content });
            return [n.path, content] as const;
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
  // Tag searches (`#tag`) match on the term without the hash — bold that part.
  const highlightTerm = trimmedQuery.startsWith('#') ? trimmedQuery.slice(1) : trimmedQuery;

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
      previewCache.delete(newPath);
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
            previewCache.delete(note.path);
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

  const headerInset = useHeaderInset();

  return (
    <View style={styles.screen}>
      {/* Floating AppHeader */}
      <AppHeader
        left={
          <HeaderAvatar
            initial={userInitial}
            onPress={() => router.push('/more')}
          />
        }
        center={<Text style={styles.headerTitle}>Notes</Text>}
        right={
          <View style={styles.headerActions}>
            <RoundButton
              size={36}
              icon={RefreshCw}
              onPress={() => {
                if (!syncing) void handleSync();
              }}
              accessibilityLabel="Sync vault"
              style={{ opacity: syncing ? 0.5 : 1 }}
            />
            <RoundButton
              size={36}
              icon={Plus}
              onPress={() => setNewOpen(true)}
              accessibilityLabel="New note"
            />
          </View>
        }
      />

      {/* Load failure banner */}
      {notice ? (
        <InlineError
          message={notice}
          onRetry={() => void load()}
          style={[styles.noticeBox, { marginTop: headerInset }]}
        />
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
        <FlatList
          data={filteredNotes}
          keyExtractor={(item) => item.id}
          renderItem={({ item }) => (
            <View style={styles.noteRow}>
              <NoteCard
                note={item}
                content={noteContents[item.path]}
                onPress={() =>
                  router.push({ pathname: '/note', params: { path: item.path } })
                }
                onDelete={() => handleDelete(item)}
                onDuplicate={() => void handleDuplicate(item)}
                onTogglePin={(p) => void handleTogglePin(item, p)}
              />
            </View>
          )}
          ItemSeparatorComponent={NoteRowSeparator}
          ListHeaderComponent={
            <View style={styles.listHeader}>
              {/* 1. Pill Search Bar — opens the search sheet (DESIGN §6.9) */}
              <View style={styles.searchSection}>
                <Pressable
                  onPress={() => setSearchOpen(true)}
                  accessibilityRole="button"
                  accessibilityLabel="Search notes"
                  style={({ pressed }) => [styles.searchBar, pressed && styles.searchBarPressed]}
                >
                  <SymbolIcon icon={Search} size={18} color={colors.textSecondary} strokeWidth={2} />
                  <Text
                    numberOfLines={1}
                    style={[styles.searchBarText, !trimmedQuery && styles.searchBarPlaceholder]}
                  >
                    {trimmedQuery || 'Search notes, tags...'}
                  </Text>
                </Pressable>
              </View>

              {/* 2. 2x2 Quick-Create Cards Grid (hidden during active search) */}
              {!trimmedQuery ? <QuickCreateGrid onCreate={handleQuickCreate} /> : null}

              {/* 3. Recent Notes Section */}
              <View style={[styles.recentSection, styles.recentSectionFirstRow]}>
                <View style={styles.sectionHeaderRow}>
                  <Text style={styles.sectionTitle}>
                    {trimmedQuery ? 'Search results' : 'Recent notes'}
                  </Text>
                  <Text style={styles.sectionCount}>
                    {`${filteredNotes.length} ${filteredNotes.length === 1 ? 'note' : 'notes'}`}
                  </Text>
                </View>
              </View>
            </View>
          }
          ListEmptyComponent={
            <View style={styles.noteRow}>
              <View style={styles.emptyContainer}>
                <View style={styles.emptyIconBox}>
                  <SymbolIcon icon={FileText} size={32} color={colors.textSecondary} strokeWidth={1.5} />
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
            </View>
          }
          contentContainerStyle={{
            // With no notice the list starts below the floating header; with
            // one, the notice already clears the header and its own 8pt
            // margin is followed by the search field's 4pt padding.
            paddingTop: notice ? space.xs : headerInset,
            paddingBottom: insets.bottom + 100, // accommodate tab bar dock
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
        />
      )}

      {/* New Note Sheet (DESIGN §6.8 — bottom sheet, never a centered modal) */}
      <Sheet
        visible={newOpen}
        onClose={() => setNewOpen(false)}
        backdropLabel="Close new note sheet"
      >
        <SheetHeader onClose={() => setNewOpen(false)} closeLabel="Close new note">
          <Text style={styles.sheetTitle} numberOfLines={1}>
            New note
          </Text>
        </SheetHeader>
        <TextInput
          autoFocus
          style={styles.sheetInput}
          placeholder="Note title (e.g. Daily Journal Entry)"
          placeholderTextColor={colors.textSecondary}
          value={newTitle}
          onChangeText={setNewTitle}
          onSubmitEditing={() => void handleCreate()}
          returnKeyType="done"
        />
        <View style={styles.sheetActions}>
          <PillButton
            label={creating ? 'Creating…' : 'Create note'}
            onPress={() => void handleCreate()}
            disabled={creating || !newTitle.trim()}
            variant="primary"
          />
        </View>
      </Sheet>

      {/* Search Sheet (DESIGN §6.9) */}
      <Sheet
        visible={searchOpen}
        onClose={() => setSearchOpen(false)}
        backdropLabel="Close search"
        style={styles.searchSheet}
      >
        <SheetHeader onClose={() => setSearchOpen(false)} closeLabel="Close search">
          <View style={styles.sheetSearchField}>
            <SymbolIcon icon={Search} size={18} color={colors.textSecondary} strokeWidth={2} />
            <TextInput
              autoFocus
              style={styles.sheetSearchInput}
              placeholder="Search notes, tags..."
              placeholderTextColor={colors.textSecondary}
              value={query}
              onChangeText={handleQueryChange}
              autoCapitalize="none"
              autoCorrect={false}
            />
            {query ? (
              <Pressable
                onPress={() => handleQueryChange('')}
                accessibilityRole="button"
                accessibilityLabel="Clear search"
                hitSlop={10}
                style={({ pressed }) => [
                  styles.clearButton,
                  pressed && styles.clearButtonPressed,
                ]}
              >
                <SymbolIcon icon={X} size={14} color={colors.textSecondary} />
              </Pressable>
            ) : null}
          </View>
        </SheetHeader>

        <View style={styles.sectionHeaderRow}>
          <Text style={styles.sectionTitle}>
            {trimmedQuery ? 'Search results' : 'All notes'}
          </Text>
          <Text style={styles.sectionCount}>
            {`${filteredNotes.length} ${filteredNotes.length === 1 ? 'note' : 'notes'}`}
          </Text>
        </View>

        {filteredNotes.length === 0 ? (
          <View style={[styles.emptyContainer, styles.sheetEmpty]}>
            <View style={styles.emptyIconBox}>
              <SymbolIcon icon={FileText} size={32} color={colors.textSecondary} strokeWidth={1.5} />
            </View>
            <Text style={styles.emptyTitle}>
              {trimmedQuery ? 'No matching notes' : 'No notes yet'}
            </Text>
            <Text style={styles.emptySubtitle}>
              {trimmedQuery
                ? `No notes found matching "${trimmedQuery}".`
                : 'Create your first note to start your second brain.'}
            </Text>
          </View>
        ) : (
          <FlatList
            style={styles.resultsScroll}
            contentContainerStyle={styles.resultsContent}
            data={filteredNotes}
            keyExtractor={(item) => item.id}
            renderItem={({ item }) => (
              <SearchResultRow
                note={item}
                content={noteContents[item.path]}
                term={highlightTerm}
                onPress={() => {
                  setSearchOpen(false);
                  router.push({ pathname: '/note', params: { path: item.path } });
                }}
              />
            )}
            showsVerticalScrollIndicator={false}
            keyboardShouldPersistTaps="handled"
            keyboardDismissMode="on-drag"
          />
        )}
      </Sheet>
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
    fontSize: 17,
    lineHeight: 22,
    fontWeight: '600',
    color: colors.textPrimary,
  },
  initialsAvatar: {
    width: 44,
    height: 44,
    borderRadius: radius.pill,
    backgroundColor: colors.profileAvatar,
    alignItems: 'center',
    justifyContent: 'center',
  },
  initialsText: {
    fontSize: 20,
    lineHeight: 26,
    fontWeight: '500',
    color: colors.textSecondary,
  },
  headerActions: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: space.sm,
  },
  noticeBox: {
    marginHorizontal: space.lg,
    marginBottom: space.sm,
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
  searchBarPressed: {
    opacity: 0.6,
  },
  searchBarText: {
    flex: 1,
    fontSize: 16,
    color: colors.textPrimary,
  },
  searchBarPlaceholder: {
    color: colors.textSecondary,
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
    fontWeight: '600',
    color: colors.textPrimary,
  },
  sectionCount: {
    fontSize: 13,
    fontWeight: '500',
    color: colors.textSecondary,
    fontVariant: ['tabular-nums'],
  },
  listHeader: {
    gap: space.xl,
  },
  recentSectionFirstRow: {
    // Space between the section header and the first row — the old
    // `recentSection` gap, now that the rows live in the FlatList.
    marginBottom: space.md,
  },
  noteRow: {
    paddingHorizontal: space.lg,
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
    fontSize: 20,
    lineHeight: 26,
    fontWeight: '600',
    color: colors.textPrimary,
  },
  emptySubtitle: {
    fontSize: 15,
    lineHeight: 20,
    color: colors.textSecondary,
    textAlign: 'center',
    maxWidth: 280,
  },
  sheetTitle: {
    fontSize: 20,
    lineHeight: 26,
    fontWeight: '600',
    color: colors.textPrimary,
  },
  sheetActions: {
    alignItems: 'center',
  },
  sheetInput: {
    backgroundColor: colors.surface,
    borderRadius: radius.card,
    paddingHorizontal: space.lg,
    paddingVertical: space.md,
    fontSize: 16,
    color: colors.textPrimary,
  },
  searchSheet: {
    height: '85%',
  },
  sheetSearchField: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: space.sm,
    backgroundColor: colors.surface,
    borderRadius: radius.pill,
    paddingHorizontal: space.md,
    height: 44,
  },
  sheetSearchInput: {
    flex: 1,
    fontSize: 20,
    fontWeight: '400',
    color: colors.textPrimary,
  },
  clearButton: {
    width: 24,
    height: 24,
    borderRadius: radius.pill,
    backgroundColor: colors.divider,
    alignItems: 'center',
    justifyContent: 'center',
  },
  clearButtonPressed: {
    opacity: 0.6,
  },
  resultsScroll: {
    flex: 1,
  },
  resultsContent: {
    gap: space.xl,
    paddingBottom: space.xl,
  },
  resultRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: space.lg,
  },
  resultRowPressed: {
    opacity: 0.6,
  },
  resultTile: {
    width: 60,
    height: 60,
    borderRadius: radius.tile,
    backgroundColor: colors.surface,
    alignItems: 'center',
    justifyContent: 'center',
  },
  resultText: {
    flex: 1,
    gap: 2,
  },
  resultTitle: {
    fontSize: 20,
    lineHeight: 26,
    fontWeight: '500',
    color: colors.textPrimary,
  },
  resultSubtitle: {
    fontSize: 17,
    lineHeight: 22,
    color: colors.textSecondary,
  },
  resultMatch: {
    fontWeight: '600',
  },
  sheetEmpty: {
    flex: 1,
    justifyContent: 'center',
    paddingVertical: 0,
  },
});
