import React, { type ReactNode } from 'react';
import { StyleSheet, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { colors, space } from '@/theme';

type Props = {
  /** Left-hand control (usually RoundButton with ChevronLeft or X). */
  left?: ReactNode;
  /** Centred content — title pill or text. */
  center?: ReactNode;
  /** Right-hand control (round button, pill action, etc.). */
  right?: ReactNode;
  /** Extra bottom padding. */
  bottomInset?: number;
};

/**
 * 6.1 Floating header conforming to design.md:
 * - No navigation bar background.
 * - Left: round back button (44x44, surfaceRaised, floating shadow).
 * - Center: title pill or clean text.
 * - Right: round button or primary pill action.
 */
export function AppHeader({ left, center, right, bottomInset = 0 }: Props) {
  const insets = useSafeAreaInsets();

  return (
    <View
      style={[
        styles.container,
        {
          paddingTop: insets.top + space.sm,
          paddingBottom: space.sm + bottomInset,
        },
      ]}
    >
      <View style={styles.bar}>
        <View style={styles.leftSlot}>{left}</View>
        {center ? <View style={styles.centerSlot}>{center}</View> : null}
        <View style={styles.rightSlot}>{right}</View>
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    backgroundColor: 'transparent',
    paddingHorizontal: space.lg,
  },
  bar: {
    height: 44,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    gap: space.sm,
  },
  leftSlot: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'flex-start',
    flexShrink: 0,
  },
  centerSlot: {
    flex: 1,
    alignItems: 'center',
    justifyContent: 'center',
  },
  rightSlot: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'flex-end',
    flexShrink: 0,
  },
});
