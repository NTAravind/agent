import { useCallback, useEffect, useRef, useState } from 'react';
import { Spinner, Switch } from 'heroui-native';
import {
  FlatList,
  Linking,
  Pressable,
  RefreshControl,
  StyleSheet,
  Text,
  TextInput,
  View,
} from 'react-native';
import { useFocusEffect, useLocalSearchParams, useRouter } from 'expo-router';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import {
  AlertCircle,
  Blocks,
  Check,
  CheckCircle2,
  ChevronLeft,
  Clock,
  ExternalLink,
  Info,
  KeyRound,
  RotateCw,
  ShieldAlert,
  ShieldCheck,
  UserCheck,
  Wrench,
} from 'lucide-react-native';
import { SymbolIcon } from '@/components/symbol-icon';

import { AppHeader, useHeaderInset } from '@/components/app-header';
import { AgentAvatar } from '@/components/agent-avatar';
import { GroupedCard, HairlineDivider, InlineError, PillButton, RoundButton, SectionLabel } from '@/components/design-system';
import { reportAppError } from '@/components/error-dialog-provider';
import { colors, radius, shadow, space } from '@/theme';
import { fetchAgents, type Agent } from '@/lib/agents';
import {
  attachServer,
  connectServer,
  detachServer,
  disconnectServer,
  fetchAgentAttachments,
  fetchServer,
  openMarketplaceAuthorization,
  refreshConnection,
  updateToolPermissions,
  verifyConnection,
  type AgentAttachment,
  type ServerDetail,
} from '@/lib/mcp';

type AttachmentTool = AgentAttachment['tools'][number];

/**
 * One row of the virtualized tool list: a section label, then the tools
 * themselves. Each tool cell carries first/last flags so it renders only its
 * slice of the grouped card.
 */
type ToolCell =
  | { key: string; type: 'label' }
  | {
      key: string;
      type: 'tool';
      tool: CachedTool | AttachmentTool;
      first: boolean;
      last: boolean;
    };
type CachedTool = ServerDetail['tools'][number];
type Notice = { kind: 'success' | 'warning' | 'danger'; text: string };

const POLL_INTERVAL_MS = 2_000;
const POLL_ATTEMPTS = 30;

function RiskBadge({ level }: { level: string }) {
  const isHigh = level === 'high';

  return (
    <View style={styles.riskBadge}>
      {isHigh && <SymbolIcon icon={ShieldAlert} size={12} color={colors.danger} />}
      <Text style={[styles.riskText, isHigh && { color: colors.danger }]}>
        {`${level} risk`}
      </Text>
    </View>
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
  const status = detail?.connection?.status ?? null;
  const connected = status === 'connected';
  const authType = server?.authType ?? 'none';
  const needsKey = authType === 'api_key' || authType === 'pat';
  const isOAuth = authType === 'oauth2';
  const isManaged = authType === 'provider_managed';
  const connectLabel = isOAuth
    ? 'Sign in with Provider'
    : status === 'pending'
      ? 'Finish connecting'
      : status === 'expired' || status === 'error'
        ? 'Reconnect'
        : 'Connect';

  const selectedAgent = agents.find((agent) => agent.id === selectedAgentId) ?? null;
  const attachment =
    (connectionId ? attachments.find((row) => row.connection?.id === connectionId) : null) ?? null;
  const attached = attachment !== null;

  const load = useCallback(async () => {
    if (!serverId) return;
    try {
      const [serverResult, agentList] = await Promise.all([
        fetchServer(serverId),
        fetchAgents().catch(() => []),
      ]);
      setDetail(serverResult);
      setAgents(agentList);

      const activeAgentId = selectedAgentId || (agentList.length > 0 ? agentList[0]!.id : null);
      if (activeAgentId) {
        const attachmentList = await fetchAgentAttachments(activeAgentId).catch(() => []);
        setAttachments(attachmentList);
      }

      if (!selectedAgentId && agentList.length > 0) {
        setSelectedAgentId(agentList[0]!.id);
      }
      setError(null);
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setLoading(false);
      setRefreshing(false);
    }
  }, [serverId, selectedAgentId]);

  useEffect(() => {
    if (selectedAgentId) {
      void fetchAgentAttachments(selectedAgentId)
        .then((list) => setAttachments(list))
        .catch(() => []);
    }
  }, [selectedAgentId]);

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
    async (cid: string) => {
      for (let attempt = 0; attempt < POLL_ATTEMPTS; attempt += 1) {
        await new Promise((resolve) => setTimeout(resolve, POLL_INTERVAL_MS));
        if (!aliveRef.current) return;
        try {
          const result = await verifyConnection(cid, { issueLink: false });
          if (!aliveRef.current) return;
          if (result.status !== 'pending') {
            await load();
            return;
          }
        } catch {
          // Retry
        }
      }
      if (aliveRef.current) await load();
    },
    [load],
  );

  useEffect(() => {
    if (!oauthParams.status) return;
    let cancelled = false;
    void (async () => {
      const loaded = await fetchServer(serverId).catch(() => null);
      if (cancelled) return;
      if (oauthParams.status === 'error') {
        reportAppError(new Error(oauthParams.message ?? 'Connection failed.'), { title: 'Could not connect integration' });
        return;
      }
      const cid = loaded?.connection?.id;
      if (loaded?.connection?.status === 'connected') {
        setNotice({
          kind: 'success',
          text: 'Signed in. Tools discovered — add this integration to an agent below.',
        });
        return;
      }
      if (cid) {
        setNotice({ kind: 'warning', text: 'Sign-in received. Verifying the connection…' });
        await pollVerify(cid);
      } else {
        setNotice({ kind: 'danger', text: 'Sign-in returned, but no connection was found. Try again.' });
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [serverId, oauthParams.status, oauthParams.message, load, pollVerify]);

  const handleConnect = async () => {
    setBusy('connect');
    setError(null);
    setNotice(null);
    try {
      if (isOAuth || (isManaged && (status === 'pending' || status === 'expired' || status === 'error'))) {
        const result = isManaged && connectionId
          ? await verifyConnection(connectionId, { issueLink: true })
          : await connectServer(serverId);

        if (result.authorizationUrl) {
          setOauthPending(true);
          await openMarketplaceAuthorization(result.authorizationUrl, serverId);
          const cid = ('connectionId' in result ? result.connectionId : undefined) ?? connectionId;
          if (cid) void pollVerify(cid);
        } else {
          await load();
        }
        return;
      }

      await connectServer(serverId, needsKey ? { apiKey: apiKey.trim() } : undefined);
      setApiKey('');
      await load();
      setNotice({ kind: 'success', text: 'Connected. Tools discovered below.' });
    } catch (err) {
      reportAppError(err, { title: 'Could not connect' });
    } finally {
      setBusy(null);
      setOauthPending(false);
    }
  };

  const handleRefresh = async () => {
    if (!connectionId) return;
    setBusy('refresh');
    setError(null);
    try {
      await refreshConnection(connectionId);
      await load();
      setNotice({ kind: 'success', text: 'Tools refreshed.' });
    } catch (err) {
      reportAppError(err, { title: 'Could not refresh integration' });
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
      await load();
      setNotice({ kind: 'success', text: 'Disconnected.' });
    } catch (err) {
      reportAppError(err, { title: 'Could not disconnect integration' });
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
      setNotice({ kind: 'success', text: `Attached to ${selectedAgent?.name ?? 'agent'}.` });
    } catch (err) {
      reportAppError(err, { title: 'Could not attach integration' });
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
      setNotice({ kind: 'success', text: `Removed from ${selectedAgent?.name ?? 'agent'}.` });
    } catch (err) {
      reportAppError(err, { title: 'Could not remove integration' });
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
      reportAppError(err, { title: 'Could not update tool settings' });
    }
  };

  const tools: (CachedTool | AttachmentTool)[] = attached
    ? (attachment?.tools ?? [])
    : (detail?.tools ?? []);

  // Flat list of tool rows: a section label cell, then one cell per tool.
  const toolCells: ToolCell[] =
    tools.length === 0
      ? []
      : [
          { key: 'tools-label', type: 'label' },
          ...tools.map((tool, index) => ({
            key: tool.id,
            type: 'tool' as const,
            tool,
            first: index === 0,
            last: index === tools.length - 1,
          })),
        ];

  const handleBack = useCallback(() => {
    if (router.canGoBack()) {
      router.back();
    } else {
      router.replace('/mcp');
    }
  }, [router]);


  const headerInset = useHeaderInset();

  return (
    <View style={styles.screen}>
      <AppHeader
        left={
          <RoundButton
            icon={ChevronLeft}
            onPress={handleBack}
            accessibilityLabel="Close"
          />
        }
        center={
          <Text numberOfLines={1} style={styles.headerTitle}>
            {server?.name ?? 'Integration'}
          </Text>
        }
        right={
          connected ? (
            <RoundButton
              icon={RotateCw}
              onPress={() => void handleRefresh()}
              accessibilityLabel="Refresh tools"
            />
          ) : (
            <View style={{ width: 44, height: 44 }} />
          )
        }
      />

      {loading && !detail ? (
        <View style={styles.center}>
          <Spinner size="lg" color="default" />
        </View>
      ) : (
        <FlatList
          data={toolCells}
          keyExtractor={(cell) => cell.key}
          renderItem={({ item: cell }) => {
            if (cell.type === 'label') {
              return (
                <View style={styles.toolsLabelCell}>
                  <SectionLabel text={`Tools (${tools.length})`} />
                </View>
              );
            }

            const { tool } = cell;
            return (
              <View
                style={[
                  styles.cardSlice,
                  cell.first && styles.cardSliceTop,
                  cell.last && styles.cardSliceBottom,
                ]}
              >
                {!cell.first ? <HairlineDivider inset={56} /> : null}
                <View style={styles.toolRow}>
                  <View style={styles.toolHeader}>
                    <View style={{ flexDirection: 'row', alignItems: 'center', gap: space.xs, flex: 1 }}>
                      <View style={styles.toolIconBox}>
                        <SymbolIcon icon={Wrench} size={14} color={colors.textPrimary} strokeWidth={1.75} />
                      </View>
                      <Text numberOfLines={1} style={styles.toolName}>
                        {'name' in tool && tool.name ? tool.name : tool.externalToolId}
                      </Text>
                    </View>
                    <RiskBadge level={'riskLevel' in tool ? tool.riskLevel : 'medium'} />
                  </View>

                  <Text style={styles.toolDescription}>
                    {tool.description || 'No description provided.'}
                  </Text>

                  {attached ? (
                    <View style={styles.toolSwitches}>
                      <View style={styles.switchRow}>
                        <Text style={styles.switchLabel}>Enabled</Text>
                        <Switch
                          isSelected={'enabled' in tool ? tool.enabled : true}
                          onSelectedChange={(value) =>
                            void handleToggleTool(tool as AttachmentTool, { enabled: value })
                          }
                          accessibilityLabel="Enable this tool"
                        />
                      </View>
                      <View style={styles.switchRow}>
                        <View>
                          <Text style={styles.switchLabel}>Require user approval</Text>
                          {'riskLevel' in tool && tool.riskLevel === 'high' ? (
                            <Text style={styles.mandatoryText}>
                              Mandatory for high-risk tools
                            </Text>
                          ) : null}
                        </View>
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
                    </View>
                  ) : null}
                </View>
              </View>
            );
          }}
          ListHeaderComponent={
            <View style={styles.listHeader}>
              {/* Notifications */}
              {notice ? (
                <View
                  style={[
                    styles.noticeBox,
                    notice.kind === 'danger' && styles.noticeBoxDanger,
                  ]}
                >
                  <View style={styles.noticeHeader}>
                    {notice.kind === 'success' ? (
                      <SymbolIcon icon={CheckCircle2} size={16} color={colors.success} />
                    ) : notice.kind === 'warning' ? (
                      <SymbolIcon icon={Clock} size={16} color={colors.textSecondary} />
                    ) : (
                      <SymbolIcon icon={AlertCircle} size={16} color={colors.danger} />
                    )}
                    <Text
                      style={[
                        styles.noticeTitle,
                        notice.kind === 'danger' && { color: colors.danger },
                      ]}
                    >
                      {notice.kind === 'success'
                        ? 'Done'
                        : notice.kind === 'warning'
                          ? 'Notice'
                          : 'Error'}
                    </Text>
                  </View>
                  <Text style={styles.noticeText}>{notice.text}</Text>
                </View>
              ) : null}

              {error ? <InlineError message={error} onRetry={() => void load()} /> : null}

              {/* Hero Overview Card (Section 6.8 & reference screen) */}
              <View style={styles.heroCard}>
                <View style={styles.heroHeader}>
                  <View style={styles.appIconBox}>
                    <SymbolIcon icon={Blocks} size={28} color={colors.textPrimary} strokeWidth={1.75} />
                  </View>
                  <View style={{ flex: 1, minWidth: 0 }}>
                    <Text style={styles.appName}>
                      {server?.name ?? 'Google Calendar'}
                    </Text>
                    <Text numberOfLines={1} style={styles.appEndpoint}>
                      {server?.endpoint ? server.endpoint.replace(/^https?:\/\//i, '').split('/')[0] : 'service.api'}
                    </Text>
                  </View>
                </View>

                <Text style={styles.appDescription}>
                  {server?.description ||
                    'Connect to vendor-hosted remote MCP server to discover tools and enable autonomous capabilities.'}
                </Text>

                {/* Includes card */}
                <View style={{ gap: space.xs }}>
                  <Text style={styles.includesLabel}>Includes</Text>
                  <View style={styles.includesRow}>
                    <Text style={styles.includesCount}>
                      {`${detail?.tools.length ?? 1} connector`}
                    </Text>
                    {server?.endpoint ? (
                      <Pressable
                        onPress={() => {
                          if (server?.endpoint) void Linking.openURL(server.endpoint);
                        }}
                        accessibilityRole="button"
                        accessibilityLabel="View source link"
                      >
                        <Text style={styles.viewSourceText}>View source ↗</Text>
                      </Pressable>
                    ) : null}
                  </View>
                </View>

                {/* Action Button: Added or Add connector */}
                <View style={{ marginTop: space.xs }}>
                  {connected ? (
                    <View style={styles.addedPill}>
                      <SymbolIcon icon={Check} size={18} color={colors.success} strokeWidth={2.5} />
                      <Text style={styles.addedText}>Added</Text>
                    </View>
                  ) : (
                    <PillButton
                      label={busy === 'connect' ? 'Connecting…' : 'Add connector'}
                      onPress={() => void handleConnect()}
                      disabled={busy === 'connect'}
                      variant="primary"
                    />
                  )}
                </View>
              </View>

              {/* Setup instructions */}
              {server?.instructions ? (
                <View style={styles.card}>
                  <View style={styles.cardHeader}>
                    <SymbolIcon icon={Info} size={16} color={colors.textSecondary} strokeWidth={1.75} />
                    <Text style={styles.cardTitle}>Setup instructions</Text>
                  </View>
                  <Text style={styles.cardText}>{server.instructions}</Text>
                </View>
              ) : null}

              {/* Connect / Authenticate Card */}
              {!connected && server && needsKey ? (
                <View style={styles.card}>
                  <View style={styles.cardHeader}>
                    <SymbolIcon icon={KeyRound} size={18} color={colors.textPrimary} strokeWidth={1.75} />
                    <Text style={styles.cardTitle}>API key required</Text>
                  </View>
                  <TextInput
                    value={apiKey}
                    onChangeText={setApiKey}
                    placeholder="Enter API key or token"
                    placeholderTextColor={colors.textSecondary}
                    autoCapitalize="none"
                    autoCorrect={false}
                    secureTextEntry
                    style={styles.keyInput}
                  />
                  <PillButton
                    label={busy === 'connect' ? 'Connecting…' : connectLabel}
                    onPress={() => void handleConnect()}
                    disabled={busy === 'connect' || !apiKey.trim()}
                    variant="primary"
                    style={{ marginTop: space.xs }}
                  />
                  <Text style={styles.securityText}>
                    Credentials are encrypted and never stored in plain text.
                  </Text>
                </View>
              ) : null}

              {/* Assign to Agent Section */}
              {connected && server && agents.length > 0 ? (
                <View>
                  <SectionLabel text="Assign to agent" />
                  <GroupedCard style={{ padding: space.md, gap: space.md }}>
                    <View style={styles.agentsPillRow}>
                      {agents.map((agent) => {
                        const isSelected = selectedAgentId === agent.id;
                        return (
                          <Pressable
                            key={agent.id}
                            onPress={() => setSelectedAgentId(agent.id)}
                            accessibilityRole="button"
                            accessibilityLabel={agent.name}
                            style={[
                              styles.agentCapsule,
                              isSelected && styles.agentCapsuleSelected,
                              isSelected && shadow.floating,
                            ]}
                          >
                            <AgentAvatar avatar={agent.avatar} name={agent.name} size={18} />
                            <Text
                              style={[
                                styles.agentCapsuleText,
                                isSelected && styles.agentCapsuleTextSelected,
                              ]}
                            >
                              {agent.name}
                            </Text>
                          </Pressable>
                        );
                      })}
                    </View>

                    {attached ? (
                      <PillButton
                        label={`Remove from ${selectedAgent?.name ?? 'Agent'}`}
                        onPress={() => void handleDetach()}
                        disabled={busy === 'detach'}
                        variant="secondary"
                        style={{ backgroundColor: colors.surface }}
                      />
                    ) : (
                      <PillButton
                        label={`Add to ${selectedAgent?.name ?? 'Agent'}`}
                        onPress={() => void handleAttach()}
                        disabled={busy === 'attach' || !selectedAgentId || !connectionId}
                        variant="primary"
                      />
                    )}
                  </GroupedCard>
                </View>
              ) : null}
            </View>
          }
          ListFooterComponent={
            connected ? (
              <View
                style={{
                  paddingTop: tools.length > 0 ? space.lg : 0,
                }}
              >
                <Pressable
                  onPress={() => void handleDisconnect()}
                  disabled={busy === 'disconnect'}
                  accessibilityRole="button"
                  accessibilityLabel="Disconnect integration"
                  style={styles.disconnectButton}
                >
                  <Text style={styles.disconnectText}>
                    {busy === 'disconnect' ? 'Disconnecting…' : 'Disconnect integration'}
                  </Text>
                </Pressable>
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
  noticeBox: {
    backgroundColor: colors.surface,
    borderRadius: radius.card,
    padding: space.md,
    gap: 4,
  },
  noticeBoxDanger: {
    backgroundColor: colors.surface,
  },
  noticeHeader: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: space.xs,
  },
  noticeTitle: {
    fontSize: 14,
    fontWeight: '600',
    color: colors.textPrimary,
  },
  noticeText: {
    fontSize: 13,
    lineHeight: 18,
    color: colors.textSecondary,
  },
  heroCard: {
    backgroundColor: colors.surface,
    borderRadius: radius.card,
    padding: space.xl,
    gap: space.md,
  },
  heroHeader: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: space.md,
  },
  appIconBox: {
    width: 56,
    height: 56,
    borderRadius: radius.tile,
    backgroundColor: colors.surfaceRaised,
    alignItems: 'center',
    justifyContent: 'center',
    ...shadow.floating,
  },
  appName: {
    fontSize: 22,
    lineHeight: 28,
    fontWeight: '600',
    color: colors.textPrimary,
  },
  appEndpoint: {
    fontSize: 14,
    lineHeight: 18,
    color: colors.textSecondary,
    marginTop: 2,
  },
  appDescription: {
    fontSize: 15,
    lineHeight: 22,
    color: colors.textSecondary,
  },
  includesLabel: {
    fontSize: 13,
    fontWeight: '500',
    color: colors.textSecondary,
  },
  includesRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    backgroundColor: colors.surfaceRaised,
    borderRadius: radius.inner,
    paddingHorizontal: space.md,
    paddingVertical: 12,
  },
  includesCount: {
    fontSize: 15,
    fontWeight: '500',
    color: colors.textPrimary,
    fontVariant: ['tabular-nums'],
  },
  viewSourceText: {
    fontSize: 14,
    fontWeight: '500',
    color: colors.link,
  },
  addedPill: {
    height: 48,
    borderRadius: radius.pill,
    backgroundColor: colors.surface,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 6,
  },
  addedText: {
    fontSize: 16,
    fontWeight: '600',
    color: colors.textPrimary,
  },
  card: {
    backgroundColor: colors.surface,
    borderRadius: radius.card,
    padding: space.lg,
    gap: space.sm,
  },
  cardHeader: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: space.xs,
  },
  cardTitle: {
    fontSize: 16,
    fontWeight: '600',
    color: colors.textPrimary,
  },
  cardText: {
    fontSize: 14,
    lineHeight: 20,
    color: colors.textSecondary,
  },
  keyInput: {
    backgroundColor: colors.surfaceRaised,
    borderRadius: radius.pill,
    paddingHorizontal: space.md,
    paddingVertical: 12,
    fontSize: 15,
    color: colors.textPrimary,
  },
  securityText: {
    fontSize: 12,
    color: colors.textSecondary,
    textAlign: 'center',
    marginTop: 4,
  },
  agentsPillRow: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: space.xs,
  },
  agentCapsule: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
    borderRadius: radius.pill,
    backgroundColor: colors.surfaceRaised,
    paddingHorizontal: 12,
    paddingVertical: 7,
  },
  agentCapsuleSelected: {
    backgroundColor: colors.primary,
  },
  agentCapsuleText: {
    fontSize: 13,
    fontWeight: '500',
    color: colors.textSecondary,
  },
  agentCapsuleTextSelected: {
    fontWeight: '600',
    color: colors.onPrimary,
  },
  listHeader: {
    gap: space.lg,
    // Replaces the content container's old 16pt gap below the header.
    marginBottom: space.lg,
  },
  toolsLabelCell: {
    // SectionLabel already adds its own 8pt marginBottom, so label→first tool
    // is the 8pt the spec asks for.
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
  toolRow: {
    paddingHorizontal: space.lg,
    paddingVertical: 14,
    gap: space.xs,
  },
  toolHeader: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    gap: space.xs,
  },
  toolIconBox: {
    width: 28,
    height: 28,
    borderRadius: radius.tile,
    backgroundColor: colors.surfaceRaised,
    alignItems: 'center',
    justifyContent: 'center',
  },
  toolName: {
    fontSize: 15,
    lineHeight: 20,
    fontWeight: '600',
    color: colors.textPrimary,
  },
  riskBadge: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 3,
    borderRadius: radius.pill,
    backgroundColor: colors.surfaceRaised,
    paddingHorizontal: 8,
    paddingVertical: 2,
  },
  riskText: {
    fontSize: 11,
    fontWeight: '500',
    color: colors.textSecondary,
    textTransform: 'capitalize',
  },
  toolDescription: {
    fontSize: 13,
    lineHeight: 18,
    color: colors.textSecondary,
  },
  toolSwitches: {
    marginTop: space.xs,
    paddingTop: space.xs,
    gap: space.sm,
    borderTopWidth: StyleSheet.hairlineWidth,
    borderTopColor: colors.divider,
  },
  switchRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
  },
  switchLabel: {
    fontSize: 13,
    color: colors.textPrimary,
  },
  mandatoryText: {
    fontSize: 11,
    color: colors.danger,
  },
  disconnectButton: {
    height: 44,
    borderRadius: radius.pill,
    backgroundColor: colors.surface,
    alignItems: 'center',
    justifyContent: 'center',
  },
  disconnectText: {
    fontSize: 14,
    fontWeight: '500',
    color: colors.danger,
  },
});
