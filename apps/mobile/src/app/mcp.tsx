import { useCallback, useState } from 'react';
import { Alert, Button, Chip, Input, ListGroup, Spinner, Typography } from 'heroui-native';
import { RefreshControl, ScrollView, View } from 'react-native';
import { useFocusEffect, useRouter } from 'expo-router';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import { AppHeader } from '@/components/app-header';
import { fetchServers, type CatalogEntry } from '@/lib/mcp';

/**
 * Remote MCP marketplace (Phase 6). Browse the admin-seeded catalog of
 * vendor-hosted MCP endpoints, filter it, and tap through to connect.
 */

const CATEGORIES = ['all', 'search', 'data', 'dev', 'productivity', 'payments', 'observability', 'other'] as const;

const AUTH_LABEL: Record<string, string> = {
  none: 'No sign-in',
  api_key: 'API key',
  oauth2: 'Sign in',
  pat: 'Token',
  provider_managed: 'Managed',
};

export default function MarketplaceScreen() {
  const router = useRouter();
  const insets = useSafeAreaInsets();

  const [servers, setServers] = useState<CatalogEntry[]>([]);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [query, setQuery] = useState('');
  const [category, setCategory] = useState<(typeof CATEGORIES)[number]>('all');
  const [showConnected, setShowConnected] = useState(false);

  const load = useCallback(async () => {
    try {
      const entries = await fetchServers({
        q: query.trim() || undefined,
        category: category === 'all' ? undefined : category,
        connected: showConnected || undefined,
      });
      setServers(entries);
      setError(null);
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setLoading(false);
      setRefreshing(false);
    }
  }, [query, category, showConnected]);

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
        center={<Typography type="h4">Integrations</Typography>}
      />

      {loading ? (
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
          <Input
            value={query}
            onChangeText={setQuery}
            placeholder="Search integrations…"
            autoCapitalize="none"
            autoCorrect={false}
            returnKeyType="search"
          />

          <View className="flex-row flex-wrap gap-2">
            {CATEGORIES.map((item) => (
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

          {error ? (
            <Alert status="danger">
              <Alert.Content>
                <Alert.Title>Could not load integrations</Alert.Title>
                <Alert.Description>{error}</Alert.Description>
              </Alert.Content>
            </Alert>
          ) : null}

          {servers.length === 0 && !error ? (
            <View className="mt-16 items-center gap-2">
              <Typography type="body" color="muted">
                No integrations match.
              </Typography>
              <Typography type="body-sm" color="muted" className="text-center">
                The catalog is seeded and verified server-side. Try another filter.
              </Typography>
            </View>
          ) : null}

          {servers.length > 0 ? (
            <ListGroup className="rounded-2xl">
              {servers.map((server) => (
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
                    <Typography type="body-sm" color="muted">
                      ›
                    </Typography>
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
