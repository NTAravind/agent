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
import { SymbolIcon } from '@/components/symbol-icon';
import { colors, radius, shadow, space, typography } from '@/theme';

/**
 * Button variants — the only two fills a button may use:
 * - `primary`: black (`primary`) with white content — the one action per screen.
 * - `secondary`: grey (`surface`) with dark content — everything else.
 * Buttons are never transparent: an unfilled control reads as broken.
 */
export type ButtonVariant = 'primary' | 'secondary';

/**
 * 6.2 Round icon button:
 * 44x44 in `secondary` (grey) or `primary` (black) fill with floating shadow.
 * Inside sheets, round buttons use the grey fill and no shadow.
 */
export function RoundButton({
  icon: Icon,
  onPress,
  inSheet = false,
  size = 44,
  variant = 'secondary',
  disabled = false,
  accessibilityLabel,
  style,
}: {
  icon: LucideIcon;
  onPress?: () => void;
  inSheet?: boolean;
  size?: number;
  variant?: ButtonVariant;
  disabled?: boolean;
  accessibilityLabel?: string;
  style?: StyleProp<ViewStyle>;
}) {
  const isPrimary = variant === 'primary' && !inSheet;
  return (
    <Pressable
      onPress={onPress}
      disabled={disabled}
      accessibilityRole="button"
      accessibilityLabel={accessibilityLabel}
      accessibilityState={{ disabled }}
      style={({ pressed }) => [
        {
          width: size,
          height: size,
          borderRadius: radius.pill,
          backgroundColor: isPrimary ? colors.primary : colors.surface,
          alignItems: 'center',
          justifyContent: 'center',
          opacity: disabled ? 0.45 : pressed ? 0.6 : 1,
        },
        inSheet ? null : shadow.floating,
        style,
      ]}
    >
      {Icon ? (
        <SymbolIcon
          icon={Icon}
          size={Math.round(size * 0.5)}
          color={isPrimary ? colors.onPrimary : colors.textPrimary}
          strokeWidth={1.75}
        />
      ) : null}
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
  onCard = false,
  disabled = false,
  accessibilityLabel,
  style,
}: {
  label: string;
  onPress?: () => void;
  variant?: ButtonVariant;
  /**
   * The button sits on a grey (`surface`) card. DESIGN.md §6.2: "When a
   * button floats on a grey card, the fill is white (`surfaceRaised`) so it
   * still separates from the card." On the screen background it stays grey.
   */
  onCard?: boolean;
  disabled?: boolean;
  accessibilityLabel?: string;
  style?: StyleProp<ViewStyle>;
}) {
  const isPrimary = variant === 'primary';
  const fill = isPrimary ? colors.primary : onCard ? colors.surfaceRaised : colors.surface;
  return (
    <Pressable
      onPress={onPress}
      disabled={disabled}
      accessibilityRole="button"
      accessibilityLabel={accessibilityLabel ?? label}
      accessibilityState={{ disabled }}
      style={({ pressed }) => [
        {
          height: 44,
          paddingHorizontal: 24,
          borderRadius: radius.pill,
          backgroundColor: fill,
          alignItems: 'center',
          justifyContent: 'center',
          opacity: pressed ? 0.6 : disabled ? 0.5 : 1,
        },
        style,
      ]}
    >
      <Text
        style={{
          ...typography.button,
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
          minHeight: 44,
          flexDirection: 'row',
          alignItems: 'center',
          gap: 6,
          opacity: pressed ? 0.6 : 1,
        },
        style,
      ]}
    >
      {Icon ? (
        <SymbolIcon icon={Icon} size={18} color={colors.link} strokeWidth={1.75} />
      ) : null}
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
          // DESIGN.md 6.6: section labels sit inset 16 from the card edge;
          // screens already pad their content by 16, so this adds the inner inset.
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
        accessibilityRole={onPress ? 'button' : undefined}
        accessibilityLabel={title}
        accessibilityHint={subtitle}
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
            <SymbolIcon icon={Icon} size={24} color={colors.textSecondary} strokeWidth={1.75} />
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

/**
 * Inline error state — the one way a failed load is shown.
 *
 * A quiet `surface` card (radius 24, padding 12) carrying the failure
 * message in `danger`. When the screen can recover on its own, a "Retry"
 * pill sits under the message; the pill is white (`surfaceRaised`) because it
 * floats on the grey card (DESIGN.md §6.2).
 *
 * `align="center"` is for the full-screen variants (a missing agent, a note
 * that no longer exists) where the message is the whole screen.
 */
export function InlineError({
  message,
  onRetry,
  retryLabel = 'Retry',
  align = 'start',
  style,
}: {
  message: string;
  onRetry?: () => void;
  retryLabel?: string;
  align?: 'start' | 'center';
  style?: StyleProp<ViewStyle>;
}) {
  const centered = align === 'center';
  return (
    <View
      style={[
        {
          backgroundColor: colors.surface,
          borderRadius: radius.card,
          padding: space.md,
          alignItems: centered ? 'center' : 'flex-start',
        },
        style,
      ]}
    >
      <Text
        style={{
          fontSize: 15,
          lineHeight: 20,
          fontWeight: '400',
          color: colors.danger,
          textAlign: centered ? 'center' : 'left',
        }}
      >
        {message}
      </Text>
      {onRetry ? (
        <PillButton
          label={retryLabel}
          onPress={onRetry}
          variant="secondary"
          onCard
          style={{ marginTop: space.sm }}
        />
      ) : null}
    </View>
  );
}
