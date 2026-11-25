import { useCallback, useEffect, useMemo, useState } from 'react';
import { FlatList, StyleSheet, Text, View } from 'react-native';
import { Spinner, Switch } from 'heroui-native';
import { useRouter } from 'expo-router';
import { Blocks, ExternalLink, ShieldAlert, Wrench } from 'lucide-react-native';
import { SymbolIcon } from '@/components/symbol-icon';

import {
  HairlineDivider,
  InlineError,
  PillButton,
  SectionLabel,
  TextAction,
} from '@/components/design-system';
import { Sheet, SheetHeader } from '@/components/sheet';
import { IntegrationIcon } from '@/components/integration-icon';
import { reportAppError } from '@/components/error-dialog-provider';
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

/**
 * One row of the virtualized tools sheet. Each attachment's card is split
 * into a header slice plus one slice per tool; `last` marks the slice that
 * closes a card so it carries the bottom radius.
 */
type ToolsSheetCell =
  | { key: string; type: 'empty' }
  | { key: string; type: 'label'; text: string; top: boolean }
  | {
      key: string;
      type: 'attachment';
      attachment: AgentAttachment;
      firstCard: boolean;
      last: boolean;
    }
  | {
      key: string;
      type: 'tool';
      tool: AgentAttachment['tools'][number];
      enabled: boolean;
      last: boolean;
    }
  | {
      key: string;
      type: 'available';
      server: CatalogEntry;
      first: boolean;
      last: boolean;
    }
  | { key: string; type: 'marketplace' };

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
      {isHigh && <SymbolIcon icon={ShieldAlert} size={12} color={colors.danger} />}
      <Text style={[styles.riskText, isHigh && { color: colors.danger }]}>
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

  // Flatten the sheet into virtualizable cells: an optional empty state, the
  // attached integrations (each split into a header slice plus one slice per
  // tool), the still-available integrations, and the marketplace link.
  const sheetCells = useMemo<ToolsSheetCell[]>(() => {
    const cells: ToolsSheetCell[] = [];

    if (attachments.length === 0 && availableServers.length === 0) {
      cells.push({ key: 'empty', type: 'empty' });
    }

    if (attachments.length > 0) {
      cells.push({
        key: 'label-attachments',
        type: 'label',
        text: 'Connected integrations',
        top: false,
      });
      attachments.forEach((attachment, index) => {
        const tools = attachment.enabled ? attachment.tools : [];
        cells.push({
          key: `attachment-${attachment.attachmentId}`,
          type: 'attachment',
          attachment,
          firstCard: index === 0,
          last: tools.length === 0,
        });
        tools.forEach((tool, toolIndex) => {
          cells.push({
            key: `tool-${attachment.attachmentId}-${tool.id}`,
            type: 'tool',
            tool,
            enabled: attachment.enabled,
            last: toolIndex === tools.length - 1,
          });
        });
      });
    }

    if (availableServers.length > 0) {
      cells.push({
        key: 'label-available',
        type: 'label',
        text: 'Available in your account',
        top: true,
      });
      availableServers.forEach((server, index) => {
        cells.push({
          key: `available-${server.id}`,
          type: 'available',
          server,
          first: index === 0,
          last: index === availableServers.length - 1,
        });
      });
    }

    cells.push({ key: 'marketplace', type: 'marketplace' });
    return cells;
  }, [attachments, availableServers]);

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
      reportAppError(err, { title: 'Could not update tool' });
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
      reportAppError(err, { title: 'Could not update integration' });
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
      reportAppError(err, { title: 'Could not attach integration' });
    } finally {
      setAttachingConnectionId(null);
    }
  };

  return (
    <Sheet visible={visible} onClose={onClose}>
      <SheetHeader onClose={onClose} closeLabel="Close tools sheet">
        <View>
          <Text style={styles.sheetTitle}>Integrations & tools</Text>
          <Text style={styles.sheetSubtitle}>
            {loading
              ? 'Loading tools…'
              : `${enabledToolsCount} of ${totalToolsCount} tools enabled${
                  agentName ? ` for ${agentName}` : ''
                }`}
          </Text>
        </View>
      </SheetHeader>

      {error ? <InlineError message={error} onRetry={() => void loadData()} /> : null}

      {loading ? (
        <View style={styles.loadingBox}>
          <Spinner size="lg" color="default" />
          <Text style={styles.loadingText}>Fetching available tools…</Text>
        </View>
      ) : (
        <FlatList
          data={sheetCells}
          keyExtractor={(cell) => cell.key}
          renderItem={({ item: cell }) => {
            if (cell.type === 'empty') {
              return (
                <View style={styles.emptyBox}>
                  <View style={styles.emptyIconBox}>
                    <SymbolIcon icon={Blocks} size={32} color={colors.textSecondary} strokeWidth={1.5} />
                  </View>
                  <Text style={styles.emptyTitle}>No integrations connected</Text>
                  <Text style={styles.emptySubtitle}>
                    Connect integrations like GitHub, Google, or Slack in the Integrations
                    Marketplace to grant this agent specialized tools.
                  </Text>
                  <PillButton
                    label="Browse marketplace"
                    variant="primary"
                    onPress={() => {
                      onClose();
                      router.push('/mcp');
                    }}
                    style={{ marginTop: space.sm }}
                  />
                </View>
              );
            }

            if (cell.type === 'label') {
              return (
                <View style={cell.top ? styles.sectionLabelTop : styles.sectionLabel}>
                  <SectionLabel text={cell.text} />
                </View>
              );
            }

            if (cell.type === 'attachment') {
              const { attachment } = cell;
              const server = attachment.server;
              const isEnabled = attachment.enabled;
              const enabledCount = attachment.tools.filter((t) => t.enabled).length;

              return (
                <View
                  style={[
                    styles.attachmentSlice,
                    cell.firstCard ? undefined : styles.cardGap,
                    styles.attachmentSliceTop,
                    cell.last && styles.attachmentSliceBottom,
                  ]}
                >
                  {/* Integration Header Row */}
                  <View style={styles.integrationHeaderRow}>
                    <View style={styles.integrationIconWrapper}>
                      {server?.iconUrl ? (
                        <IntegrationIcon uri={server.iconUrl} size={32} />
                      ) : (
                        <SymbolIcon icon={Wrench} size={22} color={colors.textPrimary} strokeWidth={1.75} />
                      )}
                    </View>
                    <View style={{ flex: 1, minWidth: 0 }}>
                      <Text numberOfLines={1} style={styles.integrationName}>
                        {server?.name ?? 'Custom MCP server'}
                      </Text>
                      <Text numberOfLines={1} style={styles.integrationMeta}>
                        {isEnabled
                          ? `${enabledCount} of ${attachment.tools.length} tools on`
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
                </View>
              );
            }

            if (cell.type === 'tool') {
              const isToolActive = cell.tool.enabled && cell.enabled;
              return (
                <View style={[styles.toolSlice, cell.last && styles.toolSliceLast]}>
                  <HairlineDivider />
                  <View style={styles.toolRow}>
                    <View style={{ flex: 1, minWidth: 0, gap: 2 }}>
                      <View style={styles.toolTitleRow}>
                        <Text numberOfLines={1} style={styles.toolName}>
                          {cell.tool.name}
                        </Text>
                        <RiskBadge level={cell.tool.riskLevel} />
                      </View>
                      {cell.tool.description ? (
                        <Text
                          numberOfLines={2}
                          style={styles.toolDescription}
                        >
                          {cell.tool.description}
                        </Text>
                      ) : null}
                    </View>
                    <Switch
                      isSelected={isToolActive}
                      onSelectedChange={(next) =>
                        void handleToggleTool(cell.tool, next)
                      }
                      isDisabled={
                        !cell.enabled || togglingToolId === cell.tool.id
                      }
                      accessibilityLabel={`Toggle tool ${cell.tool.name}`}
                    />
                  </View>
                </View>
              );
            }

            if (cell.type === 'available') {
              return (
                <View
                  style={[
                    styles.availableSlice,
                    cell.first && styles.availableSliceFirst,
                    cell.last && styles.availableSliceLast,
                  ]}
                >
                  {!cell.first ? <HairlineDivider /> : null}
                  <View style={styles.availableRow}>
                    <View style={styles.integrationIconWrapper}>
                      {cell.server.iconUrl ? (
                        <IntegrationIcon uri={cell.server.iconUrl} size={30} />
                      ) : (
                        <SymbolIcon icon={Blocks} size={20} color={colors.textSecondary} />
                      )}
                    </View>
                    <View style={{ flex: 1, minWidth: 0 }}>
                      <Text numberOfLines={1} style={styles.availableName}>
                        {cell.server.name}
                      </Text>
                      <Text numberOfLines={1} style={styles.availableCategory}>
                        {cell.server.category || cell.server.provider || 'Connected integration'}
                      </Text>
                    </View>
                    <PillButton
                      label={
                        attachingConnectionId === cell.server.connectionId
                          ? 'Adding…'
                          : 'Add'
                      }
                      variant="secondary"
                      disabled={attachingConnectionId === cell.server.connectionId}
                      onPress={() => void handleAttachServer(cell.server)}
                    />
                  </View>
                </View>
              );
            }

            return (
              <View style={styles.marketplaceCell}>
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
              </View>
            );
          }}
          contentContainerStyle={styles.scrollContent}
          showsVerticalScrollIndicator={false}
          keyboardShouldPersistTaps="handled"
        />
      )}
    </Sheet>
  );
}

const styles = StyleSheet.create({
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
    fontVariant: ['tabular-nums'],
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
  },
  sectionLabel: {
    // SectionLabel already adds its own 8pt marginBottom, so label→card is
    // the 8pt the spec asks for.
  },
  sectionLabelTop: {
    // The old 16pt gap between sections plus the section's own 8pt margin.
    marginTop: 24,
  },
  attachmentSlice: {
    backgroundColor: colors.surface,
    paddingHorizontal: space.md,
    paddingTop: space.md,
    // The card's 8pt gap before its tools.
    paddingBottom: space.sm,
  },
  attachmentSliceTop: {
    borderTopLeftRadius: radius.card,
    borderTopRightRadius: radius.card,
  },
  attachmentSliceBottom: {
    paddingBottom: space.md,
  },
  cardGap: {
    marginTop: space.xs,
  },
  toolSlice: {
    backgroundColor: colors.surface,
    paddingHorizontal: space.md,
  },
  toolSliceLast: {
    paddingBottom: space.md,
  },
  availableSlice: {
    backgroundColor: colors.surface,
    paddingHorizontal: space.sm,
  },
  availableSliceFirst: {
    paddingTop: space.sm,
  },
  availableSliceLast: {
    paddingBottom: space.sm,
  },
  marketplaceCell: {
    marginTop: space.lg,
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
    fontVariant: ['tabular-nums'],
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
