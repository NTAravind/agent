import { useCallback, useMemo, useState } from 'react';
import { Spinner, Typography } from 'heroui-native';
import { Pressable, RefreshControl, ScrollView, TextInput, View } from 'react-native';
import { useFocusEffect, useRouter } from 'expo-router';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { ArrowLeft, ChevronRight, LayoutDashboard, Search, Sparkles } from 'lucide-react-native';
import type { CanvasSummary } from '@agent/shared';

import { AppHeader } from '@/components/app-header';
import { fetchCanvases } from '@/lib/canvases';

export default function CanvasListScreen() {
  const router = useRouter();
  const insets = useSafeAreaInsets();
  const [canvases, setCanvases] = useState<CanvasSummary[] | null>(null);
  const [searchQuery, setSearchQuery] = useState('');
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

  const filteredCanvases = useMemo(() => {
    if (!canvases) return [];
    const query = searchQuery.trim().toLowerCase();
    if (!query) return canvases;
    return canvases.filter((c) => c.title.toLowerCase().includes(query));
  }, [canvases, searchQuery]);

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
          <Typography type="h4" className="font-semibold text-white tracking-tight">
            Canvases
          </Typography>
        }
      />

      <ScrollView
        contentContainerStyle={{ padding: 16, paddingBottom: insets.bottom + 24, gap: 12 }}
        refreshControl={
          <RefreshControl
            refreshing={refreshing}
            onRefresh={() => {
              setRefreshing(true);
              void load();
            }}
            tintColor="#fff"
          />
        }
      >
        {/* Search Bar */}
        {canvases && canvases.length > 0 ? (
          <View className="mb-2 flex-row items-center rounded-full border border-white/10 bg-[#16171B] px-4 py-2.5">
            <Search size={16} color="rgba(255,255,255,0.4)" />
            <TextInput
              value={searchQuery}
              onChangeText={setSearchQuery}
              placeholder="Search canvases…"
              placeholderTextColor="rgba(255,255,255,0.3)"
              className="ml-2.5 flex-1 text-sm text-white"
              clearButtonMode="while-editing"
            />
          </View>
        ) : null}

        {canvases === null && !error ? (
          <View className="mt-20 items-center justify-center">
            <Spinner size="lg" color="default" />
          </View>
        ) : null}

        {canvases?.length === 0 ? (
          <View className="mt-14 items-center justify-center px-6">
            <View className="h-16 w-16 items-center justify-center rounded-2xl border border-white/10 bg-white/5 mb-4">
              <LayoutDashboard size={28} color="rgba(255,255,255,0.4)" />
            </View>
            <Typography type="h4" className="text-center font-semibold text-white mb-2">
              No canvases yet
            </Typography>
            <Typography type="body-sm" className="text-center text-white/50 leading-relaxed max-w-[280px]">
              Ask the agent in chat to build a dashboard or visualization — e.g. &quot;Make a dashboard of my tasks&quot;.
            </Typography>
            <Pressable
              onPress={() => router.push('/chat?prompt=Create%20a%20dashboard%20canvas%20for%20my%20weekly%20priorities')}
              className="mt-6 flex-row items-center gap-2 rounded-full bg-white px-5 py-2.5 active:opacity-80"
            >
              <Sparkles size={16} color="#000" />
              <Typography type="body-sm" className="font-semibold text-black">
                Generate Canvas
              </Typography>
            </Pressable>
          </View>
        ) : null}

        {filteredCanvases.map((canvas) => (
          <Pressable
            key={canvas.id}
            onPress={() => router.push(`/canvas/${canvas.id}`)}
            accessibilityLabel={canvas.title}
            className="flex-row items-center gap-3.5 rounded-2xl border border-white/5 bg-[#131418] p-4 active:scale-[0.99] transition-transform"
          >
            <View className="h-11 w-11 items-center justify-center rounded-xl border border-indigo-500/20 bg-indigo-500/10">
              <LayoutDashboard size={20} color="#818CF8" />
            </View>
            <View className="flex-1">
              <Typography type="h5" className="font-semibold text-white" numberOfLines={1}>
                {canvas.title}
              </Typography>
              <View className="mt-1 flex-row items-center gap-2">
                <View className="rounded-md bg-white/10 px-1.5 py-0.5">
                  <Typography type="body-xs" className="font-mono text-white/60">
                    v{canvas.version}
                  </Typography>
                </View>
                <Typography type="body-xs" className="text-white/40">
                  {new Date(canvas.updated_at).toLocaleDateString(undefined, {
                    month: 'short',
                    day: 'numeric',
                    hour: '2-digit',
                    minute: '2-digit',
                  })}
                </Typography>
              </View>
            </View>
            <ChevronRight size={18} color="rgba(255,255,255,0.3)" />
          </Pressable>
        ))}

        {canvases && canvases.length > 0 && filteredCanvases.length === 0 ? (
          <View className="mt-12 items-center">
            <Typography type="body-sm" className="text-white/40">
              No canvases matching &quot;{searchQuery}&quot;
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
