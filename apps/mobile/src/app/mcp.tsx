import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { Spinner } from 'heroui-native';
import {
  FlatList,
  Pressable,
  RefreshControl,
  ScrollView,
  StyleSheet,
  Text,
  TextInput,
  View,
} from 'react-native';
import { useFocusEffect, useRouter } from 'expo-router';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import {
  Blocks,
  Check,
  ChevronLeft,
  ChevronRight,
  Clock,
  Cloud,
  Search,
  ShieldCheck,
  X,
} from 'lucide-react-native';
import { SymbolIcon } from '@/components/symbol-icon';

import { AppHeader, useHeaderInset } from '@/components/app-header';
import { HairlineDivider, InlineError, RoundButton, SectionLabel } from '@/components/design-system';
import { IntegrationIcon } from '@/components/integration-icon';
import { reportAppError } from '@/components/error-dialog-provider';
import { colors, radius, shadow, space } from '@/theme';
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
  pat: 'Personal token',
  provider_managed: 'Managed auth',
};

const ACTION_LABEL: Record<string, string> = {
  pending: 'Finish connecting',
  expired: 'Reconnect',
  error: 'Reconnect',
};

const POLL_INTERVAL_MS = 2_000;
const POLL_ATTEMPTS = 30;

/**
 * One row of the virtualized marketplace. Built-in servers and Composio
 * toolkits share the list but render differently; each cell carries
 * first/last flags so it renders only its slice of the grouped card.
 */
type McpCell =
  | {
      key: string;
      kind: 'server';
      server: CatalogEntry;
      first: boolean;
      last: boolean;
    }
  | {
      key: string;
      kind: 'toolkit';
      toolkit: ComposioCatalogItem;
      first: boolean;
      last: boolean;
    };

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
      reportAppError(err, { title: 'Could not connect' });
      await load();
    } finally {
      setConnecting(null);
    }
  };

  const emptyRows = tab === 'built-in' ? servers : toolkits;
  const showSpinner = loading && emptyRows.length === 0 && !error;

  const handleBack = useCallback(() => {
    if (router.canGoBack()) {
      router.back();
    } else {
      router.replace('/more');
    }
  }, [router]);

  const headerInset = useHeaderInset();

  // Flatten whichever catalog is showing into virtualizable cells.
  const mcpCells = useMemo<McpCell[]>(() => {
    if (tab === 'built-in') {
      return servers.map((server, index) => ({
        key: server.id,
        kind: 'server' as const,
        server,
        first: index === 0,
        last: index === servers.length - 1,
      }));
    }
    return toolkits.map((toolkit, index) => ({
      key: toolkit.toolkit,
      kind: 'toolkit' as const,
      toolkit,
      first: index === 0,
      last: index === toolkits.length - 1,
    }));
  }, [tab, servers, toolkits]);

  return (
    <View style={styles.screen}>
      <AppHeader
        left={
          <RoundButton
            icon={ChevronLeft}
            onPress={handleBack}
            accessibilityLabel="Go back"
          />
        }
        center={
          <Text style={styles.headerTitle}>
            Integrations
          </Text>
        }
      />

      {showSpinner ? (
        <View style={styles.center}>
          <Spinner size="lg" color="default" />
        </View>
      ) : (
        <FlatList
          data={mcpCells}
          keyExtractor={(cell) => cell.key}
          renderItem={({ item: cell }) => (
            <View
              style={[
                styles.cardSlice,
                cell.first && styles.cardSliceTop,
                cell.last && styles.cardSliceBottom,
              ]}
            >
              {!cell.first ? <HairlineDivider inset={68} /> : null}
              {cell.kind === 'server' ? (
                <Pressable
                  onPress={() => router.push(`/mcp/${cell.server.id}`)}
                  accessibilityRole="button"
                  accessibilityLabel={`Open ${cell.server.name}`}
                  style={({ pressed }) => [
                    styles.integrationRow,
                    { opacity: pressed ? 0.6 : 1 },
                  ]}
                >
                  <View style={styles.tileIcon}>
                    {cell.server.iconUrl ? (
                      <IntegrationIcon uri={cell.server.iconUrl} size={28} />
                    ) : (
                      <SymbolIcon icon={Cloud} size={20} color={colors.textPrimary} strokeWidth={1.75} />
                    )}
                  </View>
                  <View style={styles.integrationContent}>
                    <View style={styles.titleRow}>
                      <Text numberOfLines={1} style={styles.integrationName}>
                        {cell.server.name}
                      </Text>
                      {cell.server.isVerified ? (
                        <SymbolIcon icon={ShieldCheck} size={14} color={colors.textSecondary} strokeWidth={2} />
                      ) : null}
                    </View>
                    <Text numberOfLines={2} style={styles.integrationDesc}>
                      {cell.server.description || 'Vendor-hosted remote MCP server.'}
                    </Text>
                    <View style={styles.tagRow}>
                      <View style={styles.tagPill}>
                        <Text style={styles.tagText}>
                          {AUTH_LABEL[cell.server.authType] ?? cell.server.authType}
                        </Text>
                      </View>
                      {cell.server.isFreeTier ? (
                        <View style={styles.tagPill}>
                          <Text style={styles.tagText}>free tier</Text>
                        </View>
                      ) : null}
                    </View>
                  </View>

                  <View style={styles.actionColumn}>
                    {cell.server.connected ? (
                      <View style={styles.activePill}>
                        <SymbolIcon icon={Check} size={12} color={colors.success} strokeWidth={2.5} />
                        <Text style={styles.activeText}>Active</Text>
                      </View>
                    ) : cell.server.connectionStatus ? (
                      <View style={styles.statusPill}>
                        <SymbolIcon icon={Clock} size={12} color={colors.textSecondary} strokeWidth={2} />
                        <Text style={styles.statusText}>{cell.server.connectionStatus}</Text>
                      </View>
                    ) : (
                      <View style={styles.connectPill}>
                        <Text style={styles.connectText}>Connect</Text>
                        <SymbolIcon icon={ChevronRight} size={14} color={colors.textSecondary} strokeWidth={1.75} />
                      </View>
                    )}
                  </View>
                </Pressable>
              ) : (
                <Pressable
                  disabled={connecting === cell.toolkit.toolkit}
                  onPress={() => void onPressToolkit(cell.toolkit)}
                  accessibilityRole="button"
                  accessibilityLabel={`Open ${cell.toolkit.name}`}
                  style={({ pressed }) => [
                    styles.integrationRow,
                    { opacity: pressed ? 0.6 : 1 },
                  ]}
                >
                  {/*
                    The integration's own logo. When Composio has no logo
                    for a toolkit the tile is simply left empty — no
                    stand-in icon is invented for it.
                  */}
                  <View style={styles.tileIcon}>
                    <IntegrationIcon uri={cell.toolkit.logo} size={28} />
                  </View>
                  <View style={styles.integrationContent}>
                    <View style={styles.titleRow}>
                      <Text numberOfLines={1} style={styles.integrationName}>
                        {cell.toolkit.name}
                      </Text>
                      {cell.toolkit.toolCount > 0 ? (
                        <View style={styles.tagPill}>
                          <Text style={styles.tagText}>{`${cell.toolkit.toolCount} tools`}</Text>
                        </View>
                      ) : null}
                    </View>
                    <Text numberOfLines={2} style={styles.integrationDesc}>
                      {cell.toolkit.description || 'Composio toolkit integration.'}
                    </Text>
                    <Text numberOfLines={1} style={styles.authText}>
                      {cell.toolkit.authSchemes.length > 0 ? cell.toolkit.authSchemes.join(' · ') : 'managed auth'}
                    </Text>
                  </View>

                  <View style={styles.actionColumn}>
                    {connecting === cell.toolkit.toolkit ? (
                      <Spinner size="sm" color="default" />
                    ) : cell.toolkit.connected ? (
                      <View style={styles.activePill}>
                        <SymbolIcon icon={Check} size={12} color={colors.success} strokeWidth={2.5} />
                        <Text style={styles.activeText}>Active</Text>
                      </View>
                    ) : (
                      <View style={styles.connectPill}>
                        <Text style={styles.connectText}>
                          {ACTION_LABEL[cell.toolkit.connectionStatus ?? ''] ?? 'Connect'}
                        </Text>
                        <SymbolIcon icon={ChevronRight} size={14} color={colors.textSecondary} strokeWidth={1.75} />
                      </View>
                    )}
                  </View>
                </Pressable>
              )}
            </View>
          )}
          ListHeaderComponent={
            <View style={styles.listHeader}>
              {/* Segmented Tab Switcher */}
              <View style={styles.tabSwitcher}>
                <Pressable
                  onPress={() => switchTab('built-in')}
                  style={[
                    styles.tabSegment,
                    tab === 'built-in' && styles.tabSegmentActive,
                    tab === 'built-in' && shadow.floating,
                  ]}
                >
                  <Text
                    style={[
                      styles.tabSegmentText,
                      tab === 'built-in' && styles.tabSegmentTextActive,
                    ]}
                  >
                    Built-in
                  </Text>
                </Pressable>
                <Pressable
                  onPress={() => switchTab('composio')}
                  style={[
                    styles.tabSegment,
                    tab === 'composio' && styles.tabSegmentActive,
                    tab === 'composio' && shadow.floating,
                  ]}
                >
                  <Text
                    style={[
                      styles.tabSegmentText,
                      tab === 'composio' && styles.tabSegmentTextActive,
                    ]}
                  >
                    {`Composio ${composioTotal > 0 ? `(${composioTotal})` : ''}`}
                  </Text>
                </Pressable>
              </View>

              {/* Pill Search Input */}
              <View style={styles.searchBar}>
                <SymbolIcon icon={Search} size={16} color={colors.textSecondary} strokeWidth={1.75} />
                <TextInput
                  value={query}
                  onChangeText={setQuery}
                  placeholder={tab === 'built-in' ? 'Search integrations…' : 'Search 1,700+ Composio apps…'}
                  placeholderTextColor={colors.textSecondary}
                  style={styles.searchInput}
                  autoCapitalize="none"
                  autoCorrect={false}
                  returnKeyType="search"
                />
                {query ? (
                  <Pressable onPress={() => setQuery('')} accessibilityRole="button" accessibilityLabel="Clear search">
                    <SymbolIcon icon={X} size={16} color={colors.textSecondary} />
                  </Pressable>
                ) : null}
              </View>

              {/* Category Chips Scroll */}
              <ScrollView
                horizontal
                showsVerticalScrollIndicator={false}
                contentContainerStyle={styles.chipsContainer}
              >
                {(tab === 'built-in' ? CATEGORIES : ['all', ...composioCategories]).map((item) => {
                  const active = category === item;
                  return (
                    <Pressable
                      key={item}
                      onPress={() => setCategory(item)}
                      style={[
                        styles.chip,
                        active && styles.chipActive,
                      ]}
                    >
                      <Text
                        style={[
                          styles.chipText,
                          active && styles.chipTextActive,
                        ]}
                      >
                        {item}
                      </Text>
                    </Pressable>
                  );
                })}
                <Pressable
                  onPress={() => setShowConnected((current) => !current)}
                  style={[
                    styles.chip,
                    showConnected && styles.chipActive,
                  ]}
                >
                  <View
                    style={[
                      styles.connectedDot,
                      { backgroundColor: showConnected ? colors.onPrimary : colors.success },
                    ]}
                  />
                  <Text
                    style={[
                      styles.chipText,
                      showConnected && styles.chipTextActive,
                    ]}
                  >
                    Connected
                  </Text>
                </Pressable>
              </ScrollView>

              {/* Warning Notice if Composio Not Configured */}
              {tab === 'composio' && !composioConfigured ? (
                <View style={styles.noticeBox}>
                  <Text style={styles.noticeTitle}>
                    Composio is not configured
                  </Text>
                  <Text style={styles.noticeSubtitle}>
                    Set COMPOSIO_API_KEY in the API server environment to unlock 1,700+ app toolkits.
                  </Text>
                </View>
              ) : null}

              {/* Total Indicator */}
              {tab === 'composio' && composioConfigured && composioTotal > toolkits.length ? (
                <Text style={styles.counterText}>
                  {`Showing ${toolkits.length} of ${composioTotal} toolkits — refine search to filter.`}
                </Text>
              ) : null}

              {/* Error Notice */}
              {error ? <InlineError message={error} onRetry={() => void load()} /> : null}
            </View>
          }
          ListEmptyComponent={
            emptyRows.length === 0 && !error ? (
              <View style={styles.emptyContainer}>
                <View style={styles.emptyIconBox}>
                  <SymbolIcon icon={Blocks} size={32} color={colors.textSecondary} strokeWidth={1.5} />
                </View>
                <Text style={styles.emptyTitle}>
                  No integrations found
                </Text>
                <Text style={styles.emptySubtitle}>
                  {tab === 'built-in'
                    ? 'No built-in services match your filter. Try clearing the search or category.'
                    : 'Try typing a different app name like GitHub, Slack, Notion, or Gmail.'}
                </Text>
              </View>
            ) : undefined
          }
          contentContainerStyle={{
            paddingTop: headerInset,
            paddingHorizontal: space.lg,
            paddingBottom: insets.bottom + 32,
          }}
          keyboardShouldPersistTaps="handled"
          refreshControl={
            <RefreshControl
              refreshing={refreshing}
              onRefresh={() => {
                setRefreshing(true);
                void load();
              }}
              tintColor={colors.textPrimary}
            />
          }
        />
      )}
    </View>
  );
}

const styles = StyleSheet.create({
  screen: {
    flex: 1,
    backgroundColor: colors.background,
  },
  headerTitle: {
    fontSize: 20,
    lineHeight: 26,
    fontWeight: '600',
    color: colors.textPrimary,
  },
  center: {
    flex: 1,
    alignItems: 'center',
    justifyContent: 'center',
  },
  tabSwitcher: {
    flexDirection: 'row',
    borderRadius: radius.pill,
    backgroundColor: colors.surface,
    padding: 3,
  },
  tabSegment: {
    flex: 1,
    alignItems: 'center',
    justifyContent: 'center',
    borderRadius: radius.pill,
    paddingVertical: 8,
  },
  tabSegmentActive: {
    backgroundColor: colors.surfaceRaised,
  },
  tabSegmentText: {
    fontSize: 14,
    lineHeight: 18,
    fontWeight: '500',
    color: colors.textSecondary,
    fontVariant: ['tabular-nums'],
  },
  tabSegmentTextActive: {
    fontWeight: '600',
    color: colors.textPrimary,
  },
  searchBar: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: space.sm,
    backgroundColor: colors.surface,
    borderRadius: radius.pill,
    paddingHorizontal: space.md,
    height: 44,
  },
  searchInput: {
    flex: 1,
    fontSize: 16,
    color: colors.textPrimary,
  },
  chipsContainer: {
    gap: space.xs,
    paddingVertical: 2,
  },
  chip: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
    borderRadius: radius.pill,
    backgroundColor: colors.surface,
    paddingHorizontal: 14,
    paddingVertical: 7,
  },
  chipActive: {
    backgroundColor: colors.primary,
  },
  chipText: {
    fontSize: 13,
    fontWeight: '500',
    color: colors.textSecondary,
    textTransform: 'capitalize',
  },
  chipTextActive: {
    color: colors.onPrimary,
    fontWeight: '600',
  },
  connectedDot: {
    width: 6,
    height: 6,
    borderRadius: radius.pill,
  },
  noticeBox: {
    backgroundColor: colors.surface,
    borderRadius: radius.card,
    padding: space.md,
    gap: 2,
  },
  noticeTitle: {
    fontSize: 14,
    fontWeight: '600',
    color: colors.textPrimary,
  },
  noticeSubtitle: {
    fontSize: 13,
    lineHeight: 17,
    color: colors.textSecondary,
  },
  counterText: {
    fontSize: 12,
    color: colors.textSecondary,
    paddingHorizontal: 4,
    fontVariant: ['tabular-nums'],
  },
  listHeader: {
    gap: space.md,
    // Replaces the content container's old 12pt gap below the header.
    marginBottom: space.md,
  },
  cardSlice: {
    backgroundColor: colors.surface,
    paddingHorizontal: space.lg,
  },
  cardSliceTop: {
    borderTopLeftRadius: radius.card,
    borderTopRightRadius: radius.card,
  },
  cardSliceBottom: {
    borderBottomLeftRadius: radius.card,
    borderBottomRightRadius: radius.card,
  },
  emptyContainer: {
    marginTop: 48,
    alignItems: 'center',
    justifyContent: 'center',
    paddingHorizontal: space.xl,
    gap: space.xs,
  },
  emptyIconBox: {
    width: 64,
    height: 64,
    borderRadius: radius.card,
    backgroundColor: colors.surface,
    alignItems: 'center',
    justifyContent: 'center',
    marginBottom: space.sm,
  },
  emptyTitle: {
    fontSize: 20,
    lineHeight: 26,
    fontWeight: '600',
    color: colors.textPrimary,
  },
  emptySubtitle: {
    fontSize: 15,
    lineHeight: 20,
    color: colors.textSecondary,
    textAlign: 'center',
    maxWidth: 280,
  },
  integrationRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: space.md,
    paddingHorizontal: space.lg,
    paddingVertical: 14,
  },
  tileIcon: {
    width: 44,
    height: 44,
    borderRadius: radius.tile,
    backgroundColor: colors.surfaceRaised,
    alignItems: 'center',
    justifyContent: 'center',
  },
  integrationContent: {
    flex: 1,
    minWidth: 0,
    gap: 2,
  },
  titleRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
  },
  integrationName: {
    fontSize: 16,
    lineHeight: 22,
    fontWeight: '600',
    color: colors.textPrimary,
    flexShrink: 1,
  },
  integrationDesc: {
    fontSize: 13,
    lineHeight: 17,
    color: colors.textSecondary,
  },
  tagRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
    marginTop: 2,
  },
  tagPill: {
    borderRadius: radius.pill,
    backgroundColor: colors.surfaceRaised,
    paddingHorizontal: 8,
    paddingVertical: 2,
  },
  tagText: {
    fontSize: 11,
    fontWeight: '500',
    color: colors.textSecondary,
    fontVariant: ['tabular-nums'],
  },
  authText: {
    fontSize: 11,
    lineHeight: 14,
    color: colors.textTertiary,
    marginTop: 2,
  },
  actionColumn: {
    alignItems: 'flex-end',
    justifyContent: 'center',
  },
  activePill: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 4,
    borderRadius: radius.pill,
    backgroundColor: colors.surfaceRaised,
    paddingHorizontal: 10,
    paddingVertical: 5,
  },
  activeText: {
    fontSize: 12,
    fontWeight: '600',
    color: colors.success,
  },
  statusPill: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 4,
    borderRadius: radius.pill,
    backgroundColor: colors.surfaceRaised,
    paddingHorizontal: 10,
    paddingVertical: 5,
  },
  statusText: {
    fontSize: 12,
    fontWeight: '500',
    color: colors.textSecondary,
    textTransform: 'capitalize',
  },
  connectPill: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 3,
    borderRadius: radius.pill,
    backgroundColor: colors.surfaceRaised,
    paddingHorizontal: 12,
    paddingVertical: 6,
  },
  connectText: {
    fontSize: 13,
    fontWeight: '600',
    color: colors.textPrimary,
  },
});
