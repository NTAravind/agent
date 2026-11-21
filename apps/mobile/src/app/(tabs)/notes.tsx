import { useCallback, useEffect, useMemo, useState } from 'react';
import { Modal, Pressable, RefreshControl, ScrollView, Text, TextInput, View } from 'react-native';
import { Spinner, Typography } from 'heroui-native';
import { useFocusEffect, useRouter } from 'expo-router';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { FileText, Folder, Plus, RefreshCw, Search, X } from 'lucide-react-native';
import type { Note, NoteChunk } from '@agent/shared';

import { AppHeader } from '@/components/app-header';
import { fetchNotes, saveNote, searchNotes, suggestNotePath, syncVault } from '@/lib/knowledge';

export default function NotesScreen() {
  const router = useRouter();
  const insets = useSafeAreaInsets();

  const [notes, setNotes] = useState<Note[]>([]);
  const [matches, setMatches] = useState<NoteChunk[] | null>(null);
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

  useEffect(() => {
    const trimmed = query.trim();
    if (!trimmed) return;

    let active = true;
    const timer = setTimeout(() => {
      void searchNotes(trimmed).then((result) => {
        if (active) setMatches(result);
      });
    }, 350);

    return () => {
      active = false;
      clearTimeout(timer);
    };
  }, [query]);

  const handleSync = useCallback(async () => {
    setSyncing(true);
    setNotice(null);
    const result = await syncVault();
    setSyncing(false);
    setNotice(
      result.ok
        ? 'Vault sync queued. Index refreshes in background.'
        : (result.message ?? 'Could not sync vault.'),
    );
    if (result.ok) void load();
  }, [load]);

  const effectiveMatches = query.trim() ? matches : null;

  const handleCreate = useCallback(async () => {
    const title = newTitle.trim();
    if (!title || creating) return;
    setCreating(true);
    try {
      const path = suggestNotePath(title);
      await saveNote(path, `# ${title}\n\n`);
      setNewOpen(false);
      setNewTitle('');
      router.push({ pathname: '/note', params: { path } });
    } catch (error) {
      setNotice(error instanceof Error ? error.message : String(error));
    } finally {
      setCreating(false);
    }
  }, [creating, newTitle, router]);

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

  return (
    <View className="flex-1 bg-white dark:bg-[#09090b]">
      <AppHeader
        left={
          <Pressable
            onPress={() => router.back()}
            accessibilityRole="button"
            className="px-2 py-1 active:opacity-60"
          >
            <Typography type="body" className="text-zinc-500 dark:text-zinc-400">
              Close
            </Typography>
          </Pressable>
        }
        center={
          <Typography type="body" weight="semibold" className="text-zinc-900 dark:text-white">
            Knowledge Vault
          </Typography>
        }
        right={
          <View className="flex-row items-center gap-1.5">
            <Pressable
              onPress={() => setNewOpen(true)}
              accessibilityRole="button"
              accessibilityLabel="New note"
              className="h-8.5 w-8.5 items-center justify-center rounded-full border border-zinc-200 dark:border-white/10 bg-zinc-50 dark:bg-white/5 active:opacity-75"
            >
              <Plus size={14} color="#71717a" />
            </Pressable>
            <Pressable
              onPress={() => void handleSync()}
              disabled={syncing}
              accessibilityRole="button"
              accessibilityLabel="Sync vault"
              className="h-8.5 px-3 flex-row items-center gap-1.5 rounded-full border border-zinc-200 dark:border-white/10 bg-zinc-50 dark:bg-white/5 active:opacity-75"
            >
              {syncing ? (
                <Spinner size="sm" color="default" />
              ) : (
                <>
                  <RefreshCw size={13} color="#71717a" />
                  <Text className="text-xs font-medium text-zinc-600 dark:text-zinc-400">
                    Sync
                  </Text>
                </>
              )}
            </Pressable>
          </View>
        }
      />

      {/* Search Input */}
      <View className="px-4 py-2">
        <View className="flex-row items-center rounded-2xl border border-zinc-200 dark:border-white/10 bg-zinc-50 dark:bg-[#121215] px-3.5 py-2.5 gap-2">
          <Search size={16} color="#71717a" />
          <TextInput
            className="flex-1 text-sm text-zinc-900 dark:text-white"
            placeholder="Search notes with semantic hybrid search…"
            placeholderTextColor="#71717a"
            value={query}
            onChangeText={setQuery}
            autoCapitalize="none"
            autoCorrect={false}
          />
          {query ? (
            <Pressable onPress={() => setQuery('')} className="p-1">
              <X size={14} color="#71717a" />
            </Pressable>
          ) : null}
        </View>
      </View>

      {notice ? (
        <View className="mx-4 mt-1 rounded-2xl border border-sky-500/20 bg-sky-500/10 px-3.5 py-2.5">
          <Text className="text-xs text-sky-500 dark:text-sky-400">{notice}</Text>
        </View>
      ) : null}

      {loading ? (
        <View className="flex-1 items-center justify-center">
          <Spinner size="lg" color="default" />
        </View>
      ) : (
        <ScrollView
          contentContainerStyle={{ padding: 16, paddingBottom: insets.bottom + 32, gap: 16 }}
          refreshControl={
            <RefreshControl
              refreshing={refreshing}
              onRefresh={() => {
                setRefreshing(true);
                void load();
              }}
              tintColor="#8b5cf6"
            />
          }
        >
          {effectiveMatches ? (
            <View className="gap-2.5">
              <Text className="text-xs font-semibold uppercase tracking-wider text-zinc-400 dark:text-zinc-500 px-1">
                {`${effectiveMatches.length} Search Result${effectiveMatches.length === 1 ? '' : 's'}`}
              </Text>
              {effectiveMatches.map((match) => (
                <Pressable
                  key={match.chunk_id}
                  onPress={() =>
                    router.push({ pathname: '/note', params: { path: match.path } })
                  }
                  className="rounded-2xl border border-zinc-200 dark:border-white/10 bg-zinc-50 dark:bg-[#121215] p-4 active:bg-zinc-100 dark:active:bg-[#18181e] gap-1.5 shadow-sm"
                >
                  <View className="flex-row items-center gap-2">
                    <FileText size={15} color="#3b82f6" />
                    <Text className="text-sm font-semibold text-zinc-900 dark:text-white">
                      {match.path}
                    </Text>
                  </View>
                  {match.heading ? (
                    <Text className="text-xs font-medium text-purple-500">
                      § {match.heading}
                    </Text>
                  ) : null}
                  <Text numberOfLines={3} className="text-xs text-zinc-500 dark:text-zinc-400 leading-4">
                    {match.content}
                  </Text>
                </Pressable>
              ))}
              {effectiveMatches.length === 0 ? (
                <Text className="mt-8 text-center text-sm text-zinc-500">
                  No matching notes found.
                </Text>
              ) : null}
            </View>
          ) : notes.length === 0 ? (
            <View className="mt-20 items-center justify-center px-6 gap-3">
              <View className="h-16 w-16 items-center justify-center rounded-3xl border border-zinc-200 dark:border-white/10 bg-zinc-50 dark:bg-white/5">
                <FileText size={28} color="#71717a" />
              </View>
              <Text className="text-base font-semibold text-zinc-900 dark:text-white">
                No notes indexed yet
              </Text>
              <Text className="text-xs text-zinc-500 text-center max-w-xs">
                Configure your vault in environment or tap Sync to index your markdown notes into the vector store.
              </Text>
            </View>
          ) : (
            grouped.map(([folder, folderNotes]) => (
              <View key={folder} className="gap-2">
                <View className="flex-row items-center gap-1.5 px-1">
                  <Folder size={14} color="#71717a" />
                  <Text className="text-xs font-semibold uppercase tracking-wider text-zinc-400 dark:text-zinc-500">
                    {folder}
                  </Text>
                </View>
                <View className="rounded-2xl border border-zinc-200 dark:border-white/10 bg-zinc-50 dark:bg-[#121215] overflow-hidden">
                  {folderNotes.map((note, index) => (
                    <Pressable
                      key={note.id}
                      onPress={() =>
                        router.push({ pathname: '/note', params: { path: note.path } })
                      }
                      className={`flex-row items-center justify-between px-4 py-3 active:bg-zinc-100 dark:active:bg-[#18181e] ${
                        index > 0 ? 'border-t border-zinc-100 dark:border-white/5' : ''
                      }`}
                    >
                      <View className="flex-row items-center gap-3 flex-1 min-w-0 pr-2">
                        <FileText size={16} color="#71717a" />
                        <View className="flex-1 min-w-0">
                          <Text numberOfLines={1} className="text-sm font-semibold text-zinc-900 dark:text-white">
                            {note.title ?? note.path}
                          </Text>
                          <Text numberOfLines={1} className="text-xs text-zinc-400 mt-0.5">
                            {note.path}
                          </Text>
                        </View>
                      </View>
                    </Pressable>
                  ))}
                </View>
              </View>
            ))
          )}
        </ScrollView>
      )}

      {/* New note */}
      <Modal visible={newOpen} transparent animationType="fade" onRequestClose={() => setNewOpen(false)}>
        <View className="flex-1 items-center justify-center bg-black/40 px-6">
          <View className="w-full max-w-md rounded-3xl border border-zinc-200 dark:border-white/10 bg-white dark:bg-[#121215] p-5 gap-3">
            <View className="flex-row items-center justify-between">
              <Text className="text-base font-bold text-zinc-900 dark:text-white">New note</Text>
              <Pressable onPress={() => setNewOpen(false)} accessibilityRole="button">
                <X size={18} color="#71717a" />
              </Pressable>
            </View>
            <TextInput
              autoFocus
              className="rounded-2xl border border-zinc-200 dark:border-white/10 bg-zinc-50 dark:bg-white/5 px-3.5 py-3 text-sm text-zinc-900 dark:text-white"
              placeholder="Note title"
              placeholderTextColor="#71717a"
              value={newTitle}
              onChangeText={setNewTitle}
              onSubmitEditing={() => void handleCreate()}
              returnKeyType="done"
            />
            <Pressable
              onPress={() => void handleCreate()}
              disabled={creating || !newTitle.trim()}
              className="rounded-2xl bg-zinc-900 dark:bg-white py-3 items-center active:opacity-80 disabled:opacity-40"
            >
              {creating ? (
                <Spinner size="sm" color="default" />
              ) : (
                <Text className="text-sm font-bold text-white dark:text-zinc-900">Create note</Text>
              )}
            </Pressable>
          </View>
        </View>
      </Modal>
    </View>
  );
}
