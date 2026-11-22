import { useState } from 'react';
import type { AgentSummary } from '@agent/shared';
import { Spinner, Typography } from 'heroui-native';
import { Alert, Pressable, ScrollView, TextInput, View } from 'react-native';

import { AgentAvatar } from '@/components/agent-avatar';
import { COMPOSER_ICONS } from '@/constants/icons';
import type { PendingAttachment } from '@/lib/attachments';

type Props = {
  value: string;
  onChangeText: (value: string) => void;
  onSend: () => void;
  onAttachImage: () => void | Promise<void>;
  onAttachDocument: () => void | Promise<void>;
  attachments: PendingAttachment[];
  onRemoveAttachment: (documentId: string) => void;
  isStreaming: boolean;
  disabled?: boolean;
  deepSearchActive?: boolean;
  onToggleDeepSearch?: () => void;
  thinkActive?: boolean;
  onToggleThink?: () => void;
  /** Members that can be addressed with @mentions (group chats). */
  mentionMembers?: AgentSummary[];
  /** Hides the attachment button for specialized composers such as group chat. */
  showAttachments?: boolean;
  placeholder?: string;
};

/**
 * Grok-inspired floating capsule composer.
 * Features a dark glass capsule container, capability quick-pills (DeepSearch, Think),
 * streamlined attachment chips, and high-contrast circular send button.
 */
export function Composer({
  value,
  onChangeText,
  onSend,
  onAttachImage,
  onAttachDocument,
  attachments,
  onRemoveAttachment,
  isStreaming,
  disabled,
  deepSearchActive = false,
  onToggleDeepSearch,
  thinkActive = false,
  onToggleThink,
  mentionMembers = [],
  showAttachments = true,
  placeholder = 'Ask anything…',
}: Props) {
  const [uploading, setUploading] = useState(false);
  const canSend = value.trim().length > 0 && !isStreaming && !disabled;

  const withBusy = async (fn: () => void | Promise<void>) => {
    setUploading(true);
    try {
      await fn();
    } finally {
      setUploading(false);
    }
  };

  /** A trailing @word is the active mention query. */
  const mentionMatch = value.match(/@([^\s@]*)$/u);
  const mentionQuery = mentionMatch ? mentionMatch[1].toLocaleLowerCase() : null;
  const visibleMentionMembers = mentionMembers.filter((member) =>
    mentionQuery === null
      ? true
      : member.name.toLocaleLowerCase().includes(mentionQuery),
  );

  /** Replaces a partial trailing mention with the selected member's name. */
  const insertMention = (name: string) => {
    const partial = value.match(/@([^\s@]*)$/u);
    const base = partial ? value.slice(0, value.length - partial[0].length) : value;
    onChangeText(`${base}@${name} `);
  };

  const openAttachMenu = () => {
    Alert.alert('Add to chat', undefined, [
      { text: '📷 Photo', onPress: () => void withBusy(onAttachImage) },
      { text: '📄 Document (PDF)', onPress: () => void withBusy(onAttachDocument) },
      { text: 'Cancel', style: 'cancel' },
    ]);
  };

  return (
    <View className="rounded-[28px] border border-white/10 bg-[#121215] px-3.5 pb-2.5 pt-3 shadow-2xl">
      {/* @mention picker: the visible member chips double as autocomplete when
          the user has started typing an @mention. */}
      {mentionMembers.length > 0 ? (
        <View className="mb-2 gap-1.5">
          <View className="flex-row items-center gap-1.5">
            <Typography type="body-xs" className="font-semibold text-zinc-400">
              @ Mention
            </Typography>
            {mentionQuery !== null ? (
              <Typography type="body-xs" className="text-zinc-500">
                {visibleMentionMembers.length > 0 ? 'Choose a member' : 'No matching member'}
              </Typography>
            ) : null}
          </View>
          {visibleMentionMembers.length > 0 ? (
            <ScrollView
              horizontal
              showsHorizontalScrollIndicator={false}
              keyboardShouldPersistTaps="handled"
              contentContainerStyle={{ gap: 6, paddingRight: 2 }}
            >
              {visibleMentionMembers.map((member) => (
                <Pressable
                  key={member.name}
                  onPress={() => insertMention(member.name)}
                  accessibilityRole="button"
                  accessibilityLabel={`Mention ${member.name}`}
                  className="flex-row items-center gap-1.5 rounded-full border border-violet-500/25 bg-violet-500/10 px-2.5 py-1 active:opacity-70"
                >
                  <AgentAvatar avatar={member.avatar} name={member.name} size={18} />
                  <Typography type="body-xs" weight="medium" className="max-w-32 text-violet-200">
                    {member.name}
                  </Typography>
                </Pressable>
              ))}
            </ScrollView>
          ) : null}
        </View>
      ) : null}

      {/* Attachment Preview Row */}
      {attachments.length > 0 ? (
        <View className="mb-2 flex-row flex-wrap gap-1.5">
          {attachments.map((attachment) => (
            <Pressable
              key={attachment.documentId}
              onPress={() => onRemoveAttachment(attachment.documentId)}
              accessibilityRole="button"
              accessibilityLabel={`Remove ${attachment.name}`}
              className="flex-row items-center gap-1.5 rounded-full border border-white/15 bg-white/10 px-2.5 py-1 active:opacity-60"
            >
              <Typography type="body-xs" className="max-w-[140px] text-white" numberOfLines={1}>
                {attachment.name}
              </Typography>
              <Typography type="body-xs" className="text-zinc-400 font-semibold">
                ✕
              </Typography>
            </Pressable>
          ))}
        </View>
      ) : null}

      {/* Multiline Input */}
      <TextInput
        className="max-h-36 min-h-[44px] px-1 text-base leading-5 text-white"
        placeholder={placeholder}
        placeholderTextColor="#71717a"
        value={value}
        onChangeText={onChangeText}
        editable={!disabled}
        multiline
        textAlignVertical="top"
      />

      {/* Capsule Toolbar Row */}
      <View className="mt-2 flex-row items-center justify-between">
        {/* Left Actions: Attach (+) + Mode Quick-Pills */}
        <View className="flex-row items-center gap-1.5">
          {/* Add media button */}
          {showAttachments ? (
            <Pressable
              onPress={openAttachMenu}
              disabled={uploading || disabled}
              accessibilityRole="button"
              accessibilityLabel="Add attachment"
              className="h-8 w-8 items-center justify-center rounded-full border border-white/10 bg-white/5 active:bg-white/10 active:opacity-70"
            >
              {uploading ? (
                <Spinner size="sm" color="default" />
              ) : (
                <COMPOSER_ICONS.attach size={16} color="#a1a1aa" />
              )}
            </Pressable>
          ) : null}

          {/* DeepSearch toggle pill */}
          {onToggleDeepSearch ? (
            <Pressable
              onPress={onToggleDeepSearch}
              accessibilityRole="button"
              accessibilityLabel="Toggle DeepSearch"
              className={`flex-row items-center gap-1.5 rounded-full border px-2.5 py-1 active:opacity-75 ${
                deepSearchActive
                  ? 'border-sky-500/50 bg-sky-500/15'
                  : 'border-white/10 bg-white/5'
              }`}
            >
              <COMPOSER_ICONS.deepSearch
                size={13}
                color={deepSearchActive ? '#38bdf8' : '#71717a'}
              />
              <Typography
                type="body-xs"
                weight={deepSearchActive ? 'semibold' : 'normal'}
                className={deepSearchActive ? 'text-sky-400' : 'text-zinc-400'}
              >
                DeepSearch
              </Typography>
            </Pressable>
          ) : null}

          {/* Think toggle pill */}
          {onToggleThink ? (
            <Pressable
              onPress={onToggleThink}
              accessibilityRole="button"
              accessibilityLabel="Toggle Think mode"
              className={`flex-row items-center gap-1.5 rounded-full border px-2.5 py-1 active:opacity-75 ${
                thinkActive
                  ? 'border-purple-500/50 bg-purple-500/15'
                  : 'border-white/10 bg-white/5'
              }`}
            >
              <COMPOSER_ICONS.think
                size={13}
                color={thinkActive ? '#c084fc' : '#71717a'}
              />
              <Typography
                type="body-xs"
                weight={thinkActive ? 'semibold' : 'normal'}
                className={thinkActive ? 'text-purple-300' : 'text-zinc-400'}
              >
                Think
              </Typography>
            </Pressable>
          ) : null}
        </View>

        {/* Right Action: Circular High-Contrast Send Button */}
        <Pressable
          onPress={onSend}
          disabled={!canSend}
          accessibilityRole="button"
          accessibilityLabel="Send message"
          className={`h-8 w-8 items-center justify-center rounded-full transition-all ${
            canSend
              ? 'bg-white shadow-md active:scale-95 active:opacity-90'
              : 'bg-white/10'
          }`}
        >
          {isStreaming ? (
            <Spinner size="sm" color="default" />
          ) : (
            <COMPOSER_ICONS.send
              size={15}
              color={canSend ? '#000000' : '#71717a'}
              strokeWidth={2.6}
            />
          )}
        </Pressable>
      </View>
    </View>
  );
}
