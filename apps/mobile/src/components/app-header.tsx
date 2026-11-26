import React, { type ReactNode } from 'react';
import { StyleSheet, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { LinearGradient } from 'expo-linear-gradient';

import { colors, space } from '@/theme';

export const HEADER_BAR_HEIGHT = 44;
/** 6.1: the top fade is ~120pt of the screen background dissolving to nothing. */
export const HEADER_FADE_HEIGHT = 120;

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
 * The vertical space a screen must reserve above its content so nothing hides
 * under the floating header. Every screen that renders an `AppHeader` passes
 * this to its scroll container's `paddingTop` — the two numbers are computed
 * from the same source, so they cannot drift.
 */
export function useHeaderInset(bottomInset = 0): number {
  const insets = useSafeAreaInsets();
  return insets.top + space.sm + HEADER_BAR_HEIGHT + space.sm + bottomInset;
}

/**
 * 6.1 Floating header conforming to design.md:
 * - Overlays the screen instead of pushing content down: the page scrolls
 *   underneath, with a soft background-to-transparent fade at the top so
 *   passing content dissolves instead of ending at a hard edge.
 * - Left: round back button (44x44, grey surface, floating shadow).
 * - Center: title pill or clean text.
 * - Right: round button or primary pill action.
 */
export function AppHeader({ left, center, right, bottomInset = 0 }: Props) {
  const inset = useHeaderInset(bottomInset);
  // Safe-area + the gap above the bar, and the gap below it.
  const topPad = inset - HEADER_BAR_HEIGHT - space.sm;
  const bottomPad = space.sm + bottomInset;

  return (
    <View pointerEvents="box-none" style={styles.overlay}>
      <LinearGradient
        pointerEvents="none"
        style={[styles.fade, { height: HEADER_FADE_HEIGHT }]}
        colors={[colors.background, colors.backgroundFade]}
        start={{ x: 0, y: 0 }}
        end={{ x: 0, y: 1 }}
      />
      <View style={{ paddingTop: topPad, paddingBottom: bottomPad, paddingHorizontal: space.lg }}>
        <View style={styles.bar}>
          <View style={styles.leftSlot}>{left}</View>
          {center ? <View style={styles.centerSlot}>{center}</View> : null}
          <View style={styles.rightSlot}>{right}</View>
        </View>
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  overlay: {
    position: 'absolute',
    top: 0,
    left: 0,
    right: 0,
    zIndex: 20,
  },
  fade: {
    position: 'absolute',
    top: 0,
    left: 0,
    right: 0,
  },
  bar: {
    height: HEADER_BAR_HEIGHT,
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
