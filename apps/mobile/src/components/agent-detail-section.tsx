import type { ReactNode } from 'react';
import { View } from 'react-native';
import { Card, Typography } from 'heroui-native';

type Props = {
  /** Section label (e.g., "Agent info", "Tools") */
  label: string;
  /** Content inside the card */
  children: ReactNode;
  /** Optional action button on the right of the label row */
  action?: ReactNode;
  /** Optional secondary action */
  secondaryAction?: ReactNode;
};

/**
 * Reusable section wrapper for agent detail screen.
 * Renders a small section label, then a rounded-xl card with content.
 * Supports action buttons (e.g., "Edit", "Add integrations") aligned right.
 */
export function AgentDetailSection({ label, children, action, secondaryAction }: Props) {
  return (
    <View className="gap-2 w-full">
      <View className="flex-row items-center justify-between px-1">
        <Typography type="body-xs" color="muted" weight="semibold">
          {label.toUpperCase()}
        </Typography>
        <View className="flex-row items-center gap-2">
          {secondaryAction}
          {action}
        </View>
      </View>
      <Card className="rounded-xl p-3 border border-border bg-surface">
        {children}
      </Card>
    </View>
  );
}