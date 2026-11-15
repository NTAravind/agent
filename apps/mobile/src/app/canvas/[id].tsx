import { useCallback, useState } from 'react';
import { Button, Card, Spinner, Typography } from 'heroui-native';
import { Alert, RefreshControl, ScrollView, View } from 'react-native';
import { useFocusEffect, useLocalSearchParams, useRouter } from 'expo-router';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import type { CanvasAction, CanvasRow } from '@agent/shared';
import { validateCanvasSpec } from '@agent/shared';

import { AppHeader } from '@/components/app-header';
import { CanvasView } from '@/components/canvas-renderer';
import { deleteCanvas, fetchCanvas, refreshCanvas } from '@/lib/canvases';

export default function CanvasDetailScreen() {
  const router = useRouter();
  const insets = useSafeAreaInsets();
  const { id } = useLocalSearchParams<{ id: string }>();

  const [canvas, setCanvas] = useState<CanvasRow | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [refreshing, setRefreshing] = useState(false);
  const [confirmingDelete, setConfirmingDelete] = useState(false);

  const load = useCallback(async () => {
    if (!id) return;
    try {
      setCanvas(await fetchCanvas(id));
      setError(null);
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    }
  }, [id]);

  useFocusEffect(
    useCallback(() => {
      void load();
    }, [load]),
  );

  const handleRefresh = useCallback(async () => {
    if (!id) return;
    setRefreshing(true);
    try {
      setCanvas(await refreshCanvas(id));
      setError(null);
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setRefreshing(false);
    }
  }, [id]);

  const handleAction = useCallback(
    (action: CanvasAction, payload: unknown) => {
      if (action === 'refresh') {
        void handleRefresh();
        return;
      }
      if (action === 'open_note') {
        const path = typeof payload === 'string' ? payload : String((payload as { path?: string })?.path ?? '');
        if (path) router.push(`/note?path=${encodeURIComponent(path)}`);
        return;
      }
      const prompt = typeof payload === 'string' ? payload : '';
      router.push(prompt ? `/chat?prompt=${encodeURIComponent(prompt)}` : '/chat');
    },
    [handleRefresh, router],
  );

  const handleDelete = useCallback(async () => {
    if (!id) return;
    try {
      await deleteCanvas(id);
      router.replace('/canvas');
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
      setConfirmingDelete(false);
    }
  }, [id, router]);

  const spec = canvas?.spec;
  const valid = spec ? validateCanvasSpec(spec) : null;

  return (
    <View className="flex-1 bg-background">
      <AppHeader
        left={
          <Button size="md" variant="ghost" onPress={() => router.back()}>
            <Button.Label>Back</Button.Label>
          </Button>
        }
        center={<Typography type="h4" numberOfLines={1}>{canvas?.title ?? 'Canvas'}</Typography>}
        right={
          confirmingDelete ? (
            <Button size="sm" variant="danger" onPress={() => void handleDelete()}>
              <Button.Label>Confirm</Button.Label>
            </Button>
          ) : (
            <Button size="sm" variant="ghost" onPress={() => setConfirmingDelete(true)}>
              <Button.Label>Delete</Button.Label>
            </Button>
          )
        }
      />

      <ScrollView
        contentContainerStyle={{ padding: 16, paddingBottom: insets.bottom + 24, gap: 16 }}
        refreshControl={
          <RefreshControl refreshing={refreshing} onRefresh={() => void handleRefresh()} />
        }
      >
        {!canvas && !error ? <Spinner /> : null}

        {canvas && valid && valid.ok ? (
          <>
            <CanvasView spec={valid.spec} onAction={handleAction} />
            <Typography type="body-xs" color="muted">
              {`v${canvas.version} · updated ${new Date(canvas.updated_at).toLocaleString()}`}
            </Typography>
          </>
        ) : null}

        {canvas && valid && !valid.ok ? (
          <Card className="rounded-xl border border-border bg-surface">
            <Card.Body>
              <Typography type="body-sm" color="muted">
                {`This canvas spec can't be displayed: ${valid.error}`}
              </Typography>
            </Card.Body>
          </Card>
        ) : null}

        {error ? (
          <Typography type="body-sm" className="text-danger">
            {error}
          </Typography>
        ) : null}
      </ScrollView>
    </View>
  );
}
