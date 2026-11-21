import { useCallback, useState } from 'react';
import {
  Alert,
  KeyboardAvoidingView,
  Platform,
  Pressable,
  ScrollView,
  Text,
  TextInput,
  View,
} from 'react-native';
import { Spinner, Typography } from 'heroui-native';
import { useFocusEffect, useLocalSearchParams, useRouter } from 'expo-router';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { Check, FileText, Link2, Pencil, Trash2 } from 'lucide-react-native';

import { AppHeader } from '@/components/app-header';
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
      // A rename leaves the old file behind — remove it.
      if (nextPath !== path) {
        try {
          await deleteNote(path);
        } catch (error) {
          console.warn('[notes] could not remove the old note:', error);
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
            .then(() => router.back())
            .catch((err) => setNotice(err instanceof Error ? err.message : String(err)));
        },
      },
    ]);
  }, [path, router]);

  return (
    <KeyboardAvoidingView
      behavior={Platform.OS === 'ios' ? 'padding' : undefined}
      className="flex-1 bg-white dark:bg-[#09090b]"
    >
      <AppHeader
        left={
          <Pressable
            onPress={() => router.back()}
            accessibilityRole="button"
            className="px-2 py-1 active:opacity-60"
          >
            <Typography type="body" className="text-zinc-500 dark:text-zinc-400">
              Back
            </Typography>
          </Pressable>
        }
        center={
          <Typography type="body-sm" weight="semibold" numberOfLines={1} className="text-zinc-900 dark:text-white">
            {editing ? 'Edit note' : (note?.note.title ?? path ?? 'Note')}
          </Typography>
        }
        right={
          editing ? (
            <View className="flex-row items-center gap-1">
              <Pressable
                onPress={() => void handleSave()}
                disabled={saving}
                accessibilityRole="button"
                accessibilityLabel="Save note"
                className="h-8.5 px-3 flex-row items-center gap-1.5 rounded-full border border-emerald-500/30 bg-emerald-500/10 active:opacity-75"
              >
                {saving ? (
                  <Spinner size="sm" color="default" />
                ) : (
                  <>
                    <Check size={13} color="#10b981" />
                    <Text className="text-xs font-semibold text-emerald-600 dark:text-emerald-400">
                      Save
                    </Text>
                  </>
                )}
              </Pressable>
            </View>
          ) : (
            <View className="flex-row items-center gap-1">
              <Pressable
                onPress={() => setEditing(true)}
                accessibilityRole="button"
                accessibilityLabel="Edit note"
                className="h-8.5 w-8.5 items-center justify-center rounded-full border border-zinc-200 dark:border-white/10 bg-zinc-50 dark:bg-white/5 active:opacity-75"
              >
                <Pencil size={13} color="#71717a" />
              </Pressable>
              <Pressable
                onPress={handleDelete}
                accessibilityRole="button"
                accessibilityLabel="Delete note"
                className="h-8.5 w-8.5 items-center justify-center rounded-full border border-red-500/25 bg-red-500/10 active:opacity-75"
              >
                <Trash2 size={13} color="#ef4444" />
              </Pressable>
            </View>
          )
        }
      />

      {notice ? (
        <View className="mx-4 mt-2 rounded-2xl border border-red-500/20 bg-red-500/10 px-3.5 py-2.5">
          <Text className="text-xs text-red-500 dark:text-red-400">{notice}</Text>
        </View>
      ) : null}

      {loading ? (
        <View className="flex-1 items-center justify-center">
          <Spinner size="lg" color="default" />
        </View>
      ) : editing ? (
        <ScrollView
          contentContainerStyle={{ padding: 16, paddingBottom: insets.bottom + 32, gap: 12 }}
          keyboardShouldPersistTaps="handled"
        >
          <View className="gap-1.5">
            <Text className="text-xs font-semibold uppercase tracking-wider text-zinc-400">
              Path (rename or move)
            </Text>
            <TextInput
              className="rounded-2xl border border-zinc-200 dark:border-white/10 bg-zinc-50 dark:bg-white/5 px-3.5 py-2.5 text-sm text-zinc-900 dark:text-white"
              value={draftPath}
              onChangeText={setDraftPath}
              autoCapitalize="none"
              autoCorrect={false}
              placeholder="folder/note.md"
              placeholderTextColor="#71717a"
            />
          </View>

          <View className="gap-1.5">
            <Text className="text-xs font-semibold uppercase tracking-wider text-zinc-400">
              Markdown
            </Text>
            <TextInput
              className="min-h-[320px] rounded-2xl border border-zinc-200 dark:border-white/10 bg-zinc-50 dark:bg-white/5 px-3.5 py-3 text-sm text-zinc-900 dark:text-white leading-5"
              value={content}
              onChangeText={setContent}
              multiline
              textAlignVertical="top"
              placeholder="# Title\n\nWrite in markdown…"
              placeholderTextColor="#71717a"
            />
          </View>

          <Text className="text-[11px] text-zinc-400">
            Saving commits the note to your vault immediately — no approval needed for edits you
            make yourself.
          </Text>
        </ScrollView>
      ) : (
        <ScrollView
          contentContainerStyle={{ padding: 20, paddingBottom: insets.bottom + 32, gap: 20 }}
        >
          {error ? (
            <View className="rounded-2xl border border-red-500/20 bg-red-500/10 p-4">
              <Text className="text-sm text-red-500 text-center">{error}</Text>
            </View>
          ) : null}

          {note ? (
            <>
              {/* Note Header Title */}
              <View className="gap-1 border-b border-zinc-200 dark:border-white/10 pb-4">
                <Text className="text-2xl font-bold text-zinc-900 dark:text-white leading-8">
                  {note.note.title ?? note.note.path}
                </Text>
                <View className="flex-row items-center gap-1.5 mt-1">
                  <FileText size={13} color="#71717a" />
                  <Text className="text-xs text-zinc-400">
                    {note.note.path}
                  </Text>
                </View>
              </View>

              {/* Tappable Wikilinks */}
              {note.links.length > 0 ? (
                <View className="gap-2">
                  <View className="flex-row items-center gap-1.5">
                    <Link2 size={13} color="#71717a" />
                    <Text className="text-xs font-semibold uppercase tracking-wider text-zinc-400">
                      Linked Notes
                    </Text>
                  </View>
                  <View className="flex-row flex-wrap gap-1.5">
                    {note.links.map((link) => (
                      <Pressable
                        key={link}
                        onPress={() => openPath(link)}
                        className="rounded-full border border-zinc-200 dark:border-white/10 bg-zinc-50 dark:bg-white/5 px-3 py-1 active:bg-zinc-100"
                      >
                        <Text className="text-xs font-medium text-purple-600 dark:text-purple-400">
                          [[{link}]]
                        </Text>
                      </Pressable>
                    ))}
                  </View>
                </View>
              ) : null}

              {/* Note Body */}
              <View className="rounded-3xl border border-zinc-200 dark:border-white/10 bg-zinc-50 dark:bg-[#121215] p-5">
                <Text className="text-base text-zinc-800 dark:text-zinc-200 leading-7">
                  {note.content}
                </Text>
              </View>
            </>
          ) : null}
        </ScrollView>
      )}
    </KeyboardAvoidingView>
  );
}
