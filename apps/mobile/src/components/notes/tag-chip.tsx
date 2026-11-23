import React from 'react';
import { Pressable, StyleSheet, Text, type StyleProp, type ViewStyle } from 'react-native';
import { colors, radius } from '@/theme';

type Props = {
  label: string;
  onPress?: () => void;
  selected?: boolean;
  style?: StyleProp<ViewStyle>;
};

export function TagChip({ label, onPress, selected = false, style }: Props) {
  const cleanLabel = label.startsWith('#') ? label.slice(1) : label;

  return (
    <Pressable
      onPress={onPress}
      disabled={!onPress}
      accessibilityRole={onPress ? 'button' : undefined}
      accessibilityLabel={`Tag ${cleanLabel}`}
      style={({ pressed }) => [
        styles.chip,
        selected && styles.chipSelected,
        Boolean(onPress) && pressed && styles.chipPressed,
        style,
      ]}
    >
      <Text style={[styles.text, selected && styles.textSelected]}>
        {cleanLabel}
      </Text>
    </Pressable>
  );
}

const styles = StyleSheet.create({
  chip: {
    paddingHorizontal: 10,
    paddingVertical: 4,
    borderRadius: radius.pill,
    backgroundColor: colors.surfaceRaised,
    borderWidth: StyleSheet.hairlineWidth,
    borderColor: colors.divider,
    alignSelf: 'flex-start',
  },
  chipSelected: {
    backgroundColor: colors.primary,
    borderColor: colors.primary,
  },
  chipPressed: {
    opacity: 0.7,
  },
  text: {
    fontSize: 12,
    lineHeight: 16,
    fontWeight: '500',
    color: colors.textSecondary,
  },
  textSelected: {
    color: colors.onPrimary,
  },
});
