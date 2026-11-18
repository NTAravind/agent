import { useCallback, useState } from 'react';
import { Alert, Button, ListGroup, Spinner, Typography } from 'heroui-native';
import { RefreshControl, ScrollView, View } from 'react-native';
import { useFocusEffect, useRouter } from 'expo-router';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import type { Thread } from '@agent/shared';

import { AppHeader } from '@/components/app-header';
import { AgentAvatar } from '@/components/agent-avatar';
import { deleteThread, fetchThreads } from '@/lib/models';

export default function ThreadsScreen() {
  const router = useRouter();
  const insets = useSafeAreaInsets();
  const [threads, setThreads] = useState<Thread[]>([]);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(async (mode: 'initial' | 'refresh' = 'initial') => {
    if (mode === 'refresh') setRefreshing(true);
    try {
      setThreads(await fetchThreads());
      setError(null);
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
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

  return (
    <View className="flex-1 bg-background">
      <AppHeader
        left={
          <Button size="md" variant="ghost" onPress={() => router.back()}>
            <Button.Label>Close</Button.Label>
          </Button>
        }
        center={
          <Typography type="h4">Threads</Typography>
        }
      />

      {loading ? (
        <View className="flex-1 items-center justify-center">
          <Spinner />
        </View>
      ) : (
        <ScrollView
          contentContainerStyle={{
            padding: 16,
            paddingBottom: insets.bottom + 24,
            gap: 12,
          }}
          refreshControl={
            <RefreshControl
              refreshing={refreshing}
              onRefresh={() => void load('refresh')}
              tintColor="#208AEF"
            />
          }
        >
          {error ? (
            <Alert status="danger">
              <Alert.Content>
                <Alert.Title>Could not load threads</Alert.Title>
                <Alert.Description>{error}</Alert.Description>
                <View className="mt-2">
                  <Button size="sm" variant="secondary" onPress={() => void load()}>
                    <Button.Label>Retry</Button.Label>
                  </Button>
                </View>
              </Alert.Content>
            </Alert>
          ) : null}

          {threads.length === 0 && !error ? (
            <View className="mt-16 items-center gap-2">
              <Typography type="body" color="muted">
                No conversations yet.
              </Typography>
              <Button size="md" variant="secondary" onPress={() => router.push('/chat')}>
                <Button.Label>Start a chat</Button.Label>
              </Button>
            </View>
          ) : null}

          {threads.length > 0 ? (
            <ListGroup className="rounded-2xl">
              {threads.map((thread) => (
                <ListGroup.Item
                  key={thread.id}
                  onPress={() =>
                    router.push({ pathname: '/chat', params: { threadId: thread.id } })
                  }
                  accessibilityLabel={thread.title ?? 'Untitled thread'}
                >
                  {thread.agent ? (
                    <ListGroup.ItemPrefix>
                      <AgentAvatar avatar={thread.agent.avatar} size={32} />
                    </ListGroup.ItemPrefix>
                  ) : null}
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
                      onPress={() => void deleteThread(thread.id).then(() => load())}
                      accessibilityLabel={`Delete ${thread.title ?? 'thread'}`}
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
