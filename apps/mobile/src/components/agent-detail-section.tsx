import type { ReactNode } from 'react';
import { StyleSheet, Text, View } from 'react-native';

import { GroupedCard, SectionLabel } from '@/components/design-system';
import { colors, space } from '@/theme';

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
 * Reusable section wrapper for agent detail screen conforming to design.md.
 * Renders a small section label, then a grouped card with content.
 */
export function AgentDetailSection({ label, children, action, secondaryAction }: Props) {
  return (
    <View style={styles.container}>
      <View style={styles.header}>
        <SectionLabel>{label}</SectionLabel>
        <View style={styles.actions}>
          {secondaryAction}
          {action}
        </View>
      </View>
      <GroupedCard>
        <View style={styles.content}>
          {children}
        </View>
      </GroupedCard>
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    width: '100%',
    // The label lives in the header row, so the row-to-card gap is what puts
    // the label 8pt above its card (DESIGN.md 6.6).
    gap: space.sm,
  },
  header: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingHorizontal: space.xs,
  },
  actions: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: space.sm,
  },
  content: {
    padding: space.md,
  },
});
