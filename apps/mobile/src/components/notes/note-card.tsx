import React, { useMemo } from 'react';
import {
  ActionSheetIOS,
  Alert,
  Platform,
  Pressable,
  Share,
  StyleSheet,
  Text,
  View,
} from 'react-native';
import {
  Calendar,
  CheckSquare,
  MoreHorizontal,
  Pin,
  Square,
} from 'lucide-react-native';
import type { Note } from '@agent/shared';

import { colors, radius, shadow, space } from '@/theme';
import { TagChip } from './tag-chip';

type ChecklistItem = {
  checked: boolean;
  text: string;
};

type Props = {
  note: Note;
  content?: string;
  onPress: () => void;
  onDelete: () => void;
  onDuplicate: () => void;
  onTogglePin?: (pinned: boolean) => void;
};

function formatRelativeDate(dateStr?: string | null): string {
  if (!dateStr) return 'Recently';
  const date = new Date(dateStr);
  if (isNaN(date.getTime())) return 'Recently';

  const diffSec = Math.floor((Date.now() - date.getTime()) / 1000);
  if (diffSec < 60) return 'Just now';
  if (diffSec < 3600) return `${Math.floor(diffSec / 60)}m ago`;
  const diffDays = Math.floor(diffSec / 86400);
  if (diffDays === 0) return 'Today';
  if (diffDays === 1) return 'Yesterday';
  if (diffDays < 7) return `${diffDays} Days Ago`;
  if (diffDays < 30) return `${Math.floor(diffDays / 7)}w ago`;
  return date.toLocaleDateString([], { month: 'short', day: 'numeric' });
}

export function NoteCard({
  note,
  content,
  onPress,
  onDelete,
  onDuplicate,
  onTogglePin,
}: Props) {
  const isPinned = Boolean(note.frontmatter?.pinned);

  // Derive preview checklist items or plain text preview
  const { checklistItems, textPreview, tags } = useMemo(() => {
    const rawContent = content ?? '';
    const lines = rawContent.split('\n').map((l) => l.trim()).filter(Boolean);

    // Parse checklist items `- [ ]` or `- [x]`
    const checks: ChecklistItem[] = [];
    const textLines: string[] = [];

    for (const line of lines) {
      if (line.startsWith('#')) continue; // Skip title heading
      const match = line.match(/^[-*]\s*\[([ xX])\]\s*(.*)$/);
      if (match) {
        checks.push({
          checked: match[1].toLowerCase() === 'x',
          text: match[2].trim(),
        });
      } else if (!line.startsWith('---')) {
        textLines.push(line);
      }
    }

    // Extract tags from frontmatter or hashtags
    const extractedTags: string[] = [];
    if (Array.isArray(note.frontmatter?.tags)) {
      extractedTags.push(...(note.frontmatter.tags as string[]));
    }
    if (note.path.includes('/')) {
      const folder = note.path.split('/')[0];
      if (folder && !extractedTags.includes(folder)) {
        extractedTags.push(folder);
      }
    }
    // Also parse inline hashtags like #personal, #journal
    const hashtagMatches = rawContent.match(/#([a-zA-Z0-9_-]+)/g);
    if (hashtagMatches) {
      for (const h of hashtagMatches) {
        const clean = h.slice(1);
        if (clean && !extractedTags.includes(clean) && clean.length > 2) {
          extractedTags.push(clean);
        }
      }
    }

    return {
      checklistItems: checks.slice(0, 3), // show up to 3 checklist items
      textPreview: textLines.slice(0, 2).join(' ').trim(),
      tags: extractedTags.slice(0, 3),
    };
  }, [content, note.frontmatter, note.path]);

  const handleShare = async () => {
    try {
      await Share.share({
        title: note.title ?? 'Note',
        message: `${note.title ?? 'Note'}\n\n${content ?? ''}`,
      });
    } catch {
      // Ignored
    }
  };

  const openMenu = () => {
    const options = [
      isPinned ? 'Unpin' : 'Pin',
      'Duplicate',
      'Share',
      'Delete',
      'Cancel',
    ];

    if (Platform.OS === 'ios') {
      ActionSheetIOS.showActionSheetWithOptions(
        {
          options,
          destructiveButtonIndex: 3,
          cancelButtonIndex: 4,
          title: note.title ?? note.path,
        },
        (buttonIndex) => {
          if (buttonIndex === 0) onTogglePin?.(!isPinned);
          else if (buttonIndex === 1) onDuplicate();
          else if (buttonIndex === 2) void handleShare();
          else if (buttonIndex === 3) onDelete();
        },
      );
    } else {
      Alert.alert(note.title ?? note.path, undefined, [
        { text: isPinned ? 'Unpin' : 'Pin', onPress: () => onTogglePin?.(!isPinned) },
        { text: 'Duplicate', onPress: onDuplicate },
        { text: 'Share', onPress: () => void handleShare() },
        { text: 'Delete', style: 'destructive', onPress: onDelete },
        { text: 'Cancel', style: 'cancel' },
      ]);
    }
  };

  const title = note.title || (note.path.split('/').pop()?.replace('.md', '') ?? 'Untitled');

  return (
    <Pressable
      onPress={onPress}
      accessibilityRole="button"
      accessibilityLabel={`Open note ${title}`}
      style={({ pressed }) => [
        styles.card,
        shadow.floating,
        pressed && styles.cardPressed,
      ]}
    >
      {/* Header: Title + Pin Indicator + More Menu */}
      <View style={styles.header}>
        <View style={styles.titleRow}>
          {isPinned && <Pin size={15} color={colors.textPrimary} style={styles.pinIcon} />}
          <Text numberOfLines={1} style={styles.title}>
            {title}
          </Text>
        </View>

        <Pressable
          onPress={openMenu}
          accessibilityRole="button"
          accessibilityLabel="Note options"
          hitSlop={8}
          style={styles.moreButton}
        >
          <MoreHorizontal size={20} color={colors.textSecondary} />
        </Pressable>
      </View>

      {/* Content Preview: Checklist rows or text snippet */}
      <View style={styles.previewContainer}>
        {checklistItems.length > 0 ? (
          <View style={styles.checklistContainer}>
            {checklistItems.map((item, idx) => (
              <View key={idx} style={styles.checklistItem}>
                {item.checked ? (
                  <CheckSquare size={16} color={colors.textPrimary} strokeWidth={2} />
                ) : (
                  <Square size={16} color={colors.textSecondary} strokeWidth={1.5} />
                )}
                <Text
                  numberOfLines={1}
                  style={[
                    styles.checklistText,
                    item.checked && styles.checklistTextChecked,
                  ]}
                >
                  {item.text}
                </Text>
              </View>
            ))}
          </View>
        ) : textPreview ? (
          <Text numberOfLines={2} style={styles.textPreview}>
            {textPreview}
          </Text>
        ) : null}
      </View>

      {/* Footer: Tag Chips bottom-left, Date bottom-right */}
      <View style={styles.footer}>
        <View style={styles.tagsRow}>
          {tags.map((tag) => (
            <TagChip key={tag} label={tag} />
          ))}
        </View>

        <View style={styles.dateContainer}>
          <Calendar size={13} color={colors.textSecondary} />
          <Text style={styles.dateText}>
            {formatRelativeDate(note.updated_at)}
          </Text>
        </View>
      </View>
    </Pressable>
  );
}

const styles = StyleSheet.create({
  card: {
    backgroundColor: colors.surface,
    borderRadius: radius.card,
    padding: space.lg,
    gap: space.md,
    borderWidth: StyleSheet.hairlineWidth,
    borderColor: colors.divider,
  },
  cardPressed: {
    opacity: 0.9,
    transform: [{ scale: 0.99 }],
  },
  header: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    gap: space.sm,
  },
  titleRow: {
    flex: 1,
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
  },
  pinIcon: {
    transform: [{ rotate: '45deg' }],
  },
  title: {
    fontSize: 17,
    lineHeight: 22,
    fontWeight: '700',
    color: colors.textPrimary,
    flex: 1,
  },
  moreButton: {
    width: 44,
    height: 44,
    borderRadius: radius.pill,
    backgroundColor: colors.surfaceRaised,
    alignItems: 'center',
    justifyContent: 'center',
    ...shadow.floating,
  },
  previewContainer: {
    minHeight: 20,
  },
  checklistContainer: {
    gap: 6,
  },
  checklistItem: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: space.sm,
  },
  checklistText: {
    fontSize: 14,
    color: colors.textPrimary,
    flex: 1,
  },
  checklistTextChecked: {
    color: colors.textSecondary,
    textDecorationLine: 'line-through',
  },
  textPreview: {
    fontSize: 14,
    lineHeight: 20,
    color: colors.textSecondary,
  },
  footer: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    gap: space.sm,
    paddingTop: space.xs,
  },
  tagsRow: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: 6,
    flex: 1,
  },
  dateContainer: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 4,
  },
  dateText: {
    fontSize: 12,
    fontWeight: '500',
    color: colors.textSecondary,
  },
});
