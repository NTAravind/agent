import { useCallback, useEffect, useRef, useState } from 'react';
import { Alert, Button, Chip, Input, ListGroup, Spinner, Typography } from 'heroui-native';
import { Alert as RNAlert, RefreshControl, ScrollView, View } from 'react-native';
import { useFocusEffect, useRouter } from 'expo-router';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import * as WebBrowser from 'expo-web-browser';

import { AppHeader } from '@/components/app-header';
import {
  connectComposioToolkit,
  fetchComposioCatalog,
  fetchServers,
  verifyConnection,
  type CatalogEntry,
  type ComposioCatalogItem,
} from '@/lib/mcp';

/**
 * Remote MCP marketplace (Phase 6). Two sources side by side:
 *  - "Built-in": the admin-seeded catalog of vendor-hosted MCP listings;
 *  - "Composio": Composio's live toolkit catalog (1,700+ apps). Rows are
 *    browsed from the Composio API and materialize into a real listing on
 *    first connect, after which the normal detail/attach flow applies.
 *
 * Connection states drive the row action: none → Connect, `pending` →
 * Finish connecting (reopens the hosted consent link), `connected` → open
 * the detail page, `expired`/`error` → Reconnect. After a link is opened we
 * poll verify every 2s (max 60s) so the row flips to connected on its own.
 */

const CATEGORIES = ['all', 'search', 'data', 'dev', 'productivity', 'payments', 'observability', 'other'] as const;
const TABS = ['built-in', 'composio'] as const;
type Tab = (typeof TABS)[number];

const AUTH_LABEL: Record<string, string> = {
  none: 'No sign-in',
  api_key: 'API key',
  oauth2: 'Sign in',
  pat: 'Token',
  provider_managed: 'Managed',
};

/** Row action for a connection that isn't (or is no longer) connected. */
const ACTION_LABEL: Record<string, string> = {
  pending: 'Finish connecting ›',
  expired: 'Reconnect ›',
  error: 'Reconnect ›',
};

const STATUS_COLOR: Record<string, 'success' | 'warning' | 'danger'> = {
  connected: 'success',
  pending: 'warning',
  expired: 'danger',
  error: 'danger',
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

  // Polling must not touch state after the screen goes away.
  const aliveRef = useRef(true);
  useEffect(() => {
    aliveRef.current = true;
    return () => {
      aliveRef.current = false;
    };
  }, []);

  /**
   * After the hosted link is opened: re-check every 2s (up to 60s) with
   * `issueLink: false` (side-effect free) until consent lands, then reload
   * so the row shows as connected.
   */
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

  /**
   * Composio row tap:
   *  - connected → open the detail page;
   *  - pending/expired/error → verify to get the hosted link back (a fresh
   *    one when the old consent is dead) and open it;
   *  - never connected → connect (materializes the listing) and open the
   *    link when sign-in is needed.
   */
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
        await WebBrowser.openBrowserAsync(result.authorizationUrl);
        const connectionId = item.connectionId ?? ('connectionId' in result ? result.connectionId : undefined);
        if (connectionId) void pollVerify(connectionId);
      } else {
        // No link needed: either it connected (consent was already ACTIVE)
        // or there is a message to surface after the reload.
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
    <View className="flex-1 bg-background">
      <AppHeader
        left={
          <Button size="md" variant="ghost" onPress={() => router.back()}>
            <Button.Label>Close</Button.Label>
          </Button>
        }
        center={<Typography type="h4">Integrations</Typography>}
      />

      {showSpinner ? (
        <View className="flex-1 items-center justify-center">
          <Spinner />
        </View>
      ) : (
        <ScrollView
          contentContainerStyle={{ padding: 16, paddingBottom: insets.bottom + 24, gap: 12 }}
          keyboardShouldPersistTaps="handled"
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
          <View className="flex-row gap-2">
            {TABS.map((item) => (
              <Chip
                key={item}
                variant={tab === item ? 'primary' : 'soft'}
                size="md"
                onPress={() => switchTab(item)}
              >
                <Chip.Label>{item === 'built-in' ? 'Built-in' : 'Composio'}</Chip.Label>
              </Chip>
            ))}
          </View>

          <Input
            value={query}
            onChangeText={setQuery}
            placeholder={tab === 'built-in' ? 'Search integrations…' : 'Search Composio toolkits…'}
            autoCapitalize="none"
            autoCorrect={false}
            returnKeyType="search"
          />

          <View className="flex-row flex-wrap gap-2">
            {(tab === 'built-in' ? CATEGORIES : ['all', ...composioCategories]).map((item) => (
              <Chip
                key={item}
                variant={category === item ? 'primary' : 'soft'}
                size="sm"
                onPress={() => setCategory(item)}
              >
                <Chip.Label>{item}</Chip.Label>
              </Chip>
            ))}
            <Chip
              variant={showConnected ? 'primary' : 'soft'}
              size="sm"
              color={showConnected ? 'success' : 'default'}
              onPress={() => setShowConnected((current) => !current)}
            >
              <Chip.Label>connected</Chip.Label>
            </Chip>
          </View>

          {tab === 'composio' && !composioConfigured ? (
            <Alert status="warning">
              <Alert.Content>
                <Alert.Title>Composio is not configured</Alert.Title>
                <Alert.Description>
                  Set COMPOSIO_API_KEY on the API server to browse its catalog.
                </Alert.Description>
              </Alert.Content>
            </Alert>
          ) : null}

          {tab === 'composio' && composioConfigured && composioTotal > toolkits.length ? (
            <Typography type="body-xs" color="muted">
              Showing {toolkits.length} of {composioTotal} toolkits — refine your search.
            </Typography>
          ) : null}

          {error ? (
            <Alert status="danger">
              <Alert.Content>
                <Alert.Title>Could not load integrations</Alert.Title>
                <Alert.Description>{error}</Alert.Description>
              </Alert.Content>
            </Alert>
          ) : null}

          {emptyRows.length === 0 && !error ? (
            <View className="mt-16 items-center gap-2">
              <Typography type="body" color="muted">
                No integrations match.
              </Typography>
              <Typography type="body-sm" color="muted" className="text-center">
                {tab === 'built-in'
                  ? 'The catalog is seeded and verified server-side. Try another filter.'
                  : 'Try another search, or clear the filters.'}
              </Typography>
            </View>
          ) : null}

          {tab === 'built-in' && servers.length > 0 ? (
            <ListGroup className="rounded-2xl">
              {servers.map((server) => {
                const suffix = server.connected
                  ? '›'
                  : (ACTION_LABEL[server.connectionStatus ?? ''] ?? '›');
                return (
                  <ListGroup.Item
                    key={server.id}
                    onPress={() => router.push(`/mcp/${server.id}`)}
                  >
                    <ListGroup.ItemContent>
                      <View className="flex-row items-center gap-2">
                        <ListGroup.ItemTitle>{server.name}</ListGroup.ItemTitle>
                        {server.connected ? (
                          <Chip variant="soft" size="sm" color="success">
                            <Chip.Label>connected</Chip.Label>
                          </Chip>
                        ) : server.connectionStatus ? (
                          <Chip
                            variant="soft"
                            size="sm"
                            color={STATUS_COLOR[server.connectionStatus] ?? 'default'}
                          >
                            <Chip.Label>{server.connectionStatus}</Chip.Label>
                          </Chip>
                        ) : null}
                        {server.isVerified ? (
                          <Chip variant="soft" size="sm" color="accent">
                            <Chip.Label>verified</Chip.Label>
                          </Chip>
                        ) : null}
                      </View>
                      <ListGroup.ItemDescription numberOfLines={2}>
                        {server.description || 'Vendor-hosted remote MCP server.'}
                      </ListGroup.ItemDescription>
                      <View className="mt-1 flex-row gap-2">
                        <Typography type="body-xs" color="muted">
                          {AUTH_LABEL[server.authType] ?? server.authType}
                        </Typography>
                        {server.isFreeTier ? (
                          <Typography type="body-xs" color="muted">
                            · free tier
                          </Typography>
                        ) : null}
                      </View>
                    </ListGroup.ItemContent>
                    <ListGroup.ItemSuffix>
                      <Typography
                        type="body-sm"
                        color={server.connected ? 'muted' : 'default'}
                      >
                        {suffix}
                      </Typography>
                    </ListGroup.ItemSuffix>
                  </ListGroup.Item>
                );
              })}
            </ListGroup>
          ) : null}

          {tab === 'composio' && toolkits.length > 0 ? (
            <ListGroup className="rounded-2xl">
              {toolkits.map((item) => {
                const isConnecting = connecting === item.toolkit;
                const suffix = item.connected
                  ? '›'
                  : (ACTION_LABEL[item.connectionStatus ?? ''] ?? 'Connect ›');
                return (
                  <ListGroup.Item
                    key={item.toolkit}
                    disabled={isConnecting}
                    onPress={() => void onPressToolkit(item)}
                  >
                    <ListGroup.ItemContent>
                      <View className="flex-row items-center gap-2">
                        <ListGroup.ItemTitle>{item.name}</ListGroup.ItemTitle>
                        {item.connected ? (
                          <Chip variant="soft" size="sm" color="success">
                            <Chip.Label>connected</Chip.Label>
                          </Chip>
                        ) : item.connectionStatus ? (
                          <Chip
                            variant="soft"
                            size="sm"
                            color={STATUS_COLOR[item.connectionStatus] ?? 'default'}
                          >
                            <Chip.Label>{item.connectionStatus}</Chip.Label>
                          </Chip>
                        ) : null}
                        {item.toolCount > 0 ? (
                          <Chip variant="soft" size="sm">
                            <Chip.Label>{item.toolCount} tools</Chip.Label>
                          </Chip>
                        ) : null}
                      </View>
                      <ListGroup.ItemDescription numberOfLines={2}>
                        {item.description || 'Composio-managed toolkit.'}
                      </ListGroup.ItemDescription>
                      <Typography type="body-xs" color="muted" className="mt-1">
                        {item.authSchemes.length > 0 ? item.authSchemes.join(' · ') : 'managed auth'}
                      </Typography>
                    </ListGroup.ItemContent>
                    <ListGroup.ItemSuffix>
                      {isConnecting ? (
                        <Spinner size="sm" />
                      ) : (
                        <Typography type="body-sm" color={item.connected ? 'muted' : 'default'}>
                          {suffix}
                        </Typography>
                      )}
                    </ListGroup.ItemSuffix>
                  </ListGroup.Item>
                );
              })}
            </ListGroup>
          ) : null}
        </ScrollView>
      )}
    </View>
  );
}
