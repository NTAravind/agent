import React, { useCallback, useEffect, useRef, useState } from 'react';
import { Spinner } from 'heroui-native';
import {
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

import { AppHeader } from '@/components/app-header';
import { GroupedCard, HairlineDivider, RoundButton, SectionLabel } from '@/components/design-system';
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
        <ScrollView
          contentContainerStyle={{
            paddingHorizontal: space.lg,
            paddingTop: space.sm,
            paddingBottom: insets.bottom + 32,
            gap: space.md,
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
        >
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
            <Search size={16} color={colors.textSecondary} strokeWidth={1.75} />
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
                <X size={16} color={colors.textSecondary} />
              </Pressable>
            ) : null}
          </View>

          {/* Category Chips Scroll */}
          <ScrollView
            horizontal
            showsHorizontalScrollIndicator={false}
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
          {error ? (
            <View style={styles.errorBox}>
              <Text style={styles.errorText}>{error}</Text>
            </View>
          ) : null}

          {/* Empty State */}
          {emptyRows.length === 0 && !error ? (
            <View style={styles.emptyContainer}>
              <View style={styles.emptyIconBox}>
                <Blocks size={32} color={colors.textSecondary} strokeWidth={1.5} />
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
          ) : null}

          {/* Built-in Servers List */}
          {tab === 'built-in' && servers.length > 0 ? (
            <GroupedCard>
              {servers.map((server, index) => {
                const isConn = server.connected;
                return (
                  <React.Fragment key={server.id}>
                    {index > 0 && <HairlineDivider inset={68} />}
                    <Pressable
                      onPress={() => router.push(`/mcp/${server.id}`)}
                      accessibilityRole="button"
                      accessibilityLabel={`Open ${server.name}`}
                      style={({ pressed }) => [
                        styles.integrationRow,
                        { opacity: pressed ? 0.6 : 1 },
                      ]}
                    >
                      <View style={styles.tileIcon}>
                        {server.iconUrl ? (
                          <IntegrationIcon uri={server.iconUrl} size={28} />
                        ) : (
                          <Cloud size={20} color={colors.textPrimary} strokeWidth={1.75} />
                        )}
                      </View>
                      <View style={styles.integrationContent}>
                        <View style={styles.titleRow}>
                          <Text numberOfLines={1} style={styles.integrationName}>
                            {server.name}
                          </Text>
                          {server.isVerified ? (
                            <ShieldCheck size={14} color={colors.textSecondary} strokeWidth={2} />
                          ) : null}
                        </View>
                        <Text numberOfLines={2} style={styles.integrationDesc}>
                          {server.description || 'Vendor-hosted remote MCP server.'}
                        </Text>
                        <View style={styles.tagRow}>
                          <View style={styles.tagPill}>
                            <Text style={styles.tagText}>
                              {AUTH_LABEL[server.authType] ?? server.authType}
                            </Text>
                          </View>
                          {server.isFreeTier ? (
                            <View style={styles.tagPill}>
                              <Text style={styles.tagText}>free tier</Text>
                            </View>
                          ) : null}
                        </View>
                      </View>

                      <View style={styles.actionColumn}>
                        {isConn ? (
                          <View style={styles.activePill}>
                            <Check size={12} color={colors.success} strokeWidth={2.5} />
                            <Text style={styles.activeText}>Active</Text>
                          </View>
                        ) : server.connectionStatus ? (
                          <View style={styles.statusPill}>
                            <Clock size={12} color={colors.textSecondary} strokeWidth={2} />
                            <Text style={styles.statusText}>{server.connectionStatus}</Text>
                          </View>
                        ) : (
                          <View style={styles.connectPill}>
                            <Text style={styles.connectText}>Connect</Text>
                            <ChevronRight size={14} color={colors.textSecondary} strokeWidth={1.75} />
                          </View>
                        )}
                      </View>
                    </Pressable>
                  </React.Fragment>
                );
              })}
            </GroupedCard>
          ) : null}

          {/* Composio Toolkits List */}
          {tab === 'composio' && toolkits.length > 0 ? (
            <GroupedCard>
              {toolkits.map((item, index) => {
                const isConnecting = connecting === item.toolkit;
                const isConn = item.connected;
                const actionText = isConn
                  ? 'Manage'
                  : (ACTION_LABEL[item.connectionStatus ?? ''] ?? 'Connect');

                return (
                  <React.Fragment key={item.toolkit}>
                    {index > 0 && <HairlineDivider inset={68} />}
                    <Pressable
                      disabled={isConnecting}
                      onPress={() => void onPressToolkit(item)}
                      accessibilityRole="button"
                      accessibilityLabel={`Open ${item.name}`}
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
                        <IntegrationIcon uri={item.logo} size={28} />
                      </View>
                      <View style={styles.integrationContent}>
                        <View style={styles.titleRow}>
                          <Text numberOfLines={1} style={styles.integrationName}>
                            {item.name}
                          </Text>
                          {item.toolCount > 0 ? (
                            <View style={styles.tagPill}>
                              <Text style={styles.tagText}>{`${item.toolCount} tools`}</Text>
                            </View>
                          ) : null}
                        </View>
                        <Text numberOfLines={2} style={styles.integrationDesc}>
                          {item.description || 'Composio toolkit integration.'}
                        </Text>
                        <Text numberOfLines={1} style={styles.authText}>
                          {item.authSchemes.length > 0 ? item.authSchemes.join(' · ') : 'managed auth'}
                        </Text>
                      </View>

                      <View style={styles.actionColumn}>
                        {isConnecting ? (
                          <Spinner size="sm" color="default" />
                        ) : isConn ? (
                          <View style={styles.activePill}>
                            <Check size={12} color={colors.success} strokeWidth={2.5} />
                            <Text style={styles.activeText}>Active</Text>
                          </View>
                        ) : (
                          <View style={styles.connectPill}>
                            <Text style={styles.connectText}>{actionText}</Text>
                            <ChevronRight size={14} color={colors.textSecondary} strokeWidth={1.75} />
                          </View>
                        )}
                      </View>
                    </Pressable>
                  </React.Fragment>
                );
              })}
            </GroupedCard>
          ) : null}
        </ScrollView>
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
    fontSize: 17,
    lineHeight: 22,
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
  },
  errorBox: {
    backgroundColor: colors.recordingBg,
    borderRadius: radius.card,
    padding: space.md,
  },
  errorText: {
    fontSize: 13,
    color: colors.recording,
    textAlign: 'center',
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
    fontSize: 14,
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
