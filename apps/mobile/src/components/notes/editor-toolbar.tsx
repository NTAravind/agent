import React from 'react';
import {
  Pressable,
  ScrollView,
  StyleSheet,
  View,
  type StyleProp,
  type ViewStyle,
} from 'react-native';
import {
  Bold,
  CheckSquare,
  Heading2,
  Italic,
  Link2,
  List,
  Redo2,
  Undo2,
} from 'lucide-react-native';
import type { StyleState } from 'react-native-enriched-markdown';
import { colors, radius, shadow, space } from '@/theme';

type Props = {
  styleState?: StyleState | null;
  onToggleBold: () => void;
  onToggleItalic: () => void;
  onToggleHeading: () => void;
  onToggleList: () => void;
  onInsertChecklist: () => void;
  onInsertLink: () => void;
  onUndo: () => void;
  onRedo: () => void;
  style?: StyleProp<ViewStyle>;
};

export function EditorToolbar({
  styleState,
  onToggleBold,
  onToggleItalic,
  onToggleHeading,
  onToggleList,
  onInsertChecklist,
  onInsertLink,
  onUndo,
  onRedo,
  style,
}: Props) {
  const isBold = Boolean(styleState?.bold?.isActive);
  const isItalic = Boolean(styleState?.italic?.isActive);
  const isHeading = Boolean(styleState?.heading?.isActive);
  const isList = Boolean(styleState?.unorderedList?.isActive);
  const isLink = Boolean(styleState?.link?.isActive);

  return (
    <View style={[styles.container, shadow.floating, style]}>
      <ScrollView
        horizontal
        showsHorizontalScrollIndicator={false}
        contentContainerStyle={styles.scrollContent}
        keyboardShouldPersistTaps="always"
      >
        {/* Bold */}
        <Pressable
          onPress={onToggleBold}
          accessibilityRole="button"
          accessibilityLabel="Bold"
          style={({ pressed }) => [
            styles.toolButton,
            isBold && styles.toolButtonActive,
            pressed && styles.toolButtonPressed,
          ]}
        >
          <Bold
            size={18}
            color={isBold ? colors.onPrimary : colors.textPrimary}
            strokeWidth={2.5}
          />
        </Pressable>

        {/* Italic */}
        <Pressable
          onPress={onToggleItalic}
          accessibilityRole="button"
          accessibilityLabel="Italic"
          style={({ pressed }) => [
            styles.toolButton,
            isItalic && styles.toolButtonActive,
            pressed && styles.toolButtonPressed,
          ]}
        >
          <Italic
            size={18}
            color={isItalic ? colors.onPrimary : colors.textPrimary}
            strokeWidth={2.5}
          />
        </Pressable>

        {/* Heading */}
        <Pressable
          onPress={onToggleHeading}
          accessibilityRole="button"
          accessibilityLabel="Heading"
          style={({ pressed }) => [
            styles.toolButton,
            isHeading && styles.toolButtonActive,
            pressed && styles.toolButtonPressed,
          ]}
        >
          <Heading2
            size={18}
            color={isHeading ? colors.onPrimary : colors.textPrimary}
            strokeWidth={2.5}
          />
        </Pressable>

        {/* Checklist */}
        <Pressable
          onPress={onInsertChecklist}
          accessibilityRole="button"
          accessibilityLabel="Checklist"
          style={({ pressed }) => [
            styles.toolButton,
            pressed && styles.toolButtonPressed,
          ]}
        >
          <CheckSquare
            size={18}
            color={colors.textPrimary}
            strokeWidth={2}
          />
        </Pressable>

        {/* Bullet List */}
        <Pressable
          onPress={onToggleList}
          accessibilityRole="button"
          accessibilityLabel="Bullet list"
          style={({ pressed }) => [
            styles.toolButton,
            isList && styles.toolButtonActive,
            pressed && styles.toolButtonPressed,
          ]}
        >
          <List
            size={18}
            color={isList ? colors.onPrimary : colors.textPrimary}
            strokeWidth={2}
          />
        </Pressable>

        {/* Link */}
        <Pressable
          onPress={onInsertLink}
          accessibilityRole="button"
          accessibilityLabel="Link"
          style={({ pressed }) => [
            styles.toolButton,
            isLink && styles.toolButtonActive,
            pressed && styles.toolButtonPressed,
          ]}
        >
          <Link2
            size={18}
            color={isLink ? colors.onPrimary : colors.textPrimary}
            strokeWidth={2}
          />
        </Pressable>

        {/* Divider */}
        <View style={styles.divider} />

        {/* Undo */}
        <Pressable
          onPress={onUndo}
          accessibilityRole="button"
          accessibilityLabel="Undo"
          style={({ pressed }) => [
            styles.toolButton,
            pressed && styles.toolButtonPressed,
          ]}
        >
          <Undo2 size={18} color={colors.textSecondary} strokeWidth={2} />
        </Pressable>

        {/* Redo */}
        <Pressable
          onPress={onRedo}
          accessibilityRole="button"
          accessibilityLabel="Redo"
          style={({ pressed }) => [
            styles.toolButton,
            pressed && styles.toolButtonPressed,
          ]}
        >
          <Redo2 size={18} color={colors.textSecondary} strokeWidth={2} />
        </Pressable>
      </ScrollView>
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    backgroundColor: colors.surfaceRaised,
    borderTopWidth: StyleSheet.hairlineWidth,
    borderTopColor: colors.divider,
    paddingVertical: 4,
  },
  scrollContent: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingHorizontal: space.md,
    gap: 4,
  },
  toolButton: {
    width: 44,
    height: 44,
    borderRadius: radius.pill,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: 'transparent',
  },
  toolButtonActive: {
    backgroundColor: colors.primary,
  },
  toolButtonPressed: {
    opacity: 0.6,
  },
  divider: {
    width: 1,
    height: 24,
    backgroundColor: colors.divider,
    marginHorizontal: 4,
  },
});
