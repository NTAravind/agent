import { useState } from 'react';
import { Image } from 'expo-image';
import { Button, Card, Typography } from 'heroui-native';
import { Linking, Pressable, ScrollView, View } from 'react-native';
import Svg, { Circle, Polyline, Rect } from 'react-native-svg';
import type { CanvasAction, CanvasSpec } from '@agent/shared';

/**
 * Native renderer for the Canvas component catalog (UI_UX_SPEC.md section 4).
 * Canvas actions are a fixed enum — nothing here evals anything.
 * Unknown or malformed nodes render a muted card, never a crash.
 */

type Node = CanvasSpec['root'];

export type CanvasActionHandler = (action: CanvasAction, payload: unknown) => void;

const PALETTE = ['#6366f1', '#22c55e', '#f59e0b', '#ef4444', '#06b6d4', '#a855f7'];

function UnknownBlock({ node }: { node: unknown }) {
  return (
    <Card className="rounded-xl border border-border bg-surface">
      <Card.Body>
        <Typography type="body-sm" color="muted">
          Can&apos;t display this block ({String((node as { type?: string })?.type ?? 'unknown')}).
        </Typography>
      </Card.Body>
    </Card>
  );
}

function StatBlock({ node }: { node: Extract<Node, { type: 'stat' }> }) {
  return (
    <Card className="flex-1 rounded-xl border border-border bg-surface">
      <Card.Body className="gap-1">
        <Typography type="body-xs" color="muted">
          {node.label}
        </Typography>
        <Typography type="h3">{node.value}</Typography>
        {node.delta ? (
          <Typography
            type="body-xs"
            className={node.delta.startsWith('-') ? 'text-danger' : 'text-success'}
          >
            {node.delta}
          </Typography>
        ) : null}
      </Card.Body>
    </Card>
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
    <View className="gap-2">
      {label ? (
        <Typography type="body-xs" color="muted">
          {label}
        </Typography>
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
        <View className="mt-1 flex-row justify-between">
          {data.slice(0, 6).map((point, index) => (
            <Pressable key={index} onPress={() => setSelected(index)} hitSlop={6}>
              <Typography type="body-xs" color="muted">
                {String(point.x)}
              </Typography>
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
    <View className="overflow-hidden rounded-xl border border-border">
      <View className="flex-row bg-surface">
        <View className="w-28 border-b border-r border-border p-2">
          <Typography type="body-xs" color="muted">
            {first}
          </Typography>
        </View>
        <ScrollView horizontal>
          <View>
            <View className="flex-row border-b border-border">
              {rest.map((column, index) => (
                <View key={index} className="w-28 p-2">
                  <Typography type="body-xs" color="muted">
                    {column}
                  </Typography>
                </View>
              ))}
            </View>
            {node.rows.map((row, rowIndex) => (
              <View key={rowIndex} className="flex-row">
                {rest.map((_, columnIndex) => (
                  <View key={columnIndex} className="w-28 p-2">
                    <Typography type="body-sm">{String(row[columnIndex + 1] ?? '')}</Typography>
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
            <View key={rowIndex} className="flex-row border-t border-border">
              <View className="w-28 p-2">
                <Typography type="body-sm" className="font-medium">
                  {String(row[0] ?? '')}
                </Typography>
              </View>
              {rest.map((_, columnIndex) => (
                <View key={columnIndex} className="w-28 p-2">
                  <Typography type="body-sm">{String(row[columnIndex + 1] ?? '')}</Typography>
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
    <View className="overflow-hidden rounded-xl border border-border">
      {node.items.map((item, index) => {
        const content = (
          <View className={`gap-0.5 p-3 ${index > 0 ? 'border-t border-border' : ''}`}>
            <Typography type="body-sm" className="font-medium">
              {item.title}
            </Typography>
            {item.subtitle ? (
              <Typography type="body-xs" color="muted" numberOfLines={2}>
                {item.subtitle}
              </Typography>
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
    <Button
      size="sm"
      variant="secondary"
      className="self-start"
      onPress={() => onAction(node.action, node.payload)}
    >
      <Button.Label>{node.label}</Button.Label>
    </Button>
  );
}

function TabsBlock({ node, onAction }: { node: Extract<Node, { type: 'tabs' }>; onAction: CanvasActionHandler }) {
  const [selected, setSelected] = useState(0);
  const current = node.tabs[Math.min(selected, node.tabs.length - 1)];
  return (
    <View className="gap-3">
      <View className="flex-row gap-2">
        {node.tabs.map((tab, index) => (
          <Button
            key={index}
            size="sm"
            variant={index === selected ? 'primary' : 'ghost'}
            onPress={() => setSelected(index)}
          >
            <Button.Label>{tab.label}</Button.Label>
          </Button>
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
        <Typography type="body-sm" className="leading-6 text-foreground">
          {component.text}
        </Typography>
      );
    case 'image':
      return (
        <Image
          source={{ uri: component.uri }}
          style={{ width: '100%', height: 180, borderRadius: 12 }}
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
          className={component.direction === 'row' ? 'flex-row flex-wrap gap-3' : 'gap-3'}
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
    <View className="gap-3">
      <CanvasNode node={spec.root} onAction={onAction} />
    </View>
  );
}
