import { useCallback, useEffect, useMemo, useState } from 'react';
import { Alert, Button, Card, ListGroup, Spinner, Typography } from 'heroui-native';
import { Pressable, RefreshControl, ScrollView, TextInput, View } from 'react-native';
import { useFocusEffect, useRouter } from 'expo-router';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import type { Note, NoteChunk } from '@agent/shared';

import { AppHeader } from '@/components/app-header';
import { fetchNotes, searchNotes, syncVault } from '@/lib/knowledge';

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

  // Debounced hybrid search. Stale results are hidden by deriving on the query.
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
        ? 'Vault sync queued. The index refreshes in the background.'
        : (result.message ?? 'Could not sync the vault.'),
    );
    if (result.ok) void load();
  }, [load]);

  // Hide stale search results while the query is empty.
  const effectiveMatches = query.trim() ? matches : null;

  const grouped = useMemo(() => {
    const folders = new Map<string, Note[]>();
    for (const note of notes) {
      const folder = note.path.includes('/') ? note.path.split('/')[0]! : '·';
      const list = folders.get(folder) ?? [];
      list.push(note);
      folders.set(folder, list);
    }
    return [...folders.entries()].sort(([a], [b]) => a.localeCompare(b));
  }, [notes]);

  return (
    <View className="flex-1 bg-background">
      <AppHeader
        left={
          <Button size="md" variant="ghost" onPress={() => router.back()}>
            <Button.Label>Close</Button.Label>
          </Button>
        }
        center={<Typography type="h4">Notes</Typography>}
        right={
          <Button size="md" variant="ghost" onPress={() => void handleSync()} isDisabled={syncing}>
            {syncing ? <Spinner size="sm" /> : <Button.Label>Sync</Button.Label>}
          </Button>
        }
      />

      <View className="px-4 pt-3">
        <TextInput
          className="rounded-xl bg-field px-3 py-2 text-[15px]"
          placeholder="Search notes…"
          placeholderTextColor="#888"
          value={query}
          onChangeText={setQuery}
          autoCapitalize="none"
          autoCorrect={false}
          clearButtonMode="while-editing"
        />
      </View>

      {notice ? (
        <View className="px-4 pt-3">
          <Alert status="accent">
            <Alert.Content>
              <Alert.Description>{notice}</Alert.Description>
            </Alert.Content>
          </Alert>
        </View>
      ) : null}

      {loading ? (
        <View className="flex-1 items-center justify-center">
          <Spinner />
        </View>
      ) : (
        <ScrollView
          contentContainerStyle={{ padding: 16, paddingBottom: insets.bottom + 24, gap: 16 }}
          refreshControl={
            <RefreshControl
              refreshing={refreshing}
              onRefresh={() => {
                setRefreshing(true);
                void load();
              }}
              tintColor="#208AEF"
            />
          }
        >
          {effectiveMatches ? (
            <View className="gap-2">
              <Typography type="body-sm" color="muted">
                {`${effectiveMatches.length} matching chunk${effectiveMatches.length === 1 ? '' : 's'}`}
              </Typography>
              {effectiveMatches.map((match) => (
                <Pressable
                  key={match.chunk_id}
                  onPress={() =>
                    router.push({ pathname: '/note', params: { path: match.path } })
                  }
                >
                  <Card className="rounded-2xl">
                    <Card.Body className="gap-1">
                      <Typography type="body-sm" weight="semibold">
                        {match.path}
                      </Typography>
                      {match.heading ? (
                        <Typography type="body-xs" color="muted">
                          {match.heading}
                        </Typography>
                      ) : null}
                      <Typography type="body-xs" color="muted" numberOfLines={4}>
                        {match.content}
                      </Typography>
                    </Card.Body>
                  </Card>
                </Pressable>
              ))}
              {effectiveMatches.length === 0 ? (
                <Typography type="body-sm" color="muted" className="mt-6 text-center">
                  Nothing matched.
                </Typography>
              ) : null}
            </View>
          ) : notes.length === 0 ? (
            <View className="mt-16 items-center gap-2">
              <Typography type="body" color="muted">
                No notes indexed yet.
              </Typography>
              <Typography type="body-sm" color="muted" className="text-center">
                Point GITHUB_VAULT_TOKEN and GITHUB_VAULT_REPO at your vault, then tap Sync.
              </Typography>
            </View>
          ) : (
            grouped.map(([folder, folderNotes]) => (
              <View key={folder} className="gap-2">
                <Typography type="body-sm" color="muted">
                  {folder}
                </Typography>
                <ListGroup className="rounded-2xl">
                  {folderNotes.map((note) => (
                    <ListGroup.Item
                      key={note.id}
                      onPress={() =>
                        router.push({ pathname: '/note', params: { path: note.path } })
                      }
                      accessibilityLabel={note.title ?? note.path}
                    >
                      <ListGroup.ItemContent>
                        <ListGroup.ItemTitle>{note.title ?? note.path}</ListGroup.ItemTitle>
                        <ListGroup.ItemDescription>{note.path}</ListGroup.ItemDescription>
                      </ListGroup.ItemContent>
                    </ListGroup.Item>
                  ))}
                </ListGroup>
              </View>
            ))
          )}
        </ScrollView>
      )}
    </View>
  );
}
