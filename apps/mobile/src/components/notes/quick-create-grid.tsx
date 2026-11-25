import React from 'react';
import { Pressable, StyleSheet, Text, View } from 'react-native';
import { CheckSquare, PenLine } from 'lucide-react-native';
import { SymbolIcon } from '@/components/symbol-icon';
import { colors, radius, space } from '@/theme';

export type QuickCreateMode = 'text' | 'checklist';

type Props = {
  onCreate: (mode: QuickCreateMode) => void;
};

export function QuickCreateGrid({ onCreate }: Props) {
  return (
    <View style={styles.grid}>
      <View style={styles.row}>
        {/* 1. Text Note */}
        <Pressable
          onPress={() => onCreate('text')}
          accessibilityRole="button"
          accessibilityLabel="Create text note"
          style={({ pressed }) => [
            styles.card,
            pressed && styles.cardPressed,
          ]}
        >
          <View style={styles.iconTile}>
            <SymbolIcon icon={PenLine} size={20} color={colors.textPrimary} strokeWidth={1.75} />
          </View>
          <View style={styles.textContainer}>
            <Text numberOfLines={1} style={styles.title}>
              Text note
            </Text>
            <Text numberOfLines={2} style={styles.subtitle}>
              Write thoughts & markdown
            </Text>
          </View>
        </Pressable>

        {/* 2. Checklist Note */}
        <Pressable
          onPress={() => onCreate('checklist')}
          accessibilityRole="button"
          accessibilityLabel="Create checklist note"
          style={({ pressed }) => [
            styles.card,
            pressed && styles.cardPressed,
          ]}
        >
          <View style={styles.iconTile}>
            <SymbolIcon icon={CheckSquare} size={20} color={colors.textPrimary} strokeWidth={1.75} />
          </View>
          <View style={styles.textContainer}>
            <Text numberOfLines={1} style={styles.title}>
              Checklist
            </Text>
            <Text numberOfLines={2} style={styles.subtitle}>
              Tasks & to-do items
            </Text>
          </View>
        </Pressable>
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  grid: {
    paddingHorizontal: space.lg,
  },
  row: {
    flexDirection: 'row',
    gap: space.md,
  },
  card: {
    flex: 1,
    minHeight: 120,
    borderRadius: radius.card,
    padding: space.lg,
    justifyContent: 'space-between',
    backgroundColor: colors.surface,
  },
  cardPressed: {
    // DESIGN.md §6.2: opacity 0.6 only — no scale bounce.
    opacity: 0.6,
  },
  iconTile: {
    width: 40,
    height: 40,
    borderRadius: radius.tile,
    backgroundColor: colors.surfaceRaised,
    alignItems: 'center',
    justifyContent: 'center',
  },
  textContainer: {
    gap: 4,
    marginTop: space.sm,
  },
  title: {
    fontSize: 17,
    lineHeight: 22,
    fontWeight: '600',
    color: colors.textPrimary,
  },
  subtitle: {
    fontSize: 15,
    lineHeight: 20,
    color: colors.textSecondary,
  },
});
