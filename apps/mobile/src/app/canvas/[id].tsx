import { useCallback, useState } from 'react';
import { Spinner, Typography } from 'heroui-native';
import { Pressable, RefreshControl, ScrollView, View } from 'react-native';
import { useFocusEffect, useLocalSearchParams, useRouter } from 'expo-router';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { ArrowLeft, RotateCw, Trash2 } from 'lucide-react-native';
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
    <View className="flex-1 bg-[#0B0C0E]">
      <AppHeader
        left={
          <Pressable
            onPress={() => router.back()}
            className="h-10 w-10 items-center justify-center rounded-full bg-white/10 active:opacity-70"
            accessibilityLabel="Go back"
          >
            <ArrowLeft size={20} color="#fff" />
          </Pressable>
        }
        center={
          <Typography type="h4" numberOfLines={1} className="font-semibold text-white tracking-tight">
            {canvas?.title ?? 'Canvas'}
          </Typography>
        }
        right={
          confirmingDelete ? (
            <View className="flex-row items-center gap-2">
              <Pressable
                onPress={() => setConfirmingDelete(false)}
                className="rounded-full bg-white/10 px-3 py-1.5 active:opacity-70"
              >
                <Typography type="body-xs" className="text-white/70">
                  Cancel
                </Typography>
              </Pressable>
              <Pressable
                onPress={() => void handleDelete()}
                className="rounded-full border border-red-500/30 bg-red-500/20 px-3.5 py-1.5 active:opacity-70"
              >
                <Typography type="body-xs" className="font-semibold text-red-400">
                  Delete
                </Typography>
              </Pressable>
            </View>
          ) : (
            <View className="flex-row items-center gap-1.5">
              <Pressable
                onPress={() => void handleRefresh()}
                className="h-10 w-10 items-center justify-center rounded-full bg-white/10 active:opacity-70"
                accessibilityLabel="Refresh canvas"
              >
                <RotateCw size={18} color="#fff" />
              </Pressable>
              <Pressable
                onPress={() => setConfirmingDelete(true)}
                className="h-10 w-10 items-center justify-center rounded-full bg-white/10 active:opacity-70"
                accessibilityLabel="Delete canvas"
              >
                <Trash2 size={18} color="rgba(255,255,255,0.7)" />
              </Pressable>
            </View>
          )
        }
      />

      <ScrollView
        contentContainerStyle={{ padding: 16, paddingBottom: insets.bottom + 24, gap: 16 }}
        refreshControl={
          <RefreshControl
            refreshing={refreshing}
            onRefresh={() => void handleRefresh()}
            tintColor="#fff"
          />
        }
      >
        {!canvas && !error ? (
          <View className="mt-20 items-center justify-center">
            <Spinner size="lg" color="default" />
          </View>
        ) : null}

        {canvas && valid && valid.ok ? (
          <>
            <CanvasView spec={valid.spec} onAction={handleAction} />
            <View className="mt-2 flex-row items-center justify-between rounded-xl border border-white/5 bg-[#131418] px-4 py-3">
              <View className="flex-row items-center gap-2">
                <View className="rounded-md bg-white/10 px-1.5 py-0.5">
                  <Typography type="body-xs" className="font-mono text-white/70">
                    v{canvas.version}
                  </Typography>
                </View>
                <Typography type="body-xs" className="text-white/40">
                  Updated {new Date(canvas.updated_at).toLocaleString()}
                </Typography>
              </View>
            </View>
          </>
        ) : null}

        {canvas && valid && !valid.ok ? (
          <View className="rounded-2xl border border-amber-500/20 bg-amber-500/10 p-4">
            <Typography type="body-sm" className="text-amber-300">
              {`This canvas spec can't be displayed: ${valid.error}`}
            </Typography>
          </View>
        ) : null}

        {error ? (
          <View className="rounded-2xl border border-red-500/20 bg-red-500/10 p-4">
            <Typography type="body-sm" className="text-red-400">
              {error}
            </Typography>
          </View>
        ) : null}
      </ScrollView>
    </View>
  );
}
