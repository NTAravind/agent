import { useCallback, useState } from 'react';
import { Alert, Button, Card, Chip, Spinner, Typography } from 'heroui-native';
import { Pressable, ScrollView, View } from 'react-native';
import { useFocusEffect, useLocalSearchParams, useRouter } from 'expo-router';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import { AppHeader } from '@/components/app-header';
import { fetchNote } from '@/lib/knowledge';

export default function NoteScreen() {
  const router = useRouter();
  const insets = useSafeAreaInsets();
  const { path } = useLocalSearchParams<{ path: string }>();

  const [note, setNote] = useState<Awaited<ReturnType<typeof fetchNote>>>(null);
  const [loading, setLoading] = useState(Boolean(path));
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(async () => {
    if (!path) return;
    try {
      const result = await fetchNote(path);
      setNote(result);
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

  return (
    <View className="flex-1 bg-background">
      <AppHeader
        left={
          <Button size="md" variant="ghost" onPress={() => router.back()}>
            <Button.Label>Back</Button.Label>
          </Button>
        }
        center={
          <Typography type="body-sm" weight="semibold" numberOfLines={1}>
            {note?.note.title ?? path ?? 'Note'}
          </Typography>
        }
      />

      {loading ? (
        <View className="flex-1 items-center justify-center">
          <Spinner />
        </View>
      ) : (
        <ScrollView contentContainerStyle={{ padding: 16, paddingBottom: insets.bottom + 24, gap: 16 }}>
          {error ? (
            <Alert status="danger">
              <Alert.Content>
                <Alert.Title>Could not load the note</Alert.Title>
                <Alert.Description>{error}</Alert.Description>
              </Alert.Content>
            </Alert>
          ) : null}

          {note ? (
            <>
              <View className="gap-1">
                <Typography type="h4">{note.note.title ?? note.note.path}</Typography>
                <Typography type="body-xs" color="muted">
                  {note.note.path}
                </Typography>
              </View>

              {note.links.length > 0 ? (
                <View className="gap-2">
                  <Typography type="body-sm" color="muted">
                    Links
                  </Typography>
                  <View className="flex-row flex-wrap gap-1.5">
                    {note.links.map((link) => (
                      <Chip key={link} variant="soft" size="sm" onPress={() => openPath(link)}>
                        <Chip.Label>{link}</Chip.Label>
                      </Chip>
                    ))}
                  </View>
                </View>
              ) : null}

              <View className="gap-2">
                <Typography type="body-sm" color="muted">
                  Note
                </Typography>
                <Typography type="body" className="leading-6">
                  {note.content}
                </Typography>
              </View>

              {note.backlinks.length > 0 ? (
                <View className="gap-2">
                  <Typography type="body-sm" color="muted">
                    {`Linked from (${note.backlinks.length})`}
                  </Typography>
                  <View className="gap-1.5">
                    {note.backlinks.map((backlink) => (
                      <Pressable key={backlink.path} onPress={() => openPath(backlink.path)}>
                        <Card className="rounded-xl">
                          <Card.Body className="py-2">
                            <Typography type="body-sm">{backlink.title ?? backlink.path}</Typography>
                          </Card.Body>
                        </Card>
                      </Pressable>
                    ))}
                  </View>
                </View>
              ) : null}
            </>
          ) : null}
        </ScrollView>
      )}
    </View>
  );
}
