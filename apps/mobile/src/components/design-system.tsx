import React from 'react';
import {
  Pressable,
  StyleSheet,
  Text,
  View,
  type PressableProps,
  type StyleProp,
  type ViewStyle,
  type TextStyle,
} from 'react-native';
import type { LucideIcon } from 'lucide-react-native';
import { colors, radius, shadow, space, typography } from '@/theme';

/**
 * 6.2 Round icon button:
 * 44x44 surfaceRaised with floating shadow.
 * Inside sheets, round buttons use surface fill and no shadow.
 */
export function RoundButton({
  icon: Icon,
  onPress,
  inSheet = false,
  size = 44,
  accessibilityLabel,
  style,
}: {
  icon: LucideIcon;
  onPress?: () => void;
  inSheet?: boolean;
  size?: number;
  accessibilityLabel?: string;
  style?: StyleProp<ViewStyle>;
}) {
  return (
    <Pressable
      onPress={onPress}
      accessibilityRole="button"
      accessibilityLabel={accessibilityLabel}
      style={({ pressed }) => [
        {
          width: size,
          height: size,
          borderRadius: radius.pill,
          backgroundColor: inSheet ? colors.surface : colors.surfaceRaised,
          alignItems: 'center',
          justifyContent: 'center',
          opacity: pressed ? 0.6 : 1,
        },
        inSheet ? null : shadow.floating,
        style,
      ]}
    >
      <Icon size={22} color={colors.textPrimary} strokeWidth={1.75} />
    </Pressable>
  );
}

/**
 * 6.2 Primary pill ("Save") & Secondary / completed pill ("Added")
 */
export function PillButton({
  label,
  onPress,
  variant = 'primary',
  disabled = false,
  style,
}: {
  label: string;
  onPress?: () => void;
  variant?: 'primary' | 'secondary';
  disabled?: boolean;
  style?: StyleProp<ViewStyle>;
}) {
  const isPrimary = variant === 'primary';
  return (
    <Pressable
      onPress={onPress}
      disabled={disabled}
      accessibilityRole="button"
      accessibilityLabel={label}
      style={({ pressed }) => [
        {
          height: 44,
          paddingHorizontal: 24,
          borderRadius: radius.pill,
          backgroundColor: isPrimary ? colors.primary : colors.surface,
          alignItems: 'center',
          justifyContent: 'center',
          opacity: pressed ? 0.6 : disabled ? 0.5 : 1,
        },
        style,
      ]}
    >
      <Text
        style={{
          fontSize: 17,
          lineHeight: 22,
          fontWeight: '600',
          color: isPrimary ? colors.onPrimary : colors.textPrimary,
        }}
      >
        {label}
      </Text>
    </Pressable>
  );
}

/**
 * 6.2 Text action: link color, 17/400, leading outline icon when relevant
 * ("+ Add routine", "Add member", "Reset to default"). No background.
 */
export function TextAction({
  label,
  icon: Icon,
  onPress,
  style,
}: {
  label: string;
  icon?: LucideIcon;
  onPress?: () => void;
  style?: StyleProp<ViewStyle>;
}) {
  return (
    <Pressable
      onPress={onPress}
      accessibilityRole="button"
      accessibilityLabel={label}
      style={({ pressed }) => [
        {
          flexDirection: 'row',
          alignItems: 'center',
          gap: 6,
          opacity: pressed ? 0.6 : 1,
        },
        style,
      ]}
    >
      {Icon && <Icon size={18} color={colors.link} strokeWidth={1.75} />}
      <Text
        style={{
          fontSize: 17,
          lineHeight: 22,
          fontWeight: '400',
          color: colors.link,
        }}
      >
        {label}
      </Text>
    </Pressable>
  );
}

/**
 * 6.10 Tag pill: surface fill, pill radius, 15 textSecondary, padding 12x4, truncates
 */
export function TagPill({
  text,
  style,
}: {
  text: string;
  style?: StyleProp<ViewStyle>;
}) {
  return (
    <View
      style={[
        {
          backgroundColor: colors.surface,
          borderRadius: radius.pill,
          paddingHorizontal: 12,
          paddingVertical: 4,
          alignSelf: 'flex-start',
        },
        style,
      ]}
    >
      <Text
        numberOfLines={1}
        style={{
          fontSize: 15,
          lineHeight: 20,
          fontWeight: '400',
          color: colors.textSecondary,
        }}
      >
        {text}
      </Text>
    </View>
  );
}

/**
 * 6.6 Section label: 15pt textSecondary, sits 8 above card, inset 16 from card edge
 */
export function SectionLabel({
  text,
  children,
  style,
}: {
  text?: string;
  children?: React.ReactNode;
  style?: StyleProp<TextStyle>;
}) {
  return (
    <Text
      style={[
        {
          fontSize: 15,
          lineHeight: 20,
          fontWeight: '400',
          color: colors.textSecondary,
          marginBottom: space.sm,
          marginHorizontal: space.lg,
        },
        style,
      ]}
    >
      {text ?? children}
    </Text>
  );
}

/**
 * 6.6 Grouped settings card: surface fill, radius 24, rows separated by hairline dividers
 */
export function GroupedCard({
  children,
  style,
}: {
  children: React.ReactNode;
  style?: StyleProp<ViewStyle>;
}) {
  return (
    <View
      style={[
        {
          backgroundColor: colors.surface,
          borderRadius: radius.card,
          paddingHorizontal: space.lg,
          overflow: 'hidden',
        },
        style,
      ]}
    >
      {children}
    </View>
  );
}

/**
 * 6.6 Grouped row: row at least 56 tall, leading icon or mark (about 28pt), title 20/400,
 * trailing chevron-right in textTertiary.
 */
export function GroupedRow({
  icon: Icon,
  mark,
  title,
  subtitle,
  trailing,
  onPress,
  isLast = false,
  height = 56,
}: {
  icon?: LucideIcon;
  mark?: React.ReactNode;
  title: string;
  subtitle?: string;
  trailing?: React.ReactNode;
  onPress?: () => void;
  isLast?: boolean;
  height?: number;
}) {
  return (
    <View>
      <Pressable
        onPress={onPress}
        disabled={!onPress}
        style={({ pressed }) => [
          {
            minHeight: height,
            flexDirection: 'row',
            alignItems: 'center',
            paddingVertical: 12,
            opacity: pressed && onPress ? 0.6 : 1,
          },
        ]}
      >
        {mark ? (
          <View style={{ marginRight: 14 }}>{mark}</View>
        ) : Icon ? (
          <View style={{ marginRight: 14 }}>
            <Icon size={24} color={colors.textSecondary} strokeWidth={1.75} />
          </View>
        ) : null}

        <View style={{ flex: 1, minWidth: 0, justifyContent: 'center' }}>
          <Text
            numberOfLines={1}
            style={{
              fontSize: 20,
              lineHeight: 26,
              fontWeight: '400',
              color: colors.textPrimary,
            }}
          >
            {title}
          </Text>
          {subtitle ? (
            <Text
              numberOfLines={1}
              style={{
                fontSize: 17,
                lineHeight: 22,
                fontWeight: '400',
                color: colors.textSecondary,
                marginTop: 2,
              }}
            >
              {subtitle}
            </Text>
          ) : null}
        </View>

        {trailing}
      </Pressable>

      {!isLast && (
        <View
          style={{
            height: StyleSheet.hairlineWidth,
            backgroundColor: colors.divider,
            marginLeft: mark || Icon ? 42 : 0,
          }}
        />
      )}
    </View>
  );
}

/**
 * Hairline Divider inset
 */
export function HairlineDivider({
  inset = 0,
  style,
}: {
  inset?: number;
  style?: StyleProp<ViewStyle>;
}) {
  return (
    <View
      style={[
        {
          height: StyleSheet.hairlineWidth,
          backgroundColor: colors.divider,
          marginLeft: inset,
        },
        style,
      ]}
    />
  );
}
