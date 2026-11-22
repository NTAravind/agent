import React, { useCallback, useEffect, useMemo, useState } from 'react';
import {
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
import { ChevronRight, FileText, Folder, Plus, RefreshCw, Search, X } from 'lucide-react-native';
import type { Note, NoteChunk } from '@agent/shared';

import { AppHeader } from '@/components/app-header';
import { GroupedCard, HairlineDivider, PillButton, RoundButton } from '@/components/design-system';
import { colors, radius, shadow, space } from '@/theme';
import { fetchNotes, saveNote, searchNotes, suggestNotePath, syncVault } from '@/lib/knowledge';
import { useSession } from '@/lib/session';

function formatNoteDate(dateStr?: string | null): string {
  if (!dateStr) return 'Markdown note';
  const date = new Date(dateStr);
  if (isNaN(date.getTime())) return 'Markdown note';

  const now = new Date();
  const isToday =
    date.getDate() === now.getDate() &&
    date.getMonth() === now.getMonth() &&
    date.getFullYear() === now.getFullYear();

  if (isToday) {
    return `Updated today, ${date.toLocaleTimeString([], { hour: 'numeric', minute: '2-digit' })}`;
  }
  return `Updated ${date.toLocaleDateString([], { month: 'short', day: 'numeric' })}`;
}

export default function NotesScreen() {
  const router = useRouter();
  const insets = useSafeAreaInsets();
  const { session } = useSession();

  const [notes, setNotes] = useState<Note[]>([]);
  const [search, setSearch] = useState<{ query: string; results: NoteChunk[] } | null>(null);
  const [query, setQuery] = useState('');
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [syncing, setSyncing] = useState(false);
  const [notice, setNotice] = useState<string | null>(null);
  const [newOpen, setNewOpen] = useState(false);
  const [newTitle, setNewTitle] = useState('');
  const [creating, setCreating] = useState(false);

  const load = useCallback(async () => {
    try {
      setNotes(await fetchNotes());
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

  // The visible results are derived during render: an empty query simply has
  // no results, and results from an older query are never shown against a
  // newer one. Clearing the search is therefore not an effect at all.
  const matches = trimmedQuery && search?.query === trimmedQuery ? search.results : null;

  useEffect(() => {
    if (!trimmedQuery) return;

    let active = true;
    const timer = setTimeout(() => {
      void searchNotes(trimmedQuery).then((result) => {
        if (active) setSearch({ query: trimmedQuery, results: result });
      });
    }, 250);

    return () => {
      active = false;
      clearTimeout(timer);
    };
  }, [trimmedQuery]);

  const handleSync = useCallback(async () => {
    setSyncing(true);
    setNotice(null);
    try {
      const summary = await syncVault();
      setNotice(summary.message ?? (summary.ok ? 'Vault synced successfully.' : 'Vault sync initiated.'));
      await load();
    } catch (error) {
      setNotice(error instanceof Error ? error.message : String(error));
    } finally {
      setSyncing(false);
    }
  }, [load]);

  const handleCreate = useCallback(async () => {
    const title = newTitle.trim();
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
      setNotice(error instanceof Error ? error.message : String(error));
    } finally {
      setCreating(false);
    }
  }, [newTitle, router]);

  const grouped = useMemo(() => {
    const folders = new Map<string, Note[]>();
    for (const note of notes) {
      const folder = note.path.includes('/') ? note.path.split('/')[0]! : 'General';
      const list = folders.get(folder) ?? [];
      list.push(note);
      folders.set(folder, list);
    }
    return [...folders.entries()].sort(([a], [b]) => a.localeCompare(b));
  }, [notes]);

  const userInitial = session?.user.email ? session.user.email.slice(0, 2).toUpperCase() : 'FL';

  return (
    <View style={styles.screen}>
      {/* 6.1 Floating AppHeader */}
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
        center={
          <Text style={styles.headerTitle}>Notes</Text>
        }
        right={
          <View style={styles.headerActions}>
            <RoundButton
              icon={RefreshCw}
              onPress={() => void handleSync()}
              accessibilityLabel="Sync vault"
            />
            <RoundButton
              icon={Plus}
              onPress={() => setNewOpen(true)}
              accessibilityLabel="New note"
            />
          </View>
        }
      />

      {/* Pill Search Input */}
      <View style={{ paddingHorizontal: space.lg, paddingVertical: space.xs }}>
        <View style={styles.searchBar}>
          <Search size={16} color={colors.textSecondary} strokeWidth={1.75} />
          <TextInput
            style={styles.searchInput}
            placeholder="Search notes…"
            placeholderTextColor={colors.textSecondary}
            value={query}
            onChangeText={setQuery}
            autoCapitalize="none"
            autoCorrect={false}
          />
          {query ? (
            <Pressable onPress={() => setQuery('')} accessibilityRole="button" accessibilityLabel="Clear">
              <X size={16} color={colors.textSecondary} />
            </Pressable>
          ) : null}
        </View>
      </View>

      {notice ? (
        <View style={styles.noticeBox}>
          <Text style={styles.noticeText}>{notice}</Text>
        </View>
      ) : null}

      {loading ? (
        <View style={styles.center}>
          <Spinner size="lg" color="default" />
        </View>
      ) : (
        <ScrollView
          contentContainerStyle={{
            paddingHorizontal: space.lg,
            paddingTop: space.sm,
            paddingBottom: insets.bottom + 100, // accommodate pill dock
            gap: space.lg,
          }}
          keyboardShouldPersistTaps="handled"
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
          {matches ? (
            <View style={{ gap: space.sm }}>
              <Text style={styles.sectionLabel}>
                {`${matches.length} Result${matches.length === 1 ? '' : 's'}`}
              </Text>
              <GroupedCard>
                {matches.map((match, index) => (
                  <React.Fragment key={match.chunk_id}>
                    {index > 0 && <HairlineDivider inset={60} />}
                    <Pressable
                      onPress={() =>
                        router.push({ pathname: '/note', params: { path: match.path } })
                      }
                      accessibilityRole="button"
                      accessibilityLabel={match.path}
                      style={({ pressed }) => [
                        styles.noteRow,
                        { opacity: pressed ? 0.6 : 1 },
                      ]}
                    >
                      <View style={styles.tileIcon}>
                        <FileText size={18} color={colors.textSecondary} strokeWidth={1.75} />
                      </View>
                      <View style={styles.noteContent}>
                        <Text numberOfLines={1} style={styles.noteName}>
                          {match.path.replace(/\.md$/i, '')}
                          <Text style={styles.noteExt}>.md</Text>
                        </Text>
                        <Text numberOfLines={1} style={styles.previewText}>
                          {match.content.slice(0, 80)}
                        </Text>
                      </View>
                      <ChevronRight size={16} color={colors.textTertiary} strokeWidth={1.75} />
                    </Pressable>
                  </React.Fragment>
                ))}
              </GroupedCard>
              {matches.length === 0 ? (
                <Text style={styles.emptyText}>
                  No matching notes found.
                </Text>
              ) : null}
            </View>
          ) : notes.length === 0 ? (
            <View style={styles.emptyContainer}>
              <View style={styles.emptyIconBox}>
                <FileText size={32} color={colors.textSecondary} strokeWidth={1.5} />
              </View>
              <Text style={styles.emptyTitle}>No notes yet</Text>
              <Text style={styles.emptySubtitle}>
                Add markdown notes to your vault or tap + to create one.
              </Text>
              <PillButton
                label="Create note"
                onPress={() => setNewOpen(true)}
                variant="primary"
                style={{ marginTop: space.md }}
              />
            </View>
          ) : (
            grouped.map(([folder, folderNotes]) => (
              <View key={folder} style={{ gap: space.xs }}>
                <View style={styles.folderHeader}>
                  <Folder size={14} color={colors.textSecondary} />
                  <Text style={styles.sectionLabel}>{folder}</Text>
                </View>
                <GroupedCard>
                  {folderNotes.map((note, index) => {
                    const rawName = note.title || note.path.split('/').pop() || note.path;
                    const baseName = rawName.replace(/\.md$/i, '');
                    return (
                      <React.Fragment key={note.id}>
                        {index > 0 && <HairlineDivider inset={60} />}
                        <Pressable
                          onPress={() =>
                            router.push({ pathname: '/note', params: { path: note.path } })
                          }
                          accessibilityRole="button"
                          accessibilityLabel={note.title ?? note.path}
                          style={({ pressed }) => [
                            styles.noteRow,
                            { opacity: pressed ? 0.6 : 1 },
                          ]}
                        >
                          <View style={styles.tileIcon}>
                            <FileText size={18} color={colors.textSecondary} strokeWidth={1.75} />
                          </View>
                          <View style={styles.noteContent}>
                            <Text numberOfLines={1} style={styles.noteName}>
                              {baseName}
                              <Text style={styles.noteExt}>.md</Text>
                            </Text>
                            <Text numberOfLines={1} style={styles.noteSubtitle}>
                              {formatNoteDate(note.updated_at)}
                            </Text>
                          </View>
                          <ChevronRight size={16} color={colors.textTertiary} strokeWidth={1.75} />
                        </Pressable>
                      </React.Fragment>
                    );
                  })}
                </GroupedCard>
              </View>
            ))
          )}
        </ScrollView>
      )}

      {/* New Note Modal */}
      <Modal visible={newOpen} transparent animationType="fade" onRequestClose={() => setNewOpen(false)}>
        <View style={styles.modalBackdrop}>
          <View style={styles.modalCard}>
            <View style={styles.modalHeader}>
              <Text style={styles.modalTitle}>New Note</Text>
              <Pressable
                onPress={() => setNewOpen(false)}
                accessibilityRole="button"
                accessibilityLabel="Close"
              >
                <X size={20} color={colors.textSecondary} />
              </Pressable>
            </View>
            <TextInput
              autoFocus
              style={styles.modalInput}
              placeholder="Note title or path (e.g. Ideas/Project)"
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
  searchBar: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: space.sm,
    backgroundColor: colors.surface,
    borderRadius: radius.pill,
    paddingHorizontal: space.md,
    height: 44,
  },
  searchInput: {
    flex: 1,
    fontSize: 16,
    color: colors.textPrimary,
  },
  noticeBox: {
    marginHorizontal: space.lg,
    marginBottom: space.sm,
    backgroundColor: colors.surface,
    borderRadius: radius.card,
    paddingHorizontal: space.md,
    paddingVertical: space.sm,
  },
  noticeText: {
    fontSize: 14,
    color: colors.textSecondary,
  },
  center: {
    paddingVertical: 64,
    alignItems: 'center',
    justifyContent: 'center',
  },
  folderHeader: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
    paddingHorizontal: space.xs,
  },
  sectionLabel: {
    fontSize: 15,
    lineHeight: 20,
    color: colors.textSecondary,
    fontWeight: '500',
  },
  noteRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: space.md,
    paddingHorizontal: space.lg,
    paddingVertical: 12,
  },
  tileIcon: {
    width: 36,
    height: 36,
    borderRadius: radius.tile,
    backgroundColor: colors.surfaceRaised,
    alignItems: 'center',
    justifyContent: 'center',
  },
  noteContent: {
    flex: 1,
    minWidth: 0,
    gap: 2,
  },
  noteName: {
    fontSize: 16,
    lineHeight: 22,
    fontWeight: '500',
    color: colors.textPrimary,
  },
  noteExt: {
    fontSize: 16,
    lineHeight: 22,
    fontWeight: '400',
    color: colors.textTertiary,
  },
  noteSubtitle: {
    fontSize: 13,
    lineHeight: 16,
    color: colors.textSecondary,
  },
  previewText: {
    fontSize: 13,
    lineHeight: 16,
    color: colors.textSecondary,
  },
  emptyContainer: {
    marginTop: 64,
    alignItems: 'center',
    justifyContent: 'center',
    paddingHorizontal: space.xl,
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
  emptyText: {
    fontSize: 15,
    color: colors.textSecondary,
    textAlign: 'center',
    paddingVertical: space.md,
  },
  modalBackdrop: {
    flex: 1,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: colors.overlay,
    paddingHorizontal: space.lg,
  },
  modalCard: {
    width: '100%',
    maxWidth: 400,
    borderRadius: radius.sheet,
    backgroundColor: colors.surfaceRaised,
    padding: space.xl,
    gap: space.md,
    ...shadow.floating,
  },
  modalHeader: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
  },
  modalTitle: {
    fontSize: 20,
    lineHeight: 26,
    fontWeight: '600',
    color: colors.textPrimary,
  },
  modalInput: {
    borderRadius: radius.pill,
    backgroundColor: colors.surface,
    paddingHorizontal: space.md,
    paddingVertical: 12,
    fontSize: 17,
    color: colors.textPrimary,
  },
});
