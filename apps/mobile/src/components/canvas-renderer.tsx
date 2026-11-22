import { useState } from 'react';
import { Image } from 'expo-image';
import { Linking, Pressable, ScrollView, StyleSheet, Text, View } from 'react-native';
import Svg, { Circle, Polyline, Rect } from 'react-native-svg';
import type { CanvasAction, CanvasSpec } from '@agent/shared';

import { PillButton } from '@/components/design-system';
import { colors, radius, space, typography } from '@/theme';

/**
 * Native renderer for the Canvas component catalog (UI_UX_SPEC.md section 4).
 * Canvas actions are a fixed enum — nothing here evals anything.
 * Unknown or malformed nodes render a muted card, never a crash.
 */

type Node = CanvasSpec['root'];

export type CanvasActionHandler = (action: CanvasAction, payload: unknown) => void;

const PALETTE = [
  colors.mark.blue,
  colors.mark.green,
  colors.mark.amber,
  colors.mark.red,
  colors.mark.teal,
  colors.mark.purple,
];

function UnknownBlock({ node }: { node: unknown }) {
  return (
    <View style={styles.card}>
      <Text style={styles.mutedText}>
        Can&apos;t display this block ({String((node as { type?: string })?.type ?? 'unknown')}).
      </Text>
    </View>
  );
}

function StatBlock({ node }: { node: Extract<Node, { type: 'stat' }> }) {
  const isNegative = node.delta?.startsWith('-');
  return (
    <View style={[styles.card, { flex: 1 }]}>
      <Text style={styles.statLabel}>
        {node.label}
      </Text>
      <Text style={styles.statValue}>{node.value}</Text>
      {node.delta ? (
        <Text style={[styles.statDelta, { color: isNegative ? colors.recording : colors.success }]}>
          {node.delta}
        </Text>
      ) : null}
    </View>
  );
}

function ChartBlock({ node }: { node: Extract<Node, { type: 'chart' }> }) {
  const [selected, setSelected] = useState<number | null>(null);
  const { data, kind } = node;
  const values = data.map((point) => point.y);
  const min = Math.min(...values);
  const max = Math.max(...values);
  const span = max - min || 1;
  const W = 320;
  const H = 160;
  const pad = 8;

  const points = data.map((point, index) => {
    const x = pad + (index * (W - pad * 2)) / Math.max(data.length - 1, 1);
    const y = H - pad - ((point.y - min) / span) * (H - pad * 2);
    return { x, y, point };
  });

  const label = selected !== null ? `${String(data[selected].x)}: ${String(data[selected].y)}` : null;

  return (
    <View style={styles.chartContainer}>
      {label ? (
        <Text style={styles.mutedText}>
          {label}
        </Text>
      ) : null}
      <View>
        <Svg width="100%" height={H} viewBox={`0 0 ${W} ${H}`} preserveAspectRatio="none">
          {kind === 'line' ? (
            <Polyline
              points={points.map((p) => `${p.x},${p.y}`).join(' ')}
              fill="none"
              stroke={PALETTE[0]}
              strokeWidth={2}
              vectorEffect="non-scaling-stroke"
            />
          ) : null}
          {kind === 'bar'
            ? points.map((p, index) => {
                const barWidth = ((W - pad * 2) / data.length) * 0.6;
                return (
                  <Rect
                    key={index}
                    x={p.x - barWidth / 2}
                    y={p.y}
                    width={barWidth}
                    height={Math.max(H - pad - p.y, 1)}
                    fill={PALETTE[index % PALETTE.length]}
                    rx={2}
                  />
                );
              })
            : null}
          {kind === 'pie'
            ? (() => {
                const total = values.reduce((sum, value) => sum + Math.max(value, 0), 0) || 1;
                const r = 60;
                const cx = W / 2;
                const cy = H / 2;
                const circumference = 2 * Math.PI * r;
                let offset = 0;
                return values.map((value, index) => {
                  const fraction = Math.max(value, 0) / total;
                  const dash = fraction * circumference;
                  const segment = (
                    <Circle
                      key={index}
                      cx={cx}
                      cy={cy}
                      r={r}
                      fill="none"
                      stroke={PALETTE[index % PALETTE.length]}
                      strokeWidth={24}
                      strokeDasharray={`${dash} ${circumference - dash}`}
                      strokeDashoffset={-offset}
                    />
                  );
                  offset += dash;
                  return segment;
                });
              })()
            : null}
        </Svg>
        <View style={styles.chartLabelsRow}>
          {data.slice(0, 6).map((point, index) => (
            <Pressable key={index} onPress={() => setSelected(index)} hitSlop={6}>
              <Text style={styles.mutedText}>
                {String(point.x)}
              </Text>
            </Pressable>
          ))}
        </View>
      </View>
    </View>
  );
}

function TableBlock({ node }: { node: Extract<Node, { type: 'table' }> }) {
  const [first, ...rest] = node.columns;
  return (
    <View style={styles.tableContainer}>
      <View style={styles.tableHeaderRow}>
        <View style={[styles.tableCell, styles.tableStickyCell]}>
          <Text style={styles.mutedText}>
            {first}
          </Text>
        </View>
        <ScrollView horizontal>
          <View>
            <View style={styles.tableRow}>
              {rest.map((column, index) => (
                <View key={index} style={styles.tableCell}>
                  <Text style={styles.mutedText}>
                    {column}
                  </Text>
                </View>
              ))}
            </View>
            {node.rows.map((row, rowIndex) => (
              <View key={rowIndex} style={styles.tableRow}>
                {rest.map((_, columnIndex) => (
                  <View key={columnIndex} style={styles.tableCell}>
                    <Text style={styles.tableCellText}>{String(row[columnIndex + 1] ?? '')}</Text>
                  </View>
                ))}
              </View>
            ))}
          </View>
        </ScrollView>
      </View>
      <ScrollView horizontal>
        <View>
          {node.rows.map((row, rowIndex) => (
            <View key={rowIndex} style={[styles.tableRow, styles.tableBorderTop]}>
              <View style={[styles.tableCell, styles.tableStickyCell]}>
                <Text style={styles.tableCellBold}>
                  {String(row[0] ?? '')}
                </Text>
              </View>
              {rest.map((_, columnIndex) => (
                <View key={columnIndex} style={styles.tableCell}>
                  <Text style={styles.tableCellText}>{String(row[columnIndex + 1] ?? '')}</Text>
                </View>
              ))}
            </View>
          ))}
        </View>
      </ScrollView>
    </View>
  );
}

function ListBlock({ node }: { node: Extract<Node, { type: 'list' }> }) {
  return (
    <View style={styles.listContainer}>
      {node.items.map((item, index) => {
        const content = (
          <View style={[styles.listItem, index > 0 && styles.listBorderTop]}>
            <Text style={styles.listTitle}>
              {item.title}
            </Text>
            {item.subtitle ? (
              <Text style={styles.mutedText} numberOfLines={2}>
                {item.subtitle}
              </Text>
            ) : null}
          </View>
        );
        return item.link ? (
          <Pressable key={index} onPress={() => void Linking.openURL(item.link!)}>
            {content}
          </Pressable>
        ) : (
          <View key={index}>{content}</View>
        );
      })}
    </View>
  );
}

function ButtonBlock({
  node,
  onAction,
}: {
  node: Extract<Node, { type: 'button' }>;
  onAction: CanvasActionHandler;
}) {
  return (
    <View style={{ alignSelf: 'flex-start' }}>
      <PillButton
        variant="secondary"
        label={node.label}
        onPress={() => onAction(node.action, node.payload)}
      />
    </View>
  );
}

function TabsBlock({ node, onAction }: { node: Extract<Node, { type: 'tabs' }>; onAction: CanvasActionHandler }) {
  const [selected, setSelected] = useState(0);
  const current = node.tabs[Math.min(selected, node.tabs.length - 1)];
  return (
    <View style={styles.blockGap}>
      <View style={styles.tabsRow}>
        {node.tabs.map((tab, index) => (
          <PillButton
            key={index}
            variant={index === selected ? 'primary' : 'secondary'}
            label={tab.label}
            onPress={() => setSelected(index)}
          />
        ))}
      </View>
      <CanvasNode node={current.child as Node} onAction={onAction} />
    </View>
  );
}

export function CanvasNode({ node, onAction }: { node: Node | unknown; onAction: CanvasActionHandler }) {
  if (typeof node !== 'object' || node === null || !('type' in node) || typeof node.type !== 'string') {
    return <UnknownBlock node={node} />;
  }
  const component = node as Node;
  switch (component.type) {
    case 'stat':
      return <StatBlock node={component} />;
    case 'chart':
      return <ChartBlock node={component} />;
    case 'table':
      return <TableBlock node={component} />;
    case 'list':
      return <ListBlock node={component} />;
    case 'markdown':
      return (
        <Text style={styles.markdownText}>
          {component.text}
        </Text>
      );
    case 'image':
      return (
        <Image
          source={{ uri: component.uri }}
          style={styles.image}
          contentFit="cover"
          accessibilityLabel={component.alt}
        />
      );
    case 'button':
      return <ButtonBlock node={component} onAction={onAction} />;
    case 'tabs':
      return <TabsBlock node={component} onAction={onAction} />;
    case 'stack':
      return (
        <View
          style={[
            styles.stackContainer,
            component.direction === 'row' ? styles.stackRow : styles.stackColumn,
          ]}
        >
          {component.children.map((child, index) => (
            <CanvasNode key={index} node={child as Node} onAction={onAction} />
          ))}
        </View>
      );
    default:
      return <UnknownBlock node={node} />;
  }
}

export function CanvasView({
  spec,
  onAction,
}: {
  spec: CanvasSpec;
  onAction: CanvasActionHandler;
}) {
  return (
    <View style={styles.blockGap}>
      <CanvasNode node={spec.root} onAction={onAction} />
    </View>
  );
}

const styles = StyleSheet.create({
  card: {
    borderRadius: radius.card,
    backgroundColor: colors.surface,
    padding: space.md,
  },
  mutedText: {
    fontSize: 13,
    lineHeight: 18,
    color: colors.textSecondary,
  },
  statLabel: {
    fontSize: 13,
    lineHeight: 18,
    color: colors.textSecondary,
    marginBottom: 4,
  },
  statValue: {
    fontSize: 24,
    lineHeight: 28,
    fontWeight: '600',
    color: colors.textPrimary,
  },
  statDelta: {
    fontSize: 13,
    lineHeight: 18,
    fontWeight: '500',
    marginTop: 2,
  },
  chartContainer: {
    gap: space.sm,
  },
  chartLabelsRow: {
    marginTop: 4,
    flexDirection: 'row',
    justifyContent: 'space-between',
  },
  tableContainer: {
    borderRadius: radius.card,
    backgroundColor: colors.surface,
    overflow: 'hidden',
  },
  tableHeaderRow: {
    flexDirection: 'row',
  },
  tableStickyCell: {
    borderRightWidth: StyleSheet.hairlineWidth,
    borderRightColor: colors.divider,
  },
  tableCell: {
    width: 112,
    padding: space.sm,
  },
  tableRow: {
    flexDirection: 'row',
  },
  tableBorderTop: {
    borderTopWidth: StyleSheet.hairlineWidth,
    borderTopColor: colors.divider,
  },
  tableCellText: {
    fontSize: 14,
    lineHeight: 20,
    color: colors.textPrimary,
  },
  tableCellBold: {
    fontSize: 14,
    lineHeight: 20,
    fontWeight: '500',
    color: colors.textPrimary,
  },
  listContainer: {
    borderRadius: radius.card,
    backgroundColor: colors.surface,
    overflow: 'hidden',
  },
  listItem: {
    padding: space.md,
    gap: 2,
  },
  listBorderTop: {
    borderTopWidth: StyleSheet.hairlineWidth,
    borderTopColor: colors.divider,
  },
  listTitle: {
    fontSize: 15,
    lineHeight: 20,
    fontWeight: '500',
    color: colors.textPrimary,
  },
  tabsRow: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: space.sm,
  },
  markdownText: {
    ...typography.body,
    lineHeight: 24,
  },
  image: {
    width: '100%',
    height: 180,
    borderRadius: radius.card,
  },
  stackContainer: {
    gap: space.md,
  },
  stackRow: {
    flexDirection: 'row',
    flexWrap: 'wrap',
  },
  stackColumn: {
    flexDirection: 'column',
  },
  blockGap: {
    gap: space.md,
  },
});
