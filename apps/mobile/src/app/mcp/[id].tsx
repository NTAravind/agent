import { useCallback, useEffect, useRef, useState } from 'react';
import { Spinner, Switch, Typography } from 'heroui-native';
import { Pressable, RefreshControl, ScrollView, TextInput, View } from 'react-native';
import { useFocusEffect, useLocalSearchParams, useRouter } from 'expo-router';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import {
  AlertCircle,
  ArrowLeft,
  CheckCircle2,
  Clock,
  ExternalLink,
  Info,
  KeyRound,
  RotateCw,
  ShieldAlert,
  ShieldCheck,
  UserCheck,
  Wrench,
  Zap,
} from 'lucide-react-native';

import { AppHeader } from '@/components/app-header';
import { AgentAvatar } from '@/components/agent-avatar';
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
type CachedTool = ServerDetail['tools'][number];
type Notice = { kind: 'success' | 'warning' | 'danger'; text: string };

const POLL_INTERVAL_MS = 2_000;
const POLL_ATTEMPTS = 30;
const AUTO_VERIFY_THROTTLE_MS = 15_000;

function RiskBadge({ level }: { level: string }) {
  if (level === 'high') {
    return (
      <View className="flex-row items-center gap-1 rounded-full border border-red-500/30 bg-red-500/10 px-2 py-0.5">
        <ShieldAlert size={11} color="#F87171" />
        <Typography type="body-xs" className="font-semibold capitalize text-red-400">
          high risk
        </Typography>
      </View>
    );
  }
  if (level === 'medium') {
    return (
      <View className="flex-row items-center gap-1 rounded-full border border-amber-500/30 bg-amber-500/10 px-2 py-0.5">
        <Typography type="body-xs" className="font-semibold capitalize text-amber-400">
          med risk
        </Typography>
      </View>
    );
  }
  return (
    <View className="flex-row items-center gap-1 rounded-full border border-emerald-500/30 bg-emerald-500/10 px-2 py-0.5">
      <Typography type="body-xs" className="font-semibold capitalize text-emerald-400">
        low risk
      </Typography>
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

  const statusRef = useRef<string | null>(null);
  const cidRef = useRef<string | null>(null);
  const lastAutoVerifyRef = useRef(0);
  const aliveRef = useRef(true);
  useEffect(() => {
    statusRef.current = status;
    cidRef.current = connectionId;
  }, [status, connectionId]);
  useEffect(() => {
    aliveRef.current = true;
    return () => {
      aliveRef.current = false;
    };
  }, []);

  const load = useCallback(async () => {
    try {
      const [nextDetail, agentList] = await Promise.all([
        fetchServer(serverId),
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
      return nextDetail;
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
      return null;
    } finally {
      setLoading(false);
      setRefreshing(false);
    }
  }, [serverId, selectedAgentId]);

  useFocusEffect(
    useCallback(() => {
      void load();
      if (
        statusRef.current === 'pending' &&
        cidRef.current &&
        Date.now() - lastAutoVerifyRef.current > AUTO_VERIFY_THROTTLE_MS
      ) {
        lastAutoVerifyRef.current = Date.now();
        const cid = cidRef.current;
        void verifyConnection(cid, { issueLink: false })
          .then((result) => {
            if (result.status !== 'pending' && aliveRef.current) void load();
          })
          .catch(() => undefined);
      }
    }, [load]),
  );

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
            if (result.status === 'connected') {
              setNotice({ kind: 'success', text: 'Signed in. Tools discovered below.' });
            } else {
              setNotice({
                kind: 'danger',
                text: result.message || `The provider reports ${result.status}. Reconnect to try again.`,
              });
            }
            return;
          }
        } catch {
          // Transient failure
        }
      }
      if (aliveRef.current) {
        await load();
        setNotice({
          kind: 'warning',
          text: 'The provider is still confirming sign-in. Try “Finish connecting” again shortly.',
        });
      }
    },
    [load],
  );

  const handledCallbackRef = useRef<string | null>(null);
  useEffect(() => {
    const callbackStatus = oauthParams.status;
    if (!callbackStatus) return;
    const callbackKey = `${serverId}:${callbackStatus}:${oauthParams.message ?? ''}`;
    if (handledCallbackRef.current === callbackKey) return;
    handledCallbackRef.current = callbackKey;

    let cancelled = false;
    void (async () => {
      const loaded = await load();
      if (cancelled) return;
      if (callbackStatus === 'error') {
        setNotice({ kind: 'danger', text: oauthParams.message ?? 'Connection failed.' });
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
      setError(err instanceof Error ? err.message : String(err));
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
      await load();
      setNotice({ kind: 'success', text: 'Disconnected.' });
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
      setNotice({ kind: 'success', text: `Attached to ${selectedAgent?.name ?? 'agent'}.` });
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
      setNotice({ kind: 'success', text: `Removed from ${selectedAgent?.name ?? 'agent'}.` });
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
            {server?.name ?? 'Integration'}
          </Typography>
        }
        right={
          connected ? (
            <Pressable
              onPress={() => void handleRefresh()}
              disabled={busy === 'refresh'}
              className="h-10 w-10 items-center justify-center rounded-full bg-white/10 active:opacity-70"
              accessibilityLabel="Refresh tools"
            >
              {busy === 'refresh' ? (
                <Spinner size="sm" color="default" />
              ) : (
                <RotateCw size={18} color="#fff" />
              )}
            </Pressable>
          ) : null
        }
      />

      {loading && !detail ? (
        <View className="mt-20 items-center justify-center">
          <Spinner size="lg" color="default" />
        </View>
      ) : (
        <ScrollView
          contentContainerStyle={{
            padding: 16,
            paddingBottom: insets.bottom + 24,
            gap: 14,
          }}
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
          {/* Notifications */}
          {notice ? (
            <View
              className={`rounded-2xl border p-4 ${
                notice.kind === 'success'
                  ? 'border-emerald-500/20 bg-emerald-500/10'
                  : notice.kind === 'warning'
                    ? 'border-amber-500/20 bg-amber-500/10'
                    : 'border-red-500/20 bg-red-500/10'
              }`}
            >
              <View className="flex-row items-center gap-2">
                {notice.kind === 'success' ? (
                  <CheckCircle2 size={16} color="#34D399" />
                ) : notice.kind === 'warning' ? (
                  <Clock size={16} color="#FBBF24" />
                ) : (
                  <AlertCircle size={16} color="#F87171" />
                )}
                <Typography
                  type="body-sm"
                  className={`font-semibold ${
                    notice.kind === 'success'
                      ? 'text-emerald-300'
                      : notice.kind === 'warning'
                        ? 'text-amber-300'
                        : 'text-red-300'
                  }`}
                >
                  {notice.kind === 'success'
                    ? 'Done'
                    : notice.kind === 'warning'
                      ? 'Notice'
                      : 'Error'}
                </Typography>
              </View>
              <Typography
                type="body-xs"
                className={`mt-1 ${
                  notice.kind === 'success'
                    ? 'text-emerald-300/80'
                    : notice.kind === 'warning'
                      ? 'text-amber-300/80'
                      : 'text-red-300/80'
                }`}
              >
                {notice.text}
              </Typography>
            </View>
          ) : null}

          {error ? (
            <View className="rounded-2xl border border-red-500/20 bg-red-500/10 p-4">
              <Typography type="body-sm" className="font-semibold text-red-300">
                Action failed
              </Typography>
              <Typography type="body-xs" className="mt-1 text-red-300/80">
                {error}
              </Typography>
            </View>
          ) : null}

          {/* Hero Overview Card */}
          <View className="rounded-2xl border border-white/5 bg-[#131418] p-5">
            <View className="flex-row flex-wrap items-center gap-2">
              <Typography type="h3" className="font-bold text-white">
                {server?.name}
              </Typography>
              <View className="rounded-full bg-white/10 px-2.5 py-0.5">
                <Typography type="body-xs" className="capitalize text-white/70">
                  {server?.category ?? 'integration'}
                </Typography>
              </View>
              {connected ? (
                <View className="flex-row items-center gap-1 rounded-full border border-emerald-500/20 bg-emerald-500/10 px-2.5 py-0.5">
                  <CheckCircle2 size={12} color="#34D399" />
                  <Typography type="body-xs" className="font-semibold text-emerald-400">
                    connected
                  </Typography>
                </View>
              ) : status ? (
                <View className="rounded-full border border-amber-500/20 bg-amber-500/10 px-2.5 py-0.5">
                  <Typography type="body-xs" className="font-semibold text-amber-400 capitalize">
                    {status}
                  </Typography>
                </View>
              ) : null}
              {server?.isVerified ? (
                <View className="flex-row items-center gap-1 rounded-full border border-sky-500/20 bg-sky-500/10 px-2 py-0.5">
                  <ShieldCheck size={12} color="#38BDF8" />
                  <Typography type="body-xs" className="text-sky-400 font-medium">
                    verified
                  </Typography>
                </View>
              ) : null}
            </View>

            <Typography type="body-sm" className="mt-2 text-white/60 leading-relaxed">
              {server?.description || 'Vendor-hosted remote Model Context Protocol server.'}
            </Typography>

            {server?.endpoint ? (
              <Typography type="body-xs" className="mt-2 text-white/30 font-mono" numberOfLines={1}>
                {server.endpoint}
              </Typography>
            ) : null}

            {connected && detail ? (
              <View className="mt-3 flex-row items-center gap-2 border-t border-white/5 pt-3">
                <Wrench size={14} color="#818CF8" />
                <Typography type="body-xs" className="text-white/60">
                  {`${detail.tools.length} tools discovered${
                    detail.connection?.lastCheckedAt
                      ? ` · synced ${new Date(detail.connection.lastCheckedAt).toLocaleTimeString([], {
                          hour: '2-digit',
                          minute: '2-digit',
                        })}`
                      : ''
                  }`}
                </Typography>
              </View>
            ) : null}
          </View>

          {/* Setup instructions */}
          {server?.instructions ? (
            <View className="rounded-2xl border border-white/5 bg-[#131418] p-4">
              <View className="flex-row items-center gap-2 mb-1.5">
                <Info size={16} color="#818CF8" />
                <Typography type="h5" className="font-semibold text-white">
                  Setup instructions
                </Typography>
              </View>
              <Typography type="body-sm" className="text-white/60 leading-relaxed">
                {server.instructions}
              </Typography>
            </View>
          ) : null}

          {/* Connect / Authenticate Card */}
          {!connected && server ? (
            <View className="rounded-2xl border border-white/5 bg-[#131418] p-5">
              <View className="flex-row items-center gap-2 mb-2">
                <KeyRound size={18} color="#fff" />
                <Typography type="h5" className="font-semibold text-white">
                  {isOAuth
                    ? `Sign in with ${server.name}`
                    : needsKey
                      ? 'API key required'
                      : status === 'pending'
                        ? `Finish connecting ${server.name}`
                        : status === 'expired' || status === 'error'
                          ? `Reconnect ${server.name}`
                          : 'Connect service'}
                </Typography>
              </View>

              {needsKey ? (
                <View className="my-2">
                  <TextInput
                    value={apiKey}
                    onChangeText={setApiKey}
                    placeholder="Enter API key or token"
                    placeholderTextColor="rgba(255,255,255,0.3)"
                    autoCapitalize="none"
                    autoCorrect={false}
                    secureTextEntry
                    className="rounded-xl border border-white/10 bg-[#16171B] px-4 py-3 text-sm text-white"
                  />
                </View>
              ) : null}

              {oauthPending ? (
                <View className="my-2 rounded-xl border border-sky-500/20 bg-sky-500/10 p-3">
                  <Typography type="body-xs" className="text-sky-300">
                    Waiting for sign-in in browser… return to the app once completed.
                  </Typography>
                </View>
              ) : status === 'pending' ? (
                <Typography type="body-xs" className="my-1 text-white/50">
                  {isManaged
                    ? 'Sign-in not finished yet — open the link to authorize your account.'
                    : 'Authorization pending confirmation.'}
                </Typography>
              ) : null}

              <Pressable
                onPress={() => void handleConnect()}
                disabled={busy === 'connect' || (needsKey && !apiKey.trim()) || oauthPending}
                className={`mt-2 flex-row items-center justify-center rounded-full py-3.5 ${
                  busy === 'connect' || (needsKey && !apiKey.trim()) || oauthPending
                    ? 'bg-white/20'
                    : 'bg-white active:opacity-90'
                }`}
              >
                {busy === 'connect' ? (
                  <Spinner size="sm" color="default" />
                ) : (
                  <View className="flex-row items-center gap-2">
                    <Typography
                      type="body-sm"
                      className={`font-semibold ${
                        (needsKey && !apiKey.trim()) || oauthPending ? 'text-white/40' : 'text-black'
                      }`}
                    >
                      {connectLabel}
                    </Typography>
                    {isOAuth || isManaged ? <ExternalLink size={14} color="#000" /> : null}
                  </View>
                )}
              </Pressable>

              <Typography type="body-xs" className="mt-3 text-center text-white/40">
                Credentials are encrypted on the server and never stored locally.
              </Typography>
            </View>
          ) : null}

          {/* Attach to Agent Card */}
          {connected && server ? (
            <View className="rounded-2xl border border-white/5 bg-[#131418] p-5">
              <View className="flex-row items-center justify-between mb-3">
                <View className="flex-row items-center gap-2">
                  <UserCheck size={18} color="#818CF8" />
                  <Typography type="h5" className="font-semibold text-white">
                    Assign to Agent
                  </Typography>
                </View>
                {attached ? (
                  <View className="flex-row items-center gap-1 rounded-full border border-emerald-500/20 bg-emerald-500/10 px-2 py-0.5">
                    <CheckCircle2 size={11} color="#34D399" />
                    <Typography type="body-xs" className="text-emerald-400 font-semibold">
                      Attached
                    </Typography>
                  </View>
                ) : null}
              </View>

              {agents.length > 1 ? (
                <View className="flex-row flex-wrap gap-2 mb-4">
                  {agents.map((agent) => {
                    const isSelected = selectedAgentId === agent.id;
                    return (
                      <Pressable
                        key={agent.id}
                        onPress={() => setSelectedAgentId(agent.id)}
                        className={`flex-row items-center gap-2 rounded-full px-3 py-1.5 border ${
                          isSelected
                            ? 'border-white bg-white'
                            : 'border-white/10 bg-white/5 active:bg-white/10'
                        }`}
                      >
                        <AgentAvatar avatar={agent.avatar} name={agent.name} size={18} />
                        <Typography
                          type="body-xs"
                          className={`font-medium ${isSelected ? 'text-black font-semibold' : 'text-white/70'}`}
                        >
                          {agent.name}
                        </Typography>
                      </Pressable>
                    );
                  })}
                </View>
              ) : null}

              {attached ? (
                <View className="flex-row gap-2">
                  <Pressable
                    onPress={() => void handleDetach()}
                    disabled={busy === 'detach'}
                    className="flex-1 items-center justify-center rounded-full border border-red-500/30 bg-red-500/10 py-3 active:bg-red-500/20"
                  >
                    <Typography type="body-sm" className="font-semibold text-red-400">
                      Remove from {selectedAgent?.name ?? 'Agent'}
                    </Typography>
                  </Pressable>
                </View>
              ) : (
                <Pressable
                  onPress={() => void handleAttach()}
                  disabled={busy === 'attach' || !selectedAgentId || !connectionId}
                  className="items-center justify-center rounded-full bg-white py-3.5 active:opacity-90"
                >
                  {busy === 'attach' ? (
                    <Spinner size="sm" color="default" />
                  ) : (
                    <Typography type="body-sm" className="font-semibold text-black">
                      Add to {selectedAgent?.name ?? 'Agent'}
                    </Typography>
                  )}
                </Pressable>
              )}
            </View>
          ) : null}

          {/* Tools List */}
          {tools.length > 0 ? (
            <View className="gap-2.5">
              <View className="px-1 flex-row items-center justify-between">
                <Typography type="body-sm" className="font-medium text-white/70">
                  {attached
                    ? 'Tools Available to Agent'
                    : 'Tools Offered by Integration'}
                </Typography>
                <Typography type="body-xs" className="text-white/40">
                  {tools.length} total
                </Typography>
              </View>

              {tools.map((tool) => (
                <View
                  key={tool.id}
                  className="rounded-2xl border border-white/5 bg-[#131418] p-4"
                >
                  <View className="flex-row flex-wrap items-center justify-between gap-2">
                    <View className="flex-row items-center gap-2">
                      <Wrench size={15} color="#818CF8" />
                      <Typography type="h5" className="font-semibold text-white">
                        {'name' in tool && tool.name ? tool.name : tool.externalToolId}
                      </Typography>
                    </View>
                    <RiskBadge level={'riskLevel' in tool ? tool.riskLevel : 'medium'} />
                  </View>

                  <Typography type="body-xs" className="mt-1.5 text-white/50 leading-relaxed" numberOfLines={2}>
                    {tool.description || 'No description provided.'}
                  </Typography>

                  {attached ? (
                    <View className="mt-3.5 border-t border-white/5 pt-3 gap-2.5">
                      <View className="flex-row items-center justify-between">
                        <Typography type="body-xs" className="text-white/70">
                          Enabled
                        </Typography>
                        <Switch
                          isSelected={'enabled' in tool ? tool.enabled : true}
                          onSelectedChange={(value) =>
                            void handleToggleTool(tool as AttachmentTool, { enabled: value })
                          }
                          accessibilityLabel="Enable this tool"
                        />
                      </View>
                      <View className="flex-row items-center justify-between">
                        <View>
                          <Typography type="body-xs" className="text-white/70">
                            Require user approval
                          </Typography>
                          {'riskLevel' in tool && tool.riskLevel === 'high' ? (
                            <Typography type="body-xs" className="text-red-400/80">
                              Mandatory for high-risk tools
                            </Typography>
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
              ))}
            </View>
          ) : null}

          {/* Disconnect Button */}
          {connected ? (
            <View className="pt-2">
              <Pressable
                onPress={() => void handleDisconnect()}
                disabled={busy === 'disconnect'}
                className="items-center justify-center rounded-full border border-white/10 bg-white/5 py-3 active:bg-white/10"
              >
                <Typography type="body-sm" className="font-medium text-white/50">
                  {busy === 'disconnect' ? 'Disconnecting…' : 'Disconnect Integration'}
                </Typography>
              </Pressable>
            </View>
          ) : null}
        </ScrollView>
      )}
    </View>
  );
}
