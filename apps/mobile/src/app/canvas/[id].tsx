import { useCallback, useState } from 'react';
import { Platform, Pressable, RefreshControl, ScrollView, Text, View } from 'react-native';
import { Spinner } from 'heroui-native';
import { useFocusEffect, useLocalSearchParams, useRouter } from 'expo-router';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { ChevronLeft, RotateCw, Trash2 } from 'lucide-react-native';
import type { CanvasAction, CanvasRow } from '@agent/shared';
import { validateCanvasSpec } from '@agent/shared';

import { AppHeader } from '@/components/app-header';
import { CanvasView } from '@/components/canvas-renderer';
import { GroupedCard, PillButton, RoundButton } from '@/components/design-system';
import { colors, radius, space } from '@/theme';
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

  const handleBack = useCallback(() => {
    if (router.canGoBack()) {
      router.back();
    } else {
      router.replace('/canvas' as never);
    }
  }, [router]);

  const spec = canvas?.spec;
  const valid = spec ? validateCanvasSpec(spec) : null;

  return (
    <View style={{ flex: 1, backgroundColor: colors.background }}>
      <AppHeader
        left={
          <RoundButton
            icon={ChevronLeft}
            onPress={handleBack}
            accessibilityLabel="Go back"
          />
        }
        center={
          <Text
            numberOfLines={1}
            style={{
              fontSize: 20,
              lineHeight: 26,
              fontWeight: '600',
              color: colors.textPrimary,
            }}
          >
            {canvas?.title ?? 'Canvas'}
          </Text>
        }
        right={
          confirmingDelete ? (
            <View style={{ flexDirection: 'row', alignItems: 'center', gap: space.sm }}>
              <PillButton
                label="Cancel"
                onPress={() => setConfirmingDelete(false)}
                variant="secondary"
              />
              <PillButton
                label="Delete"
                onPress={() => void handleDelete()}
                variant="primary"
              />
            </View>
          ) : (
            <View style={{ flexDirection: 'row', alignItems: 'center', gap: space.xs }}>
              <RoundButton
                icon={RotateCw}
                onPress={() => void handleRefresh()}
                accessibilityLabel="Refresh canvas"
              />
              <RoundButton
                icon={Trash2}
                onPress={() => setConfirmingDelete(true)}
                accessibilityLabel="Delete canvas"
              />
            </View>
          )
        }
      />

      <ScrollView
        contentContainerStyle={{ padding: space.lg, paddingBottom: insets.bottom + 24, gap: space.lg }}
        refreshControl={
          <RefreshControl
            refreshing={refreshing}
            onRefresh={() => void handleRefresh()}
            tintColor={colors.textPrimary}
          />
        }
      >
        {!canvas && !error ? (
          <View style={{ marginTop: 80, alignItems: 'center', justifyContent: 'center' }}>
            <Spinner size="lg" color="default" />
          </View>
        ) : null}

        {canvas && valid && valid.ok ? (
          <>
            <CanvasView spec={valid.spec} onAction={handleAction} />
            <GroupedCard
              style={{
                marginTop: space.xs,
                flexDirection: 'row',
                alignItems: 'center',
                justifyContent: 'space-between',
                paddingHorizontal: space.lg,
                paddingVertical: space.md,
              }}
            >
              <View style={{ flexDirection: 'row', alignItems: 'center', gap: space.sm }}>
                <View
                  style={{
                    borderRadius: radius.tile,
                    backgroundColor: colors.surfaceRaised,
                    paddingHorizontal: 8,
                    paddingVertical: 2,
                  }}
                >
                  <Text
                    style={{
                      fontFamily: Platform.OS === 'ios' ? 'Menlo' : 'monospace',
                      fontSize: 12,
                      color: colors.textSecondary,
                    }}
                  >
                    v{canvas.version}
                  </Text>
                </View>
                <Text style={{ fontSize: 13, color: colors.textSecondary }}>
                  Updated {new Date(canvas.updated_at).toLocaleString()}
                </Text>
              </View>
            </GroupedCard>
          </>
        ) : null}

        {canvas && valid && !valid.ok ? (
          <View
            style={{
              backgroundColor: colors.surface,
              borderRadius: radius.card,
              padding: space.lg,
            }}
          >
            <Text style={{ color: colors.textSecondary, fontSize: 15, lineHeight: 20 }}>
              {`This canvas spec can't be displayed: ${valid.error}`}
            </Text>
          </View>
        ) : null}

        {error ? (
          <View
            style={{
              backgroundColor: colors.recordingBg,
              borderRadius: radius.card,
              padding: space.lg,
            }}
          >
            <Text style={{ color: colors.recording, fontSize: 15, lineHeight: 20 }}>
              {error}
            </Text>
          </View>
        ) : null}
      </ScrollView>
    </View>
  );
}
