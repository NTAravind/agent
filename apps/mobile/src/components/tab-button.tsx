import React from 'react';
import type { TabTriggerSlotProps } from 'expo-router/ui';
import type { LucideIcon } from 'lucide-react-native';
import { Pressable, StyleSheet, Text, View } from 'react-native';
import { colors, radius } from '@/theme';

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
        style={({ pressed }) => [
          styles.button,
          isFocused ? styles.buttonFocused : styles.buttonUnfocused,
          { opacity: pressed ? 0.6 : 1 },
        ]}
      >
        <View style={styles.iconContainer}>
          <Icon
            size={22}
            color={colors.onPrimary}
            strokeWidth={isFocused ? 2.4 : 1.75}
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
    height: 44,
    borderRadius: radius.pill,
    alignItems: 'center',
    justifyContent: 'center',
    marginHorizontal: 1,
  },
  buttonFocused: {
    backgroundColor: 'rgba(255,255,255,0.18)',
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
    backgroundColor: colors.recording,
    alignItems: 'center',
    justifyContent: 'center',
  },
  badgeText: {
    color: colors.onPrimary,
    fontSize: 9,
    fontWeight: '700',
  },
});