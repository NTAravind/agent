import React from 'react';
import type { TabTriggerSlotProps } from 'expo-router/ui';
import type { LucideIcon } from 'lucide-react-native';
import { Pressable, StyleSheet, Text, View } from 'react-native';
import { colors, radius } from '@/theme';

export type TabButtonProps = Omit<TabTriggerSlotProps, 'style'> & {
  icon: LucideIcon;
  label: string;
  badge?: number;
  isFocused?: boolean;
};

/**
 * Modern Pill Nav Dock Tab Button (conforming to design.md)
 */
export const TabButton = React.forwardRef<any, TabButtonProps>(
  function TabButton({ icon: Icon, label, badge, isFocused, ...props }, ref) {
    const iconColor = isFocused ? colors.textPrimary : colors.textSecondary;
    const textColor = isFocused ? colors.textPrimary : colors.textSecondary;

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
          <Icon size={19} color={iconColor} strokeWidth={isFocused ? 2.2 : 1.75} />
          {badge && badge > 0 ? (
            <View style={styles.badge}>
              <Text style={styles.badgeText}>
                {badge > 9 ? '9+' : badge}
              </Text>
            </View>
          ) : null}
        </View>
        <Text
          numberOfLines={1}
          style={[
            styles.label,
            { color: textColor, fontWeight: isFocused ? '600' : '400' },
          ]}
        >
          {label}
        </Text>
      </Pressable>
    );
  },
);

const styles = StyleSheet.create({
  button: {
    flex: 1,
    height: 48,
    borderRadius: radius.pill,
    flexDirection: 'column',
    alignItems: 'center',
    justifyContent: 'center',
    paddingVertical: 3,
    marginHorizontal: 1,
  },
  buttonFocused: {
    backgroundColor: colors.surface,
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
    top: -3,
    right: -7,
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
  label: {
    fontSize: 10,
    lineHeight: 13,
    marginTop: 2,
  },
});
