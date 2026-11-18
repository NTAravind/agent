import { useCallback, useState } from 'react';
import { Button, Card, Spinner, Typography } from 'heroui-native';
import { Pressable, RefreshControl, ScrollView, View } from 'react-native';
import { useFocusEffect, useRouter } from 'expo-router';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import type { CanvasSummary } from '@agent/shared';

import { AppHeader } from '@/components/app-header';
import { fetchCanvases } from '@/lib/canvases';

export default function CanvasListScreen() {
  const router = useRouter();
  const insets = useSafeAreaInsets();
  const [canvases, setCanvases] = useState<CanvasSummary[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [refreshing, setRefreshing] = useState(false);

  const load = useCallback(async () => {
    try {
      setCanvases(await fetchCanvases());
      setError(null);
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
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
            <Button.Label>Back</Button.Label>
          </Button>
        }
        center={<Typography type="h4">Canvas</Typography>}
      />

      <ScrollView
        contentContainerStyle={{ padding: 16, paddingBottom: insets.bottom + 24, gap: 12 }}
        refreshControl={
          <RefreshControl refreshing={refreshing} onRefresh={() => { setRefreshing(true); void load(); }} />
        }
      >
        {canvases === null && !error ? <Spinner /> : null}

        {canvases?.length === 0 ? (
          <Card className="rounded-2xl">
            <Card.Body className="gap-2">
              <Card.Title>No canvases yet</Card.Title>
              <Card.Description>
                Ask the agent for a dashboard — e.g. &quot;Make a dashboard of my weekly reading&quot; — and it will
                appear here, refreshable.
              </Card.Description>
            </Card.Body>
          </Card>
        ) : null}

        {canvases?.map((canvas) => (
          <Pressable
            key={canvas.id}
            onPress={() => router.push(`/canvas/${canvas.id}`)}
            accessibilityLabel={canvas.title}
          >
            <Card className="rounded-2xl border border-border">
              <Card.Body className="gap-1">
                <Typography type="h5" numberOfLines={1}>
                  {canvas.title}
                </Typography>
                <Typography type="body-xs" color="muted">
                  {`v${canvas.version} · updated ${new Date(canvas.updated_at).toLocaleString()}`}
                </Typography>
              </Card.Body>
            </Card>
          </Pressable>
        ))}

        {error ? (
          <Typography type="body-sm" className="text-danger">
            {error}
          </Typography>
        ) : null}
      </ScrollView>
    </View>
  );
}
