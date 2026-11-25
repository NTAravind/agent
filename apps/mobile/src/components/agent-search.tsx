import { useMemo, useState } from 'react';
import {
  FlatList,
  Modal,
  Pressable,
  StyleSheet,
  Text,
  TextInput,
  View,
} from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { Search as SearchIcon, SlidersHorizontal, X } from 'lucide-react-native';
import { SymbolIcon } from '@/components/symbol-icon';
import type { Agent, AgentGroup } from '@agent/shared';

import { AgentAvatar, ClusterAvatar } from '@/components/agent-avatar';
import { colors, radius, space, typography } from '@/theme';
import type { RunListItem } from '@/lib/agents';

type Props = {
  agents: Agent[];
  groups?: AgentGroup[];
  runs: RunListItem[];
  onSelect: (agentId: string) => void;
  onSelectGroup?: (groupId: string) => void;
  onClose: () => void;
  isOpen: boolean;
};

type SearchResultItem =
  | {
      id: string;
      kind: 'agent';
      title: string;
      subtitle: string;
      agent: Agent;
    }
  | {
      id: string;
      kind: 'group';
      title: string;
      subtitle: string;
      group: AgentGroup;
    }
  | {
      id: string;
      kind: 'message';
      title: string;
      subtitle: string;
      targetId: string;
      targetType: 'agent' | 'group';
      agent?: Agent;
    };

/**
 * Highlights the matched query substring in bold (700)
 */
function HighlightedText({ text, query }: { text: string; query: string }) {
  if (!query || !text) {
    return <Text style={styles.resultSubtitle}>{text}</Text>;
  }

  const lowerText = text.toLowerCase();
  const lowerQuery = query.toLowerCase();
  const index = lowerText.indexOf(lowerQuery);

  if (index === -1) {
    return <Text style={styles.resultSubtitle}>{text}</Text>;
  }

  const before = text.slice(0, index);
  const match = text.slice(index, index + query.length);
  const after = text.slice(index + query.length);

  return (
    <Text numberOfLines={1} style={styles.resultSubtitle}>
      {before}
      <Text style={styles.resultSubtitleBold}>{match}</Text>
      {after}
    </Text>
  );
}

/**
 * 6.11 Search sheet conforming to design.md:
 * - Slides up over dimmed background (overlay), top corners radius 32.
 * - Top bar: close X (round, 44x44, surface fill), pill search field (surface fill, 44 tall, magnifying glass icon, "Search" in textSecondary), filter sliders button on the right (44x44, surface).
 * - Results: each row has a 60pt avatar/mark, title 20/500, subtitle/preview 17/400 (with the matched word bold), and a right-aligned type label in 15pt textSecondary ("Group", "Agent", "Message").
 */
export function AgentSearch({
  agents,
  groups = [],
  runs,
  onSelect,
  onSelectGroup,
  onClose,
  isOpen,
}: Props) {
  const insets = useSafeAreaInsets();
  const [query, setQuery] = useState('');

  const q = query.trim().toLowerCase();

  const results = useMemo<SearchResultItem[]>(() => {
    const list: SearchResultItem[] = [];

    // 1. Groups matching query
    groups.forEach((g) => {
      if (!q || g.name.toLowerCase().includes(q) || (g.description ?? '').toLowerCase().includes(q)) {
        list.push({
          id: `group-${g.id}`,
          kind: 'group',
          title: g.name,
          subtitle: g.description || 'Group conversation',
          group: g,
        });
      }
    });

    // 2. Agents matching query
    agents.forEach((a) => {
      if (
        !q ||
        a.name.toLowerCase().includes(q) ||
        (a.role ?? '').toLowerCase().includes(q) ||
        (a.instructions ?? '').toLowerCase().includes(q)
      ) {
        list.push({
          id: `agent-${a.id}`,
          kind: 'agent',
          title: a.name,
          subtitle: a.role || a.instructions?.slice(0, 50) || 'Personal assistant',
          agent: a,
        });
      }
    });

    // 3. Messages matching query
    if (q) {
      runs.forEach((r) => {
        if (r.goal.toLowerCase().includes(q)) {
          const matchingAgent = agents.find((a) => a.id === r.agent_id);
          list.push({
            id: `msg-${r.id}`,
            kind: 'message',
            title: matchingAgent ? matchingAgent.name : 'Message',
            subtitle: r.goal,
            targetId: r.agent_id ?? '',
            targetType: 'agent',
            agent: matchingAgent,
          });
        }
      });
    }

    return list;
  }, [q, agents, groups, runs]);

  if (!isOpen) return null;

  return (
    <Modal
      visible={isOpen}
      animationType="slide"
      transparent
      onRequestClose={onClose}
    >
      <View style={styles.overlay}>
        <View style={[styles.sheetContainer, { paddingTop: insets.top + 8 }]}>
          {/* Top Bar */}
          <View style={styles.topBar}>
            {/* Close X (round, 44x44, surface fill) */}
            <Pressable
              onPress={onClose}
              accessibilityRole="button"
              accessibilityLabel="Close search"
              style={({ pressed }) => [styles.roundIconBtn, { opacity: pressed ? 0.6 : 1 }]}
            >
              <SymbolIcon icon={X} size={20} color={colors.textPrimary} strokeWidth={1.75} />
            </Pressable>

            {/* Pill Search Field (surface fill, 44 tall, magnifying glass) */}
            <View style={styles.searchPill}>
              <SymbolIcon icon={SearchIcon} size={18} color={colors.textSecondary} strokeWidth={1.75} />
              <TextInput
                value={query}
                onChangeText={setQuery}
                placeholder="Search"
                placeholderTextColor={colors.textSecondary}
                autoFocus
                style={styles.searchInput}
              />
              {query.length > 0 && (
                <Pressable
                  onPress={() => setQuery('')}
                  accessibilityRole="button"
                  accessibilityLabel="Clear search text"
                  hitSlop={10}
                  style={styles.clearBtn}
                >
                  <SymbolIcon icon={X} size={12} color={colors.textSecondary} strokeWidth={2} />
                </Pressable>
              )}
            </View>

            {/* Filter sliders button on right (44x44, surface) */}
            <Pressable
              accessibilityRole="button"
              accessibilityLabel="Filter results"
              style={({ pressed }) => [styles.roundIconBtn, { opacity: pressed ? 0.6 : 1 }]}
            >
              <SymbolIcon icon={SlidersHorizontal} size={18} color={colors.textPrimary} strokeWidth={1.75} />
            </Pressable>
          </View>

          {/* Results List */}
          <FlatList
            data={results}
            keyExtractor={(item) => item.id}
            renderItem={({ item }) => {
              const isGroup = item.kind === 'group';
              const isAgent = item.kind === 'agent';
              const isMessage = item.kind === 'message';

              const typeLabel = isGroup ? 'Group' : isAgent ? 'Agent' : 'Message';

              const handlePress = () => {
                onClose();
                if (isGroup) {
                  onSelectGroup?.(item.group.id);
                } else if (isAgent) {
                  onSelect(item.agent.id);
                } else if (isMessage && item.targetId) {
                  onSelect(item.targetId);
                }
              };

              return (
                <Pressable
                  onPress={handlePress}
                  accessibilityRole="button"
                  accessibilityLabel={`${item.title}, ${typeLabel}`}
                  style={({ pressed }) => [styles.row, { opacity: pressed ? 0.6 : 1 }]}
                >
                  {/* 60pt avatar/mark */}
                  <View style={styles.avatarContainer}>
                    {isGroup ? (
                      <ClusterAvatar size={60} members={item.group.members ?? []} />
                    ) : (
                      <AgentAvatar
                        avatar={isAgent ? item.agent.avatar : item.agent?.avatar}
                        name={item.title}
                        size={60}
                      />
                    )}
                  </View>

                  {/* Title 20/500, subtitle/preview 17/400 with bold match */}
                  <View style={styles.rowContent}>
                    <Text numberOfLines={1} style={styles.resultTitle}>
                      {item.title}
                    </Text>
                    <HighlightedText text={item.subtitle} query={query} />
                  </View>

                  {/* Right-aligned type label 15pt textSecondary */}
                  <Text style={styles.typeLabel}>{typeLabel}</Text>
                </Pressable>
              );
            }}
            ListEmptyComponent={
              <View style={styles.emptyContainer}>
                <Text style={styles.emptyText}>
                  {q ? 'No results found' : 'Type to search agents and messages'}
                </Text>
              </View>
            }
            contentContainerStyle={{
              paddingHorizontal: space.lg,
              paddingTop: space.sm,
              paddingBottom: insets.bottom + 24,
            }}
            keyboardShouldPersistTaps="handled"
          />
        </View>
      </View>
    </Modal>
  );
}

const styles = StyleSheet.create({
  overlay: {
    flex: 1,
    backgroundColor: colors.overlay,
    justifyContent: 'flex-end',
  },
  sheetContainer: {
    flex: 1,
    backgroundColor: colors.surfaceRaised,
    marginTop: 48,
    borderTopLeftRadius: radius.sheet,
    borderTopRightRadius: radius.sheet,
    overflow: 'hidden',
  },
  topBar: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingHorizontal: space.lg,
    paddingBottom: space.md,
    gap: space.sm,
  },
  roundIconBtn: {
    width: 44,
    height: 44,
    borderRadius: radius.pill,
    backgroundColor: colors.surface,
    alignItems: 'center',
    justifyContent: 'center',
  },
  searchPill: {
    flex: 1,
    height: 44,
    borderRadius: radius.pill,
    backgroundColor: colors.surface,
    flexDirection: 'row',
    alignItems: 'center',
    paddingHorizontal: 14,
    gap: space.sm,
  },
  searchInput: {
    flex: 1,
    fontSize: 17,
    lineHeight: 22,
    color: colors.textPrimary,
    paddingVertical: 0,
  },
  clearBtn: {
    width: 24,
    height: 24,
    borderRadius: 12,
    backgroundColor: colors.divider,
    alignItems: 'center',
    justifyContent: 'center',
  },
  emptyContainer: {
    paddingVertical: 64,
    alignItems: 'center',
    justifyContent: 'center',
  },
  emptyText: {
    fontSize: 17,
    lineHeight: 22,
    color: colors.textSecondary,
  },
  row: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingVertical: 14,
    borderBottomWidth: StyleSheet.hairlineWidth,
    borderBottomColor: colors.divider,
  },
  avatarContainer: {
    marginRight: space.md,
    width: 60,
    height: 60,
    alignItems: 'center',
    justifyContent: 'center',
  },
  rowContent: {
    flex: 1,
    minWidth: 0,
    paddingRight: space.sm,
  },
  resultTitle: {
    fontSize: 20,
    lineHeight: 26,
    fontWeight: '500',
    color: colors.textPrimary,
    marginBottom: 2,
  },
  resultSubtitle: {
    fontSize: 17,
    lineHeight: 22,
    fontWeight: '400',
    color: colors.textSecondary,
  },
  resultSubtitleBold: {
    fontSize: 17,
    lineHeight: 22,
    fontWeight: '700',
    color: colors.textPrimary,
  },
  typeLabel: {
    fontSize: 15,
    lineHeight: 20,
    fontWeight: '400',
    color: colors.textSecondary,
    marginLeft: 8,
  },
});
