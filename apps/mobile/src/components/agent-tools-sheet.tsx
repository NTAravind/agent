import React, { useCallback, useEffect, useMemo, useState } from 'react';
import {
  Alert as RNAlert,
  Modal,
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  View,
} from 'react-native';
import { Spinner, Switch } from 'heroui-native';
import { useRouter } from 'expo-router';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import {
  Blocks,
  ExternalLink,
  ShieldAlert,
  Wrench,
  X,
} from 'lucide-react-native';

import {
  GroupedCard,
  HairlineDivider,
  PillButton,
  RoundButton,
  SectionLabel,
  TextAction,
} from '@/components/design-system';
import { IntegrationIcon } from '@/components/integration-icon';
import { colors, radius, space } from '@/theme';
import {
  attachServer,
  fetchAgentAttachments,
  fetchServers,
  toggleAgentServerAttachment,
  updateToolPermissions,
  type AgentAttachment,
  type CatalogEntry,
} from '@/lib/mcp';

type Props = {
  agentId: string;
  agentName?: string;
  visible: boolean;
  onClose: () => void;
  onToolCountChanged?: (count: number) => void;
};

function RiskBadge({ level }: { level: string }) {
  const isHigh = level === 'high';
  return (
    <View style={styles.riskBadge}>
      {isHigh && <ShieldAlert size={12} color={colors.recording} />}
      <Text style={[styles.riskText, isHigh && { color: colors.recording }]}>
        {`${level} risk`}
      </Text>
    </View>
  );
}

export function AgentToolsSheet({
  agentId,
  agentName,
  visible,
  onClose,
  onToolCountChanged,
}: Props) {
  const router = useRouter();
  const insets = useSafeAreaInsets();

  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [attachments, setAttachments] = useState<AgentAttachment[]>([]);
  const [availableServers, setAvailableServers] = useState<CatalogEntry[]>([]);
  const [togglingToolId, setTogglingToolId] = useState<string | null>(null);
  const [togglingAttachmentId, setTogglingAttachmentId] = useState<string | null>(null);
  const [attachingConnectionId, setAttachingConnectionId] = useState<string | null>(null);

  const loadData = useCallback(async () => {
    if (!agentId || agentId === 'new') return;
    setLoading(true);
    setError(null);
    try {
      const [attachmentList, connectedServers] = await Promise.all([
        fetchAgentAttachments(agentId).catch(() => [] as AgentAttachment[]),
        fetchServers({ connected: true }).catch(() => [] as CatalogEntry[]),
      ]);

      setAttachments(attachmentList);

      // Connected servers not yet attached to this agent
      const attachedConnectionIds = new Set(
        attachmentList
          .map((att) => att.connection?.id)
          .filter((cid): cid is string => Boolean(cid)),
      );
      const unattached = connectedServers.filter(
        (srv) => srv.connectionId && !attachedConnectionIds.has(srv.connectionId),
      );
      setAvailableServers(unattached);

      const enabledCount = attachmentList.reduce(
        (acc, att) => (att.enabled ? acc + att.tools.filter((t) => t.enabled).length : acc),
        0,
      );
      onToolCountChanged?.(enabledCount);
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setLoading(false);
    }
  }, [agentId, onToolCountChanged]);

  useEffect(() => {
    if (!visible) return;
    let cancelled = false;
    const timer = setTimeout(() => {
      if (!cancelled) {
        void loadData();
      }
    }, 0);
    return () => {
      cancelled = true;
      clearTimeout(timer);
    };
  }, [loadData, visible]);

  const enabledToolsCount = useMemo(() => {
    return attachments.reduce(
      (sum, att) => (att.enabled ? sum + att.tools.filter((t) => t.enabled).length : sum),
      0,
    );
  }, [attachments]);

  const totalToolsCount = useMemo(() => {
    return attachments.reduce((sum, att) => sum + att.tools.length, 0);
  }, [attachments]);

  // Toggle individual tool enabled state
  const handleToggleTool = async (
    tool: AgentAttachment['tools'][number],
    nextEnabled: boolean,
  ) => {
    if (!agentId || togglingToolId) return;

    setTogglingToolId(tool.id);
    const prevAttachments = attachments;

    // Optimistic update
    const updated = attachments.map((att) => ({
      ...att,
      tools: att.tools.map((t) =>
        t.id === tool.id ? { ...t, enabled: nextEnabled } : t,
      ),
    }));
    setAttachments(updated);

    const newEnabledCount = updated.reduce(
      (acc, att) => (att.enabled ? acc + att.tools.filter((t) => t.enabled).length : acc),
      0,
    );
    onToolCountChanged?.(newEnabledCount);

    try {
      await updateToolPermissions(agentId, [
        {
          mcpToolId: tool.id,
          enabled: nextEnabled,
          approvalRequired: tool.approvalRequired,
        },
      ]);
    } catch (err) {
      setAttachments(prevAttachments);
      const revertCount = prevAttachments.reduce(
        (acc, att) => (att.enabled ? acc + att.tools.filter((t) => t.enabled).length : acc),
        0,
      );
      onToolCountChanged?.(revertCount);
      RNAlert.alert('Could not update tool', err instanceof Error ? err.message : String(err));
    } finally {
      setTogglingToolId(null);
    }
  };

  // Toggle whole integration attachment enabled state
  const handleToggleAttachment = async (
    attachment: AgentAttachment,
    nextEnabled: boolean,
  ) => {
    const connectionId = attachment.connection?.id;
    if (!agentId || !connectionId || togglingAttachmentId) return;

    setTogglingAttachmentId(attachment.attachmentId);
    const prevAttachments = attachments;

    // Optimistic update
    const updated = attachments.map((att) =>
      att.attachmentId === attachment.attachmentId ? { ...att, enabled: nextEnabled } : att,
    );
    setAttachments(updated);

    const newEnabledCount = updated.reduce(
      (acc, att) => (att.enabled ? acc + att.tools.filter((t) => t.enabled).length : acc),
      0,
    );
    onToolCountChanged?.(newEnabledCount);

    try {
      await toggleAgentServerAttachment(agentId, connectionId, nextEnabled);
    } catch (err) {
      setAttachments(prevAttachments);
      const revertCount = prevAttachments.reduce(
        (acc, att) => (att.enabled ? acc + att.tools.filter((t) => t.enabled).length : acc),
        0,
      );
      onToolCountChanged?.(revertCount);
      RNAlert.alert(
        'Could not update integration',
        err instanceof Error ? err.message : String(err),
      );
    } finally {
      setTogglingAttachmentId(null);
    }
  };

  // Attach a connected server to this agent
  const handleAttachServer = async (server: CatalogEntry) => {
    if (!agentId || !server.connectionId || attachingConnectionId) return;

    setAttachingConnectionId(server.connectionId);
    try {
      await attachServer(agentId, server.connectionId);
      await loadData();
    } catch (err) {
      RNAlert.alert(
        'Could not attach integration',
        err instanceof Error ? err.message : String(err),
      );
    } finally {
      setAttachingConnectionId(null);
    }
  };

  return (
    <Modal
      visible={visible}
      transparent
      animationType="slide"
      onRequestClose={onClose}
      statusBarTranslucent
    >
      <View style={styles.overlay}>
        <Pressable
          accessibilityLabel="Close sheet"
          onPress={onClose}
          style={StyleSheet.absoluteFill}
        />

        <View
          style={[
            styles.sheetContainer,
            { paddingBottom: Math.max(insets.bottom + space.md, space.xl) },
          ]}
        >
          {/* Top handle pill */}
          <View style={styles.handleContainer}>
            <View style={styles.handle} />
          </View>

          {/* Header */}
          <View style={styles.sheetHeader}>
            <View style={{ flex: 1, paddingRight: space.md }}>
              <Text style={styles.sheetTitle}>Integrations & Tools</Text>
              <Text style={styles.sheetSubtitle}>
                {loading
                  ? 'Loading tools…'
                  : `${enabledToolsCount} of ${totalToolsCount} tools enabled${
                      agentName ? ` for ${agentName}` : ''
                    }`}
              </Text>
            </View>
            <RoundButton
              icon={X}
              onPress={onClose}
              inSheet
              accessibilityLabel="Close tools sheet"
              style={styles.closeButton}
            />
          </View>

          {error ? (
            <View style={styles.errorBox}>
              <Text style={styles.errorText}>{error}</Text>
            </View>
          ) : null}

          {loading ? (
            <View style={styles.loadingBox}>
              <Spinner size="lg" color="default" />
              <Text style={styles.loadingText}>Fetching available tools…</Text>
            </View>
          ) : (
            <ScrollView
              contentContainerStyle={styles.scrollContent}
              showsVerticalScrollIndicator={false}
              keyboardShouldPersistTaps="handled"
            >
              {attachments.length === 0 && availableServers.length === 0 ? (
                <View style={styles.emptyBox}>
                  <View style={styles.emptyIconBox}>
                    <Blocks size={32} color={colors.textSecondary} strokeWidth={1.5} />
                  </View>
                  <Text style={styles.emptyTitle}>No Integrations Connected</Text>
                  <Text style={styles.emptySubtitle}>
                    Connect integrations like GitHub, Google, or Slack in the Integrations
                    Marketplace to grant this agent specialized tools.
                  </Text>
                  <PillButton
                    label="Browse Marketplace"
                    variant="primary"
                    onPress={() => {
                      onClose();
                      router.push('/mcp');
                    }}
                    style={{ marginTop: space.sm }}
                  />
                </View>
              ) : null}

              {/* Attached integrations list */}
              {attachments.length > 0 ? (
                <View style={{ gap: space.md }}>
                  <SectionLabel text="Connected Integrations" />
                  {attachments.map((attachment) => {
                    const server = attachment.server;
                    const isEnabled = attachment.enabled;
                    const tools = attachment.tools;
                    const enabledCount = tools.filter((t) => t.enabled).length;

                    return (
                      <GroupedCard key={attachment.attachmentId} style={styles.integrationCard}>
                        {/* Integration Header Row */}
                        <View style={styles.integrationHeaderRow}>
                          <View style={styles.integrationIconWrapper}>
                            {server?.iconUrl ? (
                              <IntegrationIcon uri={server.iconUrl} size={32} />
                            ) : (
                              <Wrench size={22} color={colors.textPrimary} strokeWidth={1.75} />
                            )}
                          </View>
                          <View style={{ flex: 1, minWidth: 0 }}>
                            <Text numberOfLines={1} style={styles.integrationName}>
                              {server?.name ?? 'Custom MCP Server'}
                            </Text>
                            <Text numberOfLines={1} style={styles.integrationMeta}>
                              {isEnabled
                                ? `${enabledCount} of ${tools.length} tools on`
                                : 'Disabled for this agent'}
                            </Text>
                          </View>
                          <Switch
                            isSelected={isEnabled}
                            onSelectedChange={(next) => void handleToggleAttachment(attachment, next)}
                            isDisabled={togglingAttachmentId === attachment.attachmentId}
                            accessibilityLabel={`Toggle ${server?.name ?? 'integration'}`}
                          />
                        </View>

                        {/* Tools Under This Integration */}
                        {tools.length > 0 && isEnabled && (
                          <View style={styles.toolsContainer}>
                            {tools.map((tool, idx) => {
                              const isToolActive = tool.enabled && isEnabled;
                              return (
                                <React.Fragment key={tool.id}>
                                  <HairlineDivider />
                                  <View style={styles.toolRow}>
                                    <View style={{ flex: 1, minWidth: 0, gap: 2 }}>
                                      <View style={styles.toolTitleRow}>
                                        <Text numberOfLines={1} style={styles.toolName}>
                                          {tool.name}
                                        </Text>
                                        <RiskBadge level={tool.riskLevel} />
                                      </View>
                                      {tool.description ? (
                                        <Text
                                          numberOfLines={2}
                                          style={styles.toolDescription}
                                        >
                                          {tool.description}
                                        </Text>
                                      ) : null}
                                    </View>
                                    <Switch
                                      isSelected={isToolActive}
                                      onSelectedChange={(next) =>
                                        void handleToggleTool(tool, next)
                                      }
                                      isDisabled={
                                        !isEnabled || togglingToolId === tool.id
                                      }
                                      accessibilityLabel={`Toggle tool ${tool.name}`}
                                    />
                                  </View>
                                </React.Fragment>
                              );
                            })}
                          </View>
                        )}
                      </GroupedCard>
                    );
                  })}
                </View>
              ) : null}

              {/* Available connected integrations not yet attached */}
              {availableServers.length > 0 ? (
                <View style={{ gap: space.md, marginTop: space.sm }}>
                  <SectionLabel text="Available in Your Account" />
                  <GroupedCard style={{ padding: space.sm }}>
                    {availableServers.map((server, idx) => (
                      <React.Fragment key={server.id}>
                        {idx > 0 && <HairlineDivider />}
                        <View style={styles.availableRow}>
                          <View style={styles.integrationIconWrapper}>
                            {server.iconUrl ? (
                              <IntegrationIcon uri={server.iconUrl} size={30} />
                            ) : (
                              <Blocks size={20} color={colors.textSecondary} />
                            )}
                          </View>
                          <View style={{ flex: 1, minWidth: 0 }}>
                            <Text numberOfLines={1} style={styles.availableName}>
                              {server.name}
                            </Text>
                            <Text numberOfLines={1} style={styles.availableCategory}>
                              {server.category || server.provider || 'Connected integration'}
                            </Text>
                          </View>
                          <PillButton
                            label={
                              attachingConnectionId === server.connectionId
                                ? 'Adding…'
                                : 'Add'
                            }
                            variant="secondary"
                            disabled={attachingConnectionId === server.connectionId}
                            onPress={() => void handleAttachServer(server)}
                          />
                        </View>
                      </React.Fragment>
                    ))}
                  </GroupedCard>
                </View>
              ) : null}

              {/* Marketplace shortcut link */}
              <View style={styles.marketplaceLinkBox}>
                <TextAction
                  icon={ExternalLink}
                  label="Browse integrations marketplace"
                  onPress={() => {
                    onClose();
                    router.push('/mcp');
                  }}
                />
              </View>
            </ScrollView>
          )}
        </View>
      </View>
    </Modal>
  );
}

const styles = StyleSheet.create({
  overlay: {
    flex: 1,
    justifyContent: 'flex-end',
    backgroundColor: colors.overlay,
  },
  sheetContainer: {
    maxHeight: '88%',
    borderTopLeftRadius: radius.sheet,
    borderTopRightRadius: radius.sheet,
    backgroundColor: colors.surfaceRaised,
    paddingHorizontal: space.lg,
    paddingTop: space.sm,
  },
  handleContainer: {
    alignItems: 'center',
    paddingVertical: space.xs,
  },
  handle: {
    width: 36,
    height: 5,
    borderRadius: radius.pill,
    backgroundColor: colors.divider,
  },
  sheetHeader: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingVertical: space.md,
  },
  sheetTitle: {
    fontSize: 20,
    lineHeight: 26,
    fontWeight: '600',
    color: colors.textPrimary,
  },
  sheetSubtitle: {
    fontSize: 13,
    lineHeight: 18,
    color: colors.textSecondary,
    marginTop: 2,
  },
  closeButton: {
    backgroundColor: colors.surface,
    shadowColor: 'transparent',
    shadowOpacity: 0,
    elevation: 0,
  },
  errorBox: {
    backgroundColor: colors.recordingBg,
    borderRadius: radius.card,
    padding: space.md,
    marginBottom: space.md,
  },
  errorText: {
    color: colors.recording,
    fontSize: 13,
    textAlign: 'center',
  },
  loadingBox: {
    paddingVertical: 48,
    alignItems: 'center',
    justifyContent: 'center',
    gap: space.sm,
  },
  loadingText: {
    fontSize: 14,
    color: colors.textSecondary,
  },
  scrollContent: {
    paddingBottom: space.xl,
    gap: space.lg,
  },
  emptyBox: {
    alignItems: 'center',
    paddingVertical: space.xl,
    paddingHorizontal: space.md,
    gap: space.sm,
  },
  emptyIconBox: {
    width: 56,
    height: 56,
    borderRadius: radius.tile,
    backgroundColor: colors.surface,
    alignItems: 'center',
    justifyContent: 'center',
    marginBottom: space.xs,
  },
  emptyTitle: {
    fontSize: 17,
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
  integrationCard: {
    padding: space.md,
    gap: space.xs,
  },
  integrationHeaderRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: space.md,
  },
  integrationIconWrapper: {
    width: 38,
    height: 38,
    borderRadius: radius.inner,
    backgroundColor: colors.surface,
    alignItems: 'center',
    justifyContent: 'center',
  },
  integrationName: {
    fontSize: 16,
    lineHeight: 22,
    fontWeight: '600',
    color: colors.textPrimary,
  },
  integrationMeta: {
    fontSize: 13,
    color: colors.textSecondary,
    marginTop: 1,
  },
  toolsContainer: {
    marginTop: space.xs,
  },
  toolRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    gap: space.md,
    paddingVertical: space.sm,
  },
  toolTitleRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: space.xs,
  },
  toolName: {
    fontSize: 15,
    lineHeight: 20,
    fontWeight: '500',
    color: colors.textPrimary,
  },
  toolDescription: {
    fontSize: 12,
    lineHeight: 16,
    color: colors.textSecondary,
    marginTop: 1,
  },
  riskBadge: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 3,
    borderRadius: radius.pill,
    backgroundColor: colors.surface,
    paddingHorizontal: 7,
    paddingVertical: 1,
  },
  riskText: {
    fontSize: 10,
    fontWeight: '500',
    color: colors.textSecondary,
    textTransform: 'capitalize',
  },
  availableRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: space.md,
    padding: space.sm,
  },
  availableName: {
    fontSize: 15,
    fontWeight: '500',
    color: colors.textPrimary,
  },
  availableCategory: {
    fontSize: 12,
    color: colors.textSecondary,
    marginTop: 1,
    textTransform: 'capitalize',
  },
  marketplaceLinkBox: {
    paddingHorizontal: space.sm,
    paddingTop: space.xs,
  },
});
