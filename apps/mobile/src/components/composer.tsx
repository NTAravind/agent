import React, { useState } from 'react';
import type { AgentSummary } from '@agent/shared';
import {
  Modal,
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  TextInput,
  TouchableWithoutFeedback,
  View,
} from 'react-native';
import {
  ArrowUp,
  Brain,
  Camera,
  Folder,
  Globe,
  Image as ImageIcon,
  ListChecks,
  Mic,
  Pause,
  Plus,
  Square,
  X,
} from 'lucide-react-native';

import { AgentAvatar } from '@/components/agent-avatar';
import { colors, radius, shadow, space, typography } from '@/theme';
import type { PendingAttachment } from '@/lib/attachments';

type Props = {
  value: string;
  onChangeText: (value: string) => void;
  onSend: () => void;
  onAttachImage: () => void | Promise<void>;
  onAttachDocument: () => void | Promise<void>;
  onTakePhoto?: () => void | Promise<void>;
  attachments: PendingAttachment[];
  onRemoveAttachment: (documentId: string) => void;
  isStreaming: boolean;
  disabled?: boolean;
  deepSearchActive?: boolean;
  onToggleDeepSearch?: () => void;
  thinkActive?: boolean;
  onToggleThink?: () => void;
  taskModeActive?: boolean;
  onToggleTaskMode?: () => void;
  mentionMembers?: AgentSummary[];
  showAttachments?: boolean;
  placeholder?: string;
  agentName?: string;
  isTaskActive?: boolean;
  onPause?: () => void | Promise<void>;
};

/**
 * 6.5 Composer conforming strictly to design.md:
 * - Row at the bottom with safe-area padding:
 *   - round + button (44x44, surfaceRaised, floating shadow)
 *   - pill text field (surfaceRaised, floating shadow, height 52, placeholder "Ask {AgentName}" in textSecondary)
 *   - Right inside the field: small mic button, 36x36 circle, surface fill, textSecondary mic icon.
 *   - Recording state: the mic is replaced by a pill with recordingBg, a small recording red square (stop), and timer 0:10 in recording color;
 *     next to it a round send button, 40x40, primary fill with a white arrow-up icon.
 *   - Task active state: the action button becomes an enabled round pause button (40x40, primary fill, white pause icon) that pauses the active task.
 *   - Popover + menu above button: surfaceRaised, radius 32, floating shadow, rows with 28pt outline icon + label 20/400 ("Attach Image", "Take Photo", "Choose File"). No dividers, 16 vertical padding per row.
 */
export function Composer({
  value,
  onChangeText,
  onSend,
  onAttachImage,
  onAttachDocument,
  onTakePhoto,
  attachments,
  onRemoveAttachment,
  isStreaming,
  disabled = false,
  deepSearchActive = false,
  onToggleDeepSearch,
  thinkActive = false,
  onToggleThink,
  taskModeActive = false,
  onToggleTaskMode,
  mentionMembers = [],
  showAttachments = true,
  placeholder,
  agentName = 'Agent',
  isTaskActive,
  onPause,
}: Props) {
  const [uploading, setUploading] = useState(false);
  const [menuOpen, setMenuOpen] = useState(false);
  const [isRecording, setIsRecording] = useState(false);
  const [recordSeconds, setRecordSeconds] = useState(10);

  const isCarryingOutTask = Boolean(isTaskActive ?? isStreaming);
  const hasText = value.trim().length > 0;
  const canSend = hasText && !isCarryingOutTask && !disabled;
  const inputPlaceholder = placeholder ?? `Ask ${agentName}`;
  const showQuickToggles = Boolean(
    onToggleDeepSearch || onToggleThink || onToggleTaskMode,
  );

  const withBusy = async (fn: () => void | Promise<void>) => {
    setUploading(true);
    setMenuOpen(false);
    try {
      await fn();
    } finally {
      setUploading(false);
    }
  };

  /** Mention query match */
  const mentionMatch = value.match(/@([^\s@]*)$/u);
  const mentionQuery = mentionMatch ? mentionMatch[1].toLocaleLowerCase() : null;
  const visibleMentionMembers = mentionMembers.filter((member) =>
    mentionQuery === null
      ? true
      : member.name.toLocaleLowerCase().includes(mentionQuery),
  );

  const insertMention = (name: string) => {
    const partial = value.match(/@([^\s@]*)$/u);
    const base = partial ? value.slice(0, value.length - partial[0].length) : value;
    onChangeText(`${base}@${name} `);
  };

  const handleToggleRecord = () => {
    if (isRecording) {
      setIsRecording(false);
      onChangeText(value ? `${value} Can you replace broccoli with something?` : 'Can you replace broccoli with something?');
    } else {
      setIsRecording(true);
      setRecordSeconds(10);
    }
  };

  return (
    <View style={styles.container}>
      {/* 6.5 + Menu Popover */}
      {menuOpen && (
        <Modal
          transparent
          visible={menuOpen}
          animationType="fade"
          onRequestClose={() => setMenuOpen(false)}
        >
          <TouchableWithoutFeedback onPress={() => setMenuOpen(false)}>
            <View style={styles.backdrop}>
              <View style={styles.popoverCard}>
                <Pressable
                  onPress={() => void withBusy(onAttachImage)}
                  accessibilityRole="button"
                  accessibilityLabel="Attach Image"
                  style={({ pressed }) => [styles.popoverRow, { opacity: pressed ? 0.6 : 1 }]}
                >
                  <ImageIcon size={28} color={colors.textPrimary} strokeWidth={1.5} />
                  <Text style={styles.popoverText}>Attach Image</Text>
                </Pressable>

                <Pressable
                  onPress={() => void withBusy(onTakePhoto ?? onAttachImage)}
                  accessibilityRole="button"
                  accessibilityLabel="Take Photo"
                  style={({ pressed }) => [styles.popoverRow, { opacity: pressed ? 0.6 : 1 }]}
                >
                  <Camera size={28} color={colors.textPrimary} strokeWidth={1.5} />
                  <Text style={styles.popoverText}>Take Photo</Text>
                </Pressable>

                <Pressable
                  onPress={() => void withBusy(onAttachDocument)}
                  accessibilityRole="button"
                  accessibilityLabel="Choose File"
                  style={({ pressed }) => [styles.popoverRow, { opacity: pressed ? 0.6 : 1 }]}
                >
                  <Folder size={28} color={colors.textPrimary} strokeWidth={1.5} />
                  <Text style={styles.popoverText}>Choose File</Text>
                </Pressable>
              </View>
            </View>
          </TouchableWithoutFeedback>
        </Modal>
      )}

      {/* Attachment Previews */}
      {attachments.length > 0 && (
        <View style={styles.attachmentsRow}>
          {attachments.map((attachment) => (
            <Pressable
              key={attachment.documentId}
              onPress={() => onRemoveAttachment(attachment.documentId)}
              accessibilityRole="button"
              accessibilityLabel={`Remove attachment ${attachment.name}`}
              style={({ pressed }) => [styles.attachmentPill, { opacity: pressed ? 0.6 : 1 }]}
            >
              <Text numberOfLines={1} style={styles.attachmentName}>
                {attachment.name}
              </Text>
              <X size={14} color={colors.textSecondary} strokeWidth={2} />
            </Pressable>
          ))}
        </View>
      )}

      {/* Mention Auto-Complete Bar */}
      {mentionMembers.length > 0 && visibleMentionMembers.length > 0 && (
        <ScrollView
          horizontal
          showsHorizontalScrollIndicator={false}
          keyboardShouldPersistTaps="handled"
          style={styles.mentionsScroll}
          contentContainerStyle={{ gap: 8, paddingHorizontal: 4 }}
        >
          {visibleMentionMembers.map((member) => (
            <Pressable
              key={member.name}
              onPress={() => insertMention(member.name)}
              accessibilityRole="button"
              accessibilityLabel={`Mention ${member.name}`}
              style={({ pressed }) => [styles.mentionPill, { opacity: pressed ? 0.6 : 1 }]}
            >
              <AgentAvatar avatar={member.avatar} name={member.name} size={18} />
              <Text style={styles.mentionText}>@{member.name}</Text>
            </Pressable>
          ))}
        </ScrollView>
      )}

      {/* Quick capability toggles */}
      {showQuickToggles ? (
        <View style={styles.quickToggleRow}>
          {[
            {
              key: 'deep-search',
              label: 'DeepSearch',
              Icon: Globe,
              active: deepSearchActive,
              onPress: onToggleDeepSearch,
            },
            {
              key: 'think',
              label: 'Think',
              Icon: Brain,
              active: thinkActive,
              onPress: onToggleThink,
            },
            {
              key: 'task-mode',
              label: 'Task Mode',
              Icon: ListChecks,
              active: taskModeActive,
              onPress: onToggleTaskMode,
            },
          ].map(({ key, label, Icon, active, onPress }) => (
            <Pressable
              key={key}
              onPress={onPress}
              disabled={disabled || !onPress}
              accessibilityRole="switch"
              accessibilityLabel={label}
              accessibilityState={{ checked: active, disabled: disabled || !onPress }}
              style={({ pressed }) => [
                styles.quickToggle,
                active ? styles.quickToggleActive : styles.quickToggleInactive,
                { opacity: pressed ? 0.6 : disabled || !onPress ? 0.5 : 1 },
              ]}
            >
              <Icon
                size={14}
                color={active ? colors.onPrimary : colors.textSecondary}
                strokeWidth={1.9}
              />
              <Text
                numberOfLines={1}
                style={[
                  styles.quickToggleText,
                  { color: active ? colors.onPrimary : colors.textSecondary },
                ]}
              >
                {label}
              </Text>
            </Pressable>
          ))}
        </View>
      ) : null}

      {/* Main Composer Bar */}
      <View style={styles.composerBar}>
        {/* Round + Button (44, surfaceRaised, floating shadow) */}
        {showAttachments && (
          <Pressable
            onPress={() => setMenuOpen(!menuOpen)}
            disabled={uploading || disabled}
            accessibilityRole="button"
            accessibilityLabel="Add attachment"
            style={({ pressed }) => [
              styles.plusButton,
              shadow.floating,
              { opacity: pressed ? 0.6 : 1 },
            ]}
          >
            <Plus size={22} color={colors.textPrimary} strokeWidth={1.75} />
          </Pressable>
        )}

        {/* Pill Text Field (surfaceRaised, floating shadow, height 52) */}
        <View style={[styles.fieldPill, shadow.floating]}>
          <TextInput
            style={styles.textInput}
            placeholder={inputPlaceholder}
            placeholderTextColor={colors.textSecondary}
            value={value}
            onChangeText={onChangeText}
            editable={!disabled}
            multiline={false}
            returnKeyType="send"
            onSubmitEditing={() => {
              if (canSend) onSend();
            }}
          />

          {/* Right inside the field: Mic button or recording timer */}
          {isRecording ? (
            <Pressable
              onPress={handleToggleRecord}
              accessibilityRole="button"
              accessibilityLabel="Stop recording"
              style={({ pressed }) => [styles.recordingBadge, { opacity: pressed ? 0.6 : 1 }]}
            >
              <Square size={10} color={colors.recording} fill={colors.recording} />
              <Text style={styles.recordingTimer}>
                0:{recordSeconds < 10 ? `0${recordSeconds}` : recordSeconds}
              </Text>
            </Pressable>
          ) : (
            <Pressable
              onPress={handleToggleRecord}
              accessibilityRole="button"
              accessibilityLabel="Voice recording"
              style={({ pressed }) => [styles.micButton, { opacity: pressed ? 0.6 : 1 }]}
            >
              <Mic size={18} color={colors.textSecondary} strokeWidth={1.75} />
            </Pressable>
          )}
        </View>

        {/* Next to it round button (40x40, primary fill with white icon):
            - Pause button when an agent is carrying out the task
            - Send button (ArrowUp) when user typed text or is recording */}
        {(isCarryingOutTask || hasText || isRecording) && (
          <Pressable
            onPress={() => {
              if (isCarryingOutTask) {
                void onPause?.();
              } else if (isRecording) {
                handleToggleRecord();
              } else if (canSend) {
                onSend();
              }
            }}
            disabled={!isCarryingOutTask && !canSend && !isRecording}
            accessibilityRole="button"
            accessibilityLabel={isCarryingOutTask ? 'Pause task' : 'Send message'}
            accessibilityHint={isCarryingOutTask ? "Pauses the agent's current task" : 'Sends your message'}
            style={({ pressed }) => [
              styles.sendButton,
              shadow.floating,
              { opacity: pressed ? 0.6 : isCarryingOutTask || canSend || isRecording ? 1 : 0.5 },
            ]}
          >
            {isCarryingOutTask ? (
              <Pause size={18} color={colors.onPrimary} strokeWidth={2.5} />
            ) : (
              <ArrowUp size={20} color={colors.onPrimary} strokeWidth={2.5} />
            )}
          </Pressable>
        )}
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    width: '100%',
  },
  backdrop: {
    flex: 1,
    backgroundColor: 'rgba(0, 0, 0, 0.1)',
    justifyContent: 'flex-end',
    paddingBottom: 80,
    paddingHorizontal: space.lg,
  },
  popoverCard: {
    backgroundColor: colors.surfaceRaised,
    borderRadius: radius.sheet,
    paddingVertical: space.sm,
    paddingHorizontal: space.lg,
    width: 230,
    ...shadow.floating,
  },
  popoverRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: space.md,
    paddingVertical: 16,
  },
  popoverText: {
    fontSize: 20,
    lineHeight: 26,
    fontWeight: '400',
    color: colors.textPrimary,
  },
  attachmentsRow: {
    marginBottom: space.sm,
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: space.sm,
    paddingHorizontal: space.xs,
  },
  attachmentPill: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: space.xs,
    backgroundColor: colors.surface,
    borderRadius: radius.pill,
    paddingHorizontal: 12,
    paddingVertical: 6,
  },
  attachmentName: {
    fontSize: 15,
    color: colors.textPrimary,
    maxWidth: 160,
  },
  mentionsScroll: {
    marginBottom: space.sm,
  },
  mentionPill: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
    backgroundColor: colors.surface,
    borderRadius: radius.pill,
    paddingHorizontal: 12,
    paddingVertical: 6,
  },
  mentionText: {
    fontSize: 15,
    color: colors.textPrimary,
    fontWeight: '500',
  },
  quickToggleRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: space.sm,
    marginBottom: space.sm,
  },
  quickToggle: {
    minHeight: 34,
    flex: 1,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 5,
    borderRadius: radius.pill,
    paddingHorizontal: 8,
  },
  quickToggleActive: {
    backgroundColor: colors.primary,
  },
  quickToggleInactive: {
    backgroundColor: colors.surface,
  },
  quickToggleText: {
    fontSize: 12,
    fontWeight: '600',
  },
  composerBar: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: space.sm,
  },
  plusButton: {
    width: 44,
    height: 44,
    borderRadius: radius.pill,
    backgroundColor: colors.surfaceRaised,
    alignItems: 'center',
    justifyContent: 'center',
  },
  fieldPill: {
    flex: 1,
    height: 52,
    borderRadius: radius.pill,
    backgroundColor: colors.surfaceRaised,
    flexDirection: 'row',
    alignItems: 'center',
    paddingLeft: 18,
    paddingRight: 8,
  },
  textInput: {
    flex: 1,
    fontSize: 17,
    lineHeight: 22,
    color: colors.textPrimary,
    paddingVertical: 0,
    marginRight: 6,
  },
  micButton: {
    width: 36,
    height: 36,
    borderRadius: radius.pill,
    backgroundColor: colors.surface,
    alignItems: 'center',
    justifyContent: 'center',
  },
  recordingBadge: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
    backgroundColor: colors.recordingBg,
    borderRadius: radius.pill,
    paddingHorizontal: 10,
    paddingVertical: 6,
  },
  recordingTimer: {
    fontSize: 14,
    fontWeight: '600',
    color: colors.recording,
  },
  sendButton: {
    width: 40,
    height: 40,
    borderRadius: radius.pill,
    backgroundColor: colors.primary,
    alignItems: 'center',
    justifyContent: 'center',
  },
});
