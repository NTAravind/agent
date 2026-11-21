import { useCallback, useEffect, useRef, useState } from 'react';
import { Spinner, Typography } from 'heroui-native';
import { Alert as RNAlert, Pressable, RefreshControl, ScrollView, TextInput, View } from 'react-native';
import { useFocusEffect, useRouter } from 'expo-router';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import {
  ArrowLeft,
  Blocks,
  CheckCircle2,
  ChevronRight,
  Clock,
  Cloud,
  Globe,
  Search,
  ShieldCheck,
  Zap,
} from 'lucide-react-native';

import { AppHeader } from '@/components/app-header';
import {
  connectComposioToolkit,
  fetchComposioCatalog,
  fetchServers,
  openMarketplaceAuthorization,
  verifyConnection,
  type CatalogEntry,
  type ComposioCatalogItem,
} from '@/lib/mcp';

const CATEGORIES = ['all', 'search', 'data', 'dev', 'productivity', 'payments', 'observability', 'other'] as const;
const TABS = ['built-in', 'composio'] as const;
type Tab = (typeof TABS)[number];

const AUTH_LABEL: Record<string, string> = {
  none: 'No sign-in',
  api_key: 'API key',
  oauth2: 'OAuth 2.0',
  pat: 'Personal Token',
  provider_managed: 'Managed auth',
};

const ACTION_LABEL: Record<string, string> = {
  pending: 'Finish connecting',
  expired: 'Reconnect',
  error: 'Reconnect',
};

const POLL_INTERVAL_MS = 2_000;
const POLL_ATTEMPTS = 30;

export default function MarketplaceScreen() {
  const router = useRouter();
  const insets = useSafeAreaInsets();

  const [tab, setTab] = useState<Tab>('built-in');
  const [servers, setServers] = useState<CatalogEntry[]>([]);
  const [toolkits, setToolkits] = useState<ComposioCatalogItem[]>([]);
  const [composioTotal, setComposioTotal] = useState(0);
  const [composioCategories, setComposioCategories] = useState<string[]>([]);
  const [composioConfigured, setComposioConfigured] = useState(true);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [query, setQuery] = useState('');
  const [category, setCategory] = useState<string>('all');
  const [showConnected, setShowConnected] = useState(false);
  const [connecting, setConnecting] = useState<string | null>(null);

  const load = useCallback(async () => {
    try {
      if (tab === 'built-in') {
        const entries = await fetchServers({
          q: query.trim() || undefined,
          category: category === 'all' ? undefined : category,
          connected: showConnected || undefined,
          provider: 'direct',
        });
        setServers(entries);
      } else {
        const response = await fetchComposioCatalog({
          q: query.trim() || undefined,
          category: category === 'all' ? undefined : category,
        });
        setComposioConfigured(response.configured);
        setToolkits(
          showConnected ? response.items.filter((item) => item.connected) : response.items,
        );
        setComposioTotal(response.total);
        setComposioCategories(response.categories);
      }
      setError(null);
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setLoading(false);
      setRefreshing(false);
    }
  }, [tab, query, category, showConnected]);

  useFocusEffect(
    useCallback(() => {
      void load();
    }, [load]),
  );

  const aliveRef = useRef(true);
  useEffect(() => {
    aliveRef.current = true;
    return () => {
      aliveRef.current = false;
    };
  }, []);

  const pollVerify = useCallback(
    async (connectionId: string) => {
      for (let attempt = 0; attempt < POLL_ATTEMPTS; attempt += 1) {
        await new Promise((resolve) => setTimeout(resolve, POLL_INTERVAL_MS));
        if (!aliveRef.current) return;
        try {
          const result = await verifyConnection(connectionId, { issueLink: false });
          if (!aliveRef.current) return;
          if (result.status !== 'pending') {
            await load();
            return;
          }
        } catch {
          // Transient failure → keep polling until the budget runs out.
        }
      }
      if (aliveRef.current) await load();
    },
    [load],
  );

  const switchTab = (next: Tab) => {
    if (next === tab) return;
    setTab(next);
    setCategory('all');
    setShowConnected(false);
    setError(null);
    setLoading(true);
  };

  const onPressToolkit = async (item: ComposioCatalogItem) => {
    if (item.connected && item.serverId) {
      router.push(`/mcp/${item.serverId}`);
      return;
    }
    if (connecting) return;
    setConnecting(item.toolkit);
    try {
      const result = item.connectionId
        ? await verifyConnection(item.connectionId, { issueLink: true })
        : await connectComposioToolkit(item.toolkit);

      if (result.authorizationUrl) {
        const serverId = item.serverId ?? ('serverId' in result ? result.serverId : undefined);
        if (!serverId) throw new Error('The integration was connected but its app destination is missing.');
        await openMarketplaceAuthorization(result.authorizationUrl, serverId);
        const connectionId = item.connectionId ?? ('connectionId' in result ? result.connectionId : undefined);
        if (connectionId) void pollVerify(connectionId);
      } else {
        await load();
        if (result.status === 'connected') {
          const serverId = item.serverId ?? ('serverId' in result ? result.serverId : undefined);
          if (serverId) router.push(`/mcp/${serverId}`);
        }
      }
    } catch (err) {
      RNAlert.alert(
        'Could not connect',
        err instanceof Error ? err.message : String(err),
        [{ text: 'OK' }],
      );
      await load();
    } finally {
      setConnecting(null);
    }
  };

  const emptyRows = tab === 'built-in' ? servers : toolkits;
  const showSpinner = loading && emptyRows.length === 0 && !error;

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
            Integrations
          </Typography>
        }
      />

      {showSpinner ? (
        <View className="flex-1 items-center justify-center">
          <Spinner size="lg" color="default" />
        </View>
      ) : (
        <ScrollView
          contentContainerStyle={{ padding: 16, paddingBottom: insets.bottom + 24, gap: 14 }}
          keyboardShouldPersistTaps="handled"
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
          {/* Segmented Tab Switcher */}
          <View className="flex-row rounded-full border border-white/10 bg-white/5 p-1">
            <Pressable
              onPress={() => switchTab('built-in')}
              className={`flex-1 items-center justify-center rounded-full py-2 ${
                tab === 'built-in' ? 'bg-white shadow-sm' : ''
              }`}
            >
              <Typography
                type="body-sm"
                className={`font-semibold ${tab === 'built-in' ? 'text-black' : 'text-white/60'}`}
              >
                Built-in
              </Typography>
            </Pressable>
            <Pressable
              onPress={() => switchTab('composio')}
              className={`flex-1 items-center justify-center rounded-full py-2 ${
                tab === 'composio' ? 'bg-white shadow-sm' : ''
              }`}
            >
              <Typography
                type="body-sm"
                className={`font-semibold ${tab === 'composio' ? 'text-black' : 'text-white/60'}`}
              >
                Composio {composioTotal > 0 ? `(${composioTotal})` : ''}
              </Typography>
            </Pressable>
          </View>

          {/* Search Input */}
          <View className="flex-row items-center rounded-full border border-white/10 bg-[#16171B] px-4 py-2.5">
            <Search size={16} color="rgba(255,255,255,0.4)" />
            <TextInput
              value={query}
              onChangeText={setQuery}
              placeholder={tab === 'built-in' ? 'Search integrations…' : 'Search 1,700+ Composio apps…'}
              placeholderTextColor="rgba(255,255,255,0.3)"
              className="ml-2.5 flex-1 text-sm text-white"
              autoCapitalize="none"
              autoCorrect={false}
              returnKeyType="search"
              clearButtonMode="while-editing"
            />
          </View>

          {/* Category Chips Scroll */}
          <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={{ gap: 8 }}>
            {(tab === 'built-in' ? CATEGORIES : ['all', ...composioCategories]).map((item) => {
              const active = category === item;
              return (
                <Pressable
                  key={item}
                  onPress={() => setCategory(item)}
                  className={`rounded-full px-3.5 py-1.5 border ${
                    active
                      ? 'border-white bg-white'
                      : 'border-white/10 bg-white/5 active:bg-white/10'
                  }`}
                >
                  <Typography
                    type="body-xs"
                    className={`font-medium capitalize ${active ? 'text-black font-semibold' : 'text-white/70'}`}
                  >
                    {item}
                  </Typography>
                </Pressable>
              );
            })}
            <Pressable
              onPress={() => setShowConnected((current) => !current)}
              className={`flex-row items-center gap-1.5 rounded-full px-3.5 py-1.5 border ${
                showConnected
                  ? 'border-emerald-500/40 bg-emerald-500/20'
                  : 'border-white/10 bg-white/5 active:bg-white/10'
              }`}
            >
              <View
                className={`h-2 w-2 rounded-full ${showConnected ? 'bg-emerald-400' : 'bg-white/30'}`}
              />
              <Typography
                type="body-xs"
                className={`font-medium ${showConnected ? 'text-emerald-300 font-semibold' : 'text-white/70'}`}
              >
                Connected
              </Typography>
            </Pressable>
          </ScrollView>

          {/* Warning Notice if Composio Not Configured */}
          {tab === 'composio' && !composioConfigured ? (
            <View className="rounded-2xl border border-amber-500/20 bg-amber-500/10 p-4">
              <Typography type="body-sm" className="font-semibold text-amber-300">
                Composio is not configured
              </Typography>
              <Typography type="body-xs" className="mt-1 text-amber-300/80">
                Set COMPOSIO_API_KEY in the API server environment to unlock 1,700+ app toolkits.
              </Typography>
            </View>
          ) : null}

          {/* Total Indicator */}
          {tab === 'composio' && composioConfigured && composioTotal > toolkits.length ? (
            <Typography type="body-xs" className="px-1 text-white/40">
              Showing {toolkits.length} of {composioTotal} toolkits — refine search to filter.
            </Typography>
          ) : null}

          {/* Error Notice */}
          {error ? (
            <View className="rounded-2xl border border-red-500/20 bg-red-500/10 p-4">
              <Typography type="body-sm" className="text-red-400">
                {error}
              </Typography>
            </View>
          ) : null}

          {/* Empty State */}
          {emptyRows.length === 0 && !error ? (
            <View className="mt-14 items-center justify-center px-6">
              <View className="h-16 w-16 items-center justify-center rounded-2xl border border-white/10 bg-white/5 mb-4">
                <Blocks size={28} color="rgba(255,255,255,0.4)" />
              </View>
              <Typography type="h4" className="text-center font-semibold text-white mb-1.5">
                No integrations found
              </Typography>
              <Typography type="body-sm" className="text-center text-white/50 leading-relaxed max-w-[280px]">
                {tab === 'built-in'
                  ? 'No built-in services match your filter. Try clearing the search or category.'
                  : 'Try typing a different app name like GitHub, Slack, Notion, or Gmail.'}
              </Typography>
            </View>
          ) : null}

          {/* Built-in Servers List */}
          {tab === 'built-in' && servers.length > 0 ? (
            <View className="gap-2.5">
              {servers.map((server) => {
                const isConn = server.connected;
                return (
                  <Pressable
                    key={server.id}
                    onPress={() => router.push(`/mcp/${server.id}`)}
                    className="rounded-2xl border border-white/5 bg-[#131418] p-4 active:scale-[0.99] transition-transform"
                  >
                    <View className="flex-row items-center gap-3">
                      <View className="h-11 w-11 items-center justify-center rounded-xl border border-cyan-500/20 bg-cyan-500/10">
                        <Cloud size={20} color="#22D3EE" />
                      </View>
                      <View className="flex-1">
                        <View className="flex-row items-center gap-2">
                          <Typography type="h5" className="font-semibold text-white" numberOfLines={1}>
                            {server.name}
                          </Typography>
                          {server.isVerified ? (
                            <ShieldCheck size={15} color="#38BDF8" />
                          ) : null}
                        </View>
                        <Typography type="body-xs" className="mt-0.5 text-white/50" numberOfLines={2}>
                          {server.description || 'Vendor-hosted remote MCP server.'}
                        </Typography>
                        <View className="mt-2 flex-row items-center gap-2">
                          <View className="rounded-md bg-white/10 px-1.5 py-0.5">
                            <Typography type="body-xs" className="text-white/60">
                              {AUTH_LABEL[server.authType] ?? server.authType}
                            </Typography>
                          </View>
                          {server.isFreeTier ? (
                            <View className="rounded-md bg-emerald-500/10 px-1.5 py-0.5 border border-emerald-500/20">
                              <Typography type="body-xs" className="text-emerald-400">
                                free tier
                              </Typography>
                            </View>
                          ) : null}
                        </View>
                      </View>
                      <View className="items-end gap-1">
                        {isConn ? (
                          <View className="flex-row items-center gap-1 rounded-full border border-emerald-500/20 bg-emerald-500/10 px-2.5 py-1">
                            <CheckCircle2 size={12} color="#34D399" />
                            <Typography type="body-xs" className="font-medium text-emerald-400">
                              Active
                            </Typography>
                          </View>
                        ) : server.connectionStatus ? (
                          <View className="flex-row items-center gap-1 rounded-full border border-amber-500/20 bg-amber-500/10 px-2.5 py-1">
                            <Clock size={12} color="#FBBF24" />
                            <Typography type="body-xs" className="font-medium text-amber-400">
                              {server.connectionStatus}
                            </Typography>
                          </View>
                        ) : (
                          <View className="flex-row items-center gap-1 rounded-full border border-white/10 bg-white/5 px-2.5 py-1">
                            <Typography type="body-xs" className="text-white/60">
                              Connect
                            </Typography>
                            <ChevronRight size={12} color="rgba(255,255,255,0.4)" />
                          </View>
                        )}
                      </View>
                    </View>
                  </Pressable>
                );
              })}
            </View>
          ) : null}

          {/* Composio Toolkits List */}
          {tab === 'composio' && toolkits.length > 0 ? (
            <View className="gap-2.5">
              {toolkits.map((item) => {
                const isConnecting = connecting === item.toolkit;
                const isConn = item.connected;
                const actionText = isConn
                  ? 'Manage'
                  : (ACTION_LABEL[item.connectionStatus ?? ''] ?? 'Connect');

                return (
                  <Pressable
                    key={item.toolkit}
                    disabled={isConnecting}
                    onPress={() => void onPressToolkit(item)}
                    className="rounded-2xl border border-white/5 bg-[#131418] p-4 active:scale-[0.99] transition-transform"
                  >
                    <View className="flex-row items-center gap-3">
                      <View className="h-11 w-11 items-center justify-center rounded-xl border border-purple-500/20 bg-purple-500/10">
                        <Zap size={20} color="#C084FC" />
                      </View>
                      <View className="flex-1">
                        <View className="flex-row items-center gap-2">
                          <Typography type="h5" className="font-semibold text-white" numberOfLines={1}>
                            {item.name}
                          </Typography>
                          {item.toolCount > 0 ? (
                            <View className="rounded-md bg-white/10 px-1.5 py-0.5">
                              <Typography type="body-xs" className="text-white/60">
                                {item.toolCount} tools
                              </Typography>
                            </View>
                          ) : null}
                        </View>
                        <Typography type="body-xs" className="mt-0.5 text-white/50" numberOfLines={2}>
                          {item.description || 'Composio toolkit integration.'}
                        </Typography>
                        <Typography type="body-xs" className="mt-1.5 text-white/40">
                          {item.authSchemes.length > 0 ? item.authSchemes.join(' · ') : 'managed auth'}
                        </Typography>
                      </View>

                      <View className="items-end">
                        {isConnecting ? (
                          <Spinner size="sm" color="default" />
                        ) : isConn ? (
                          <View className="flex-row items-center gap-1 rounded-full border border-emerald-500/20 bg-emerald-500/10 px-2.5 py-1">
                            <CheckCircle2 size={12} color="#34D399" />
                            <Typography type="body-xs" className="font-medium text-emerald-400">
                              Connected
                            </Typography>
                          </View>
                        ) : (
                          <View className="flex-row items-center gap-1 rounded-full border border-white/10 bg-white/10 px-3 py-1.5 active:bg-white/20">
                            <Typography type="body-xs" className="font-semibold text-white">
                              {actionText}
                            </Typography>
                            <ChevronRight size={12} color="#fff" />
                          </View>
                        )}
                      </View>
                    </View>
                  </Pressable>
                );
              })}
            </View>
          ) : null}
        </ScrollView>
      )}
    </View>
  );
}
