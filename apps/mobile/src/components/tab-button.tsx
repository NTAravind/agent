import React from 'react';
import type { TabTriggerSlotProps } from 'expo-router/ui';
import type { LucideIcon } from 'lucide-react-native';
import { Pressable, StyleSheet, Text, View } from 'react-native';
import { colors, radius } from '@/theme';
import { SymbolIcon } from '@/components/symbol-icon';

export type TabButtonProps = Omit<TabTriggerSlotProps, 'style'> & {
  icon: LucideIcon;
  label: string; // kept for accessibility only (not rendered)
  badge?: number;
  isFocused?: boolean;
};

/**
 * Icon-only tab button for the black pill nav dock.
 */
export const TabButton = React.forwardRef<any, TabButtonProps>(
  function TabButton({ icon: Icon, label, badge, isFocused, ...props }, ref) {
    return (
      <Pressable
        {...props}
        ref={ref as any}
        accessibilityRole="tab"
        accessibilityState={{ selected: Boolean(isFocused) }}
        accessibilityLabel={label}
        hitSlop={{ top: 8, bottom: 8, left: 4, right: 4 }}
        style={({ pressed }) => [
          styles.button,
          isFocused ? styles.buttonFocused : styles.buttonUnfocused,
          { opacity: pressed ? 0.8 : isFocused ? 1 : 0.6 },
        ]}
      >
        <View style={styles.iconContainer}>
          <SymbolIcon
            icon={Icon}
            size={22}
            color={colors.onPrimary}
            strokeWidth={2}
          />
          {badge && badge > 0 ? (
            <View style={styles.badge}>
              <Text style={styles.badgeText}>{badge > 9 ? '9+' : badge}</Text>
            </View>
          ) : null}
        </View>
      </Pressable>
    );
  },
);

const styles = StyleSheet.create({
  button: {
    flex: 1,
    height: 40,
    maxWidth: 44,
    borderRadius: 20,
    alignItems: 'center',
    justifyContent: 'center',
    marginHorizontal: 2,
  },
  buttonFocused: {
    backgroundColor: '#3A3A3C',
  },
  buttonUnfocused: {
    backgroundColor: 'transparent',
  },
  iconContainer: {
    position: 'relative',
    alignItems: 'center',
    justifyContent: 'center',
  },
  badge: {
    position: 'absolute',
    top: -4,
    right: -8,
    minWidth: 14,
    height: 14,
    paddingHorizontal: 3,
    borderRadius: radius.pill,
    backgroundColor: colors.danger,
    alignItems: 'center',
    justifyContent: 'center',
  },
  badgeText: {
    color: colors.onPrimary,
    fontSize: 10,
    lineHeight: 12,
    fontWeight: '600',
    fontVariant: ['tabular-nums'],
  },
});