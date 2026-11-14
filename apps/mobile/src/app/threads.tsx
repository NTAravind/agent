import { useCallback, useState } from 'react';
import { Alert, Button, ListGroup, Spinner, Typography } from 'heroui-native';
import { ScrollView, View } from 'react-native';
import { useFocusEffect, useRouter } from 'expo-router';
import type { Thread } from '@agent/shared';

import { deleteThread, fetchThreads } from '@/lib/models';

export default function ThreadsScreen() {
  const router = useRouter();
  const [threads, setThreads] = useState<Thread[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(async () => {
    try {
      setThreads(await fetchThreads());
      setError(null);
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setLoading(false);
    }
  }, []);

  useFocusEffect(
    useCallback(() => {
      void load();
    }, [load]),
  );

  return (
    <View className="flex-1 bg-background">
      <View className="flex-row items-center justify-between border-b border-separator px-4 py-3">
        <Typography type="h3">Threads</Typography>
        <Button size="sm" variant="ghost" onPress={() => router.back()}>
          <Button.Label>Close</Button.Label>
        </Button>
      </View>

      {loading ? (
        <View className="flex-1 items-center justify-center">
          <Spinner />
        </View>
      ) : (
        <ScrollView contentContainerStyle={{ padding: 12, gap: 12 }}>
          {error ? (
            <Alert status="danger">
              <Alert.Content>
                <Alert.Title>Could not load threads</Alert.Title>
                <Alert.Description>{error}</Alert.Description>
              </Alert.Content>
            </Alert>
          ) : null}

          {threads.length === 0 && !error ? (
            <Typography type="body-sm" color="muted" className="mt-10 text-center">
              No conversations yet.
            </Typography>
          ) : null}

          {threads.length > 0 ? (
            <ListGroup>
              {threads.map((thread) => (
                <ListGroup.Item
                  key={thread.id}
                  onPress={() =>
                    router.push({ pathname: '/chat', params: { threadId: thread.id } })
                  }
                >
                  <ListGroup.ItemContent>
                    <ListGroup.ItemTitle>{thread.title ?? 'Untitled'}</ListGroup.ItemTitle>
                    <ListGroup.ItemDescription>
                      {`${new Date(thread.updated_at).toLocaleString()}${
                        thread.model ? ` · ${thread.model}` : ''
                      }`}
                    </ListGroup.ItemDescription>
                  </ListGroup.ItemContent>
                  <ListGroup.ItemSuffix>
                    <Button
                      size="sm"
                      variant="ghost"
                      onPress={() => void deleteThread(thread.id).then(load)}
                    >
                      <Button.Label>Delete</Button.Label>
                    </Button>
                  </ListGroup.ItemSuffix>
                </ListGroup.Item>
              ))}
            </ListGroup>
          ) : null}
        </ScrollView>
      )}
    </View>
  );
}
