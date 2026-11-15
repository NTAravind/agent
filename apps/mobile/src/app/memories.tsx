import { useCallback, useState } from 'react';
import { Alert, Button, ListGroup, Spinner, Typography } from 'heroui-native';
import { RefreshControl, ScrollView, View } from 'react-native';
import { useFocusEffect, useRouter } from 'expo-router';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import type { Memory } from '@agent/shared';

import { AppHeader } from '@/components/app-header';
import { deleteMemory, fetchMemories } from '@/lib/knowledge';

const KIND_LABEL: Record<Memory['kind'], string> = {
  fact: 'Fact',
  preference: 'Preference',
  decision: 'Decision',
  task: 'Task',
};

export default function MemoriesScreen() {
  const router = useRouter();
  const insets = useSafeAreaInsets();

  const [memories, setMemories] = useState<Memory[]>([]);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(async () => {
    try {
      setMemories(await fetchMemories());
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
        center={<Typography type="h4">Memories</Typography>}
      />

      {loading ? (
        <View className="flex-1 items-center justify-center">
          <Spinner />
        </View>
      ) : (
        <ScrollView
          contentContainerStyle={{ padding: 16, paddingBottom: insets.bottom + 24, gap: 12 }}
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
          {error ? (
            <Alert status="danger">
              <Alert.Content>
                <Alert.Title>Could not load memories</Alert.Title>
                <Alert.Description>{error}</Alert.Description>
              </Alert.Content>
            </Alert>
          ) : null}

          {memories.length === 0 && !error ? (
            <View className="mt-16 items-center gap-2">
              <Typography type="body" color="muted">
                Nothing remembered yet.
              </Typography>
              <Typography type="body-sm" color="muted" className="text-center">
                Memories are extracted automatically after a conversation.
              </Typography>
            </View>
          ) : null}

          {memories.length > 0 ? (
            <ListGroup className="rounded-2xl">
              {memories.map((memory) => (
                <ListGroup.Item key={memory.id}>
                  <ListGroup.ItemContent>
                    <ListGroup.ItemTitle>{memory.content}</ListGroup.ItemTitle>
                    <ListGroup.ItemDescription>
                      {`${KIND_LABEL[memory.kind]} · ${new Date(memory.created_at).toLocaleDateString()}`}
                    </ListGroup.ItemDescription>
                  </ListGroup.ItemContent>
                  <ListGroup.ItemSuffix>
                    <Button
                      size="sm"
                      variant="ghost"
                      onPress={() =>
                        void deleteMemory(memory.id).then(async () => {
                          setMemories((current) => current.filter((item) => item.id !== memory.id));
                        })
                      }
                      accessibilityLabel="Forget this memory"
                    >
                      <Button.Label>Forget</Button.Label>
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
