import { useCallback, useState } from 'react';
import { Alert, Button, Card, Chip, Input, ListGroup, Spinner, Switch, Typography } from 'heroui-native';
import { RefreshControl, ScrollView, View } from 'react-native';
import { useFocusEffect, useLocalSearchParams, useRouter } from 'expo-router';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import * as WebBrowser from 'expo-web-browser';

import { AppHeader } from '@/components/app-header';
import { fetchAgents, type Agent } from '@/lib/agents';
import {
  attachServer,
  connectServer,
  detachServer,
  disconnectServer,
  fetchAgentAttachments,
  fetchServer,
  refreshConnection,
  updateToolPermissions,
  type AgentAttachment,
  type ServerDetail,
} from '@/lib/mcp';

/**
 * Integration detail (Phase 6): connect (1 tap for no-auth, API key form, or
 * OAuth browser flow), attach to an agent, and tune per-tool permissions.
 * Credentials are typed here but never stored on the device.
 */

type AttachmentTool = AgentAttachment['tools'][number];
type CachedTool = ServerDetail['tools'][number];
type Notice = { kind: 'success' | 'danger'; text: string };

const RISK_COLOR: Record<string, 'success' | 'warning' | 'danger'> = {
  low: 'success',
  medium: 'warning',
  high: 'danger',
};

function RiskChip({ level }: { level: string }) {
  return (
    <Chip variant="soft" size="sm" color={RISK_COLOR[level] ?? 'default'}>
      <Chip.Label>{level}</Chip.Label>
    </Chip>
  );
}

export default function IntegrationDetailScreen() {
  const router = useRouter();
  const insets = useSafeAreaInsets();
  const { id } = useLocalSearchParams<{ id: string }>();
  const oauthParams = useLocalSearchParams<{ status?: string; message?: string }>();

  const [detail, setDetail] = useState<ServerDetail | null>(null);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<Notice | null>(null);
  const [apiKey, setApiKey] = useState('');
  const [busy, setBusy] = useState<
    'connect' | 'refresh' | 'disconnect' | 'attach' | 'detach' | null
  >(null);
  const [oauthPending, setOauthPending] = useState(false);

  const [agents, setAgents] = useState<Agent[]>([]);
  const [selectedAgentId, setSelectedAgentId] = useState<string | null>(null);
  const [attachments, setAttachments] = useState<AgentAttachment[]>([]);

  const serverId = typeof id === 'string' ? id : '';
  const server = detail?.server ?? null;
  const connectionId = detail?.connection?.id ?? null;
  const connected = detail?.connection?.status === 'connected';
  const authType = server?.authType ?? 'none';
  const needsKey = authType === 'api_key' || authType === 'pat';
  const isOAuth = authType === 'oauth2';

  // OAuth result deep-linked back from /api/mcp/oauth/callback — derived from
  // the route params (no effect needed; manual notices set below take over as
  // soon as the user acts).
  const oauthNotice: Notice | null =
    oauthParams.status === 'connected'
      ? {
          kind: 'success',
          text: 'Signed in. Tools discovered — add this integration to an agent below.',
        }
      : oauthParams.status === 'error'
        ? { kind: 'danger', text: oauthParams.message ?? 'Connection failed.' }
        : null;

  const selectedAgent = agents.find((agent) => agent.id === selectedAgentId) ?? null;
  const attachment =
    (connectionId ? attachments.find((row) => row.connection?.id === connectionId) : null) ?? null;
  const attached = attachment !== null;

  const load = useCallback(async () => {
    try {
      const [nextDetail, agentList] = await Promise.all([
        fetchServer(serverId),
        // Agent picker is auxiliary — never block the detail view on it.
        fetchAgents().catch(() => [] as Agent[]),
      ]);
      setDetail(nextDetail);
      if (agentList.length > 0) {
        setAgents(agentList);
        setSelectedAgentId((previous) => previous ?? agentList[0].id);
      }
      const target = selectedAgentId ?? agentList[0]?.id ?? null;
      if (target) {
        setAttachments(await fetchAgentAttachments(target));
      }
      setError(null);
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setLoading(false);
      setRefreshing(false);
    }
  }, [serverId, selectedAgentId]);

  useFocusEffect(
    useCallback(() => {
      void load();
    }, [load]),
  );

  const shownNotice = notice ?? oauthNotice;

  const handleConnect = async () => {
    setBusy('connect');
    setError(null);
    try {
      const result = await connectServer(serverId, needsKey ? { apiKey: apiKey.trim() } : {});
      if (result.authorizationUrl) {
        setOauthPending(true);
        try {
          await WebBrowser.openBrowserAsync(result.authorizationUrl);
        } finally {
          setOauthPending(false);
        }
        setNotice({
          kind: 'success',
          text: 'Finish signing in in your browser, then return to the app — it updates automatically.',
        });
        await load();
        return;
      }
      setApiKey('');
      await load();
      setNotice({
        kind: 'success',
        text: `Connected — ${result.toolCount ?? 0} tools discovered.`,
      });
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setBusy(null);
    }
  };

  const handleRefresh = async () => {
    if (!connectionId) return;
    setBusy('refresh');
    setError(null);
    try {
      const result = await refreshConnection(connectionId);
      await load();
      setNotice({
        kind: 'success',
        text: `Refreshed — ${result.toolCount} tools (${result.changed} changed).`,
      });
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setBusy(null);
    }
  };

  const handleDisconnect = async () => {
    if (!connectionId) return;
    setBusy('disconnect');
    setError(null);
    try {
      await disconnectServer(connectionId);
      setApiKey('');
      setNotice({ kind: 'success', text: 'Disconnected. Its tools are no longer available to any agent.' });
      await load();
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setBusy(null);
    }
  };

  const handleAttach = async () => {
    if (!selectedAgentId || !connectionId) return;
    setBusy('attach');
    setError(null);
    try {
      await attachServer(selectedAgentId, connectionId);
      await load();
      setNotice({ kind: 'success', text: 'Added to agent. Its next run can use these tools.' });
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setBusy(null);
    }
  };

  const handleDetach = async () => {
    if (!selectedAgentId || !connectionId) return;
    setBusy('detach');
    setError(null);
    try {
      await detachServer(selectedAgentId, connectionId);
      await load();
      setNotice({ kind: 'success', text: 'Removed from agent.' });
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setBusy(null);
    }
  };

  const handleToggleTool = async (
    tool: AttachmentTool,
    patch: { enabled?: boolean; approvalRequired?: boolean },
  ) => {
    if (!selectedAgentId) return;
    const previous = attachments;
    // Optimistic: move the switch immediately, roll back via reload on failure.
    setAttachments((rows) =>
      rows.map((row) =>
        row.connection?.id === connectionId
          ? {
              ...row,
              tools: row.tools.map((item) =>
                item.id === tool.id ? { ...item, ...patch } : item,
              ),
            }
          : row,
      ),
    );
    try {
      await updateToolPermissions(selectedAgentId, [
        {
          mcpToolId: tool.id,
          enabled: patch.enabled ?? tool.enabled,
          approvalRequired: patch.approvalRequired ?? tool.approvalRequired,
        },
      ]);
    } catch (err) {
      setAttachments(previous);
      setError(err instanceof Error ? err.message : String(err));
    }
  };

  const tools: (CachedTool | AttachmentTool)[] = attached
    ? (attachment?.tools ?? [])
    : (detail?.tools ?? []);

  return (
    <View className="flex-1 bg-background">
      <AppHeader
        left={
          <Button size="md" variant="ghost" onPress={() => router.back()}>
            <Button.Label>Close</Button.Label>
          </Button>
        }
        center={<Typography type="h4">{server?.name ?? 'Integration'}</Typography>}
      />

      {loading && !detail ? (
        <View className="flex-1 items-center justify-center">
          <Spinner />
        </View>
      ) : (
        <ScrollView
          contentContainerStyle={{
            padding: 16,
            paddingBottom: insets.bottom + 24,
            gap: 12,
          }}
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
          {shownNotice ? (
            <Alert status={shownNotice.kind}>
              <Alert.Content>
                <Alert.Title>
                  {shownNotice.kind === 'success' ? 'Done' : 'Something went wrong'}
                </Alert.Title>
                <Alert.Description>{shownNotice.text}</Alert.Description>
              </Alert.Content>
            </Alert>
          ) : null}

          {error ? (
            <Alert status="danger">
              <Alert.Content>
                <Alert.Title>Could not complete that</Alert.Title>
                <Alert.Description>{error}</Alert.Description>
              </Alert.Content>
            </Alert>
          ) : null}

          <Card className="rounded-2xl">
            <Card.Body className="gap-2">
              <View className="flex-row flex-wrap items-center gap-2">
                <Typography type="h4">{server?.name}</Typography>
                <Chip variant="soft" size="sm">
                  <Chip.Label>{server?.category ?? 'other'}</Chip.Label>
                </Chip>
                <Chip variant="soft" size="sm" color={connected ? 'success' : 'default'}>
                  <Chip.Label>{connected ? 'connected' : 'not connected'}</Chip.Label>
                </Chip>
                {server?.isVerified ? (
                  <Chip variant="soft" size="sm" color="accent">
                    <Chip.Label>verified</Chip.Label>
                  </Chip>
                ) : null}
              </View>
              <Typography type="body-sm" color="muted">
                {server?.description || 'Vendor-hosted remote MCP server.'}
              </Typography>
              {server?.endpoint ? (
                <Typography type="body-xs" color="muted" numberOfLines={1}>
                  {server.endpoint}
                </Typography>
              ) : null}
              {connected && detail ? (
                <Typography type="body-sm">
                  {`${detail.tools.length} tools cached${
                    detail.connection?.lastCheckedAt
                      ? ` · checked ${new Date(detail.connection.lastCheckedAt).toLocaleString()}`
                      : ''
                  }`}
                </Typography>
              ) : null}
            </Card.Body>
          </Card>

          {server?.instructions ? (
            <Card className="rounded-2xl">
              <Card.Body className="gap-2">
                <Card.Title>Setup instructions</Card.Title>
                <Typography type="body-sm" color="muted">
                  {server.instructions}
                </Typography>
              </Card.Body>
            </Card>
          ) : null}

          {!connected && server ? (
            <Card className="rounded-2xl">
              <Card.Body className="gap-3">
                <Card.Title>
                  {isOAuth ? `Sign in with ${server.name}` : needsKey ? 'Add your API key' : 'Connect'}
                </Card.Title>
                {needsKey ? (
                  <Input
                    value={apiKey}
                    onChangeText={setApiKey}
                    placeholder="API key"
                    autoCapitalize="none"
                    autoCorrect={false}
                    secureTextEntry
                  />
                ) : null}
                {oauthPending ? (
                  <Typography type="body-sm" color="muted">
                    Waiting for the browser… return to the app when you are done.
                  </Typography>
                ) : null}
                <Button
                  onPress={() => void handleConnect()}
                  isDisabled={
                    busy === 'connect' || (needsKey && !apiKey.trim()) || oauthPending
                  }
                >
                  {busy === 'connect' ? (
                    <Spinner size="sm" />
                  ) : (
                    <Button.Label>{isOAuth ? 'Sign in' : 'Connect'}</Button.Label>
                  )}
                </Button>
                <Typography type="body-xs" color="muted" className="text-center">
                  Credentials are encrypted on the server and never sent back to this device.
                </Typography>
              </Card.Body>
            </Card>
          ) : null}

          {connected && server ? (
            <Card className="rounded-2xl">
              <Card.Body className="gap-3">
                <Card.Title>Use with an agent</Card.Title>
                {agents.length > 1 ? (
                  <View className="flex-row flex-wrap gap-2">
                    {agents.map((agent) => (
                      <Chip
                        key={agent.id}
                        variant={selectedAgentId === agent.id ? 'primary' : 'soft'}
                        size="sm"
                        onPress={() => setSelectedAgentId(agent.id)}
                      >
                        <Chip.Label>{agent.name}</Chip.Label>
                      </Chip>
                    ))}
                  </View>
                ) : null}
                {attached ? (
                  <View className="flex-row flex-wrap gap-2">
                    <Button
                      size="md"
                      variant="secondary"
                      onPress={() => void handleDetach()}
                      isDisabled={busy === 'detach'}
                    >
                      <Button.Label>Remove from {selectedAgent?.name ?? 'agent'}</Button.Label>
                    </Button>
                    <Button
                      size="md"
                      variant="ghost"
                      onPress={() => void handleRefresh()}
                      isDisabled={busy === 'refresh'}
                    >
                      <Button.Label>
                        {busy === 'refresh' ? 'Refreshing…' : 'Refresh tools'}
                      </Button.Label>
                    </Button>
                  </View>
                ) : (
                  <Button
                    onPress={() => void handleAttach()}
                    isDisabled={
                      busy === 'attach' || !selectedAgentId || !connectionId
                    }
                  >
                    {busy === 'attach' ? (
                      <Spinner size="sm" />
                    ) : (
                      <Button.Label>Add to {selectedAgent?.name ?? 'agent'}</Button.Label>
                    )}
                  </Button>
                )}
              </Card.Body>
            </Card>
          ) : null}

          {tools.length > 0 ? (
            <View className="gap-2">
              <Typography type="body-sm" color="muted">
                {attached
                  ? 'Tools this agent can use. High-risk tools always require your approval.'
                  : 'Tools this integration offers:'}
              </Typography>
              {tools.map((tool) =>
                attached ? (
                  <Card key={tool.id} className="rounded-2xl">
                    <Card.Body className="gap-2">
                      <View className="flex-row flex-wrap items-center gap-2">
                        <Typography type="body" weight="medium">
                          {'name' in tool && tool.name ? tool.name : tool.externalToolId}
                        </Typography>
                        <RiskChip level={'riskLevel' in tool ? tool.riskLevel : 'medium'} />
                      </View>
                      <Typography type="body-sm" color="muted" numberOfLines={2}>
                        {tool.description || 'No description provided.'}
                      </Typography>
                      <View className="flex-row items-center justify-between">
                        <Typography type="body-sm">Enabled</Typography>
                        <Switch
                          isSelected={'enabled' in tool ? tool.enabled : true}
                          onSelectedChange={(value) =>
                            void handleToggleTool(tool as AttachmentTool, { enabled: value })
                          }
                          accessibilityLabel="Enable this tool"
                        />
                      </View>
                      <View className="flex-row items-center justify-between">
                        <Typography type="body-sm">Require approval</Typography>
                        <Switch
                          isSelected={
                            'approvalRequired' in tool ? tool.approvalRequired : false
                          }
                          isDisabled={'riskLevel' in tool && tool.riskLevel === 'high'}
                          onSelectedChange={(value) =>
                            void handleToggleTool(tool as AttachmentTool, {
                              approvalRequired: value,
                            })
                          }
                          accessibilityLabel="Require your approval before this tool runs"
                        />
                      </View>
                    </Card.Body>
                  </Card>
                ) : (
                  <ListGroup key={tool.id} className="rounded-2xl">
                    <ListGroup.Item>
                      <ListGroup.ItemContent>
                        <View className="flex-row flex-wrap items-center gap-2">
                          <ListGroup.ItemTitle>{tool.externalToolId}</ListGroup.ItemTitle>
                          <RiskChip level={'riskLevel' in tool ? tool.riskLevel : 'medium'} />
                        </View>
                        <ListGroup.ItemDescription numberOfLines={2}>
                          {tool.description || 'No description provided.'}
                        </ListGroup.ItemDescription>
                      </ListGroup.ItemContent>
                    </ListGroup.Item>
                  </ListGroup>
                ),
              )}
            </View>
          ) : null}

          {connected ? (
            <Button
              size="md"
              variant="ghost"
              onPress={() => void handleDisconnect()}
              isDisabled={busy === 'disconnect'}
            >
              <Button.Label>
                {busy === 'disconnect' ? 'Disconnecting…' : 'Disconnect'}
              </Button.Label>
            </Button>
          ) : null}
        </ScrollView>
      )}
    </View>
  );
}
