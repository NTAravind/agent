import React, { useState } from 'react';
import type { AgentSummary } from '@agent/shared';
import { Image } from 'expo-image';
import { Button } from 'heroui-native';
import { Linking, Pressable, Share, StyleSheet, Text, View } from 'react-native';
import {
  CalendarClock,
  Check,
  ChevronDown,
  ChevronUp,
  Copy,
  CornerDownLeft,
  FileText,
} from 'lucide-react-native';

import { AgentAvatar } from '@/components/agent-avatar';
import { RoutineProposalCard, type RoutineProposal } from '@/components/routine-proposal-card';
import { colors, radius, space, typography } from '@/theme';

type Props = {
  role: 'user' | 'assistant' | 'system' | 'tool';
  parts: { type: string; [key: string]: unknown }[];
  modelLabel?: string | null;
  agent?: AgentSummary | null;
  runId?: string | null;
  onViewTask?: (runId: string) => void;
  onEditRoutine?: (routineId: string) => void;
  replyQuote?: string | null;
  onSelectOption?: (option: string) => void;
};

type ToolPart = {
  type: string;
  state?: string;
  input?: unknown;
  output?: unknown;
  errorText?: string;
};

/**
 * 6.3 Chat Bubbles & 6.4 Quick-reply options conforming to design.md
 */
export function MessageBubble({
  role,
  parts,
  modelLabel,
  agent,
  runId,
  onViewTask,
  onEditRoutine,
  replyQuote,
  onSelectOption,
}: Props) {
  const isUser = role === 'user';
  const [copied, setCopied] = useState(false);
  const [selectedOption, setSelectedOption] = useState<string | null>(null);

  const fullAssistantText = parts
    .filter((p) => p.type === 'text')
    .map((p) => String(p.text ?? ''))
    .join('\n');

  const handleShareOrCopy = async () => {
    if (!fullAssistantText) return;
    try {
      setCopied(true);
      await Share.share({ message: fullAssistantText });
    } catch {
      // User cancelled
    } finally {
      setTimeout(() => setCopied(false), 2000);
    }
  };

  const handleOptionPress = (option: string) => {
    setSelectedOption(option);
    onSelectOption?.(option);
  };

  // User Message
  if (isUser) {
    const isRoutine = parts.some((part) => part.type === 'routine-trigger');
    if (isRoutine) {
      return (
        <View style={{ alignItems: 'flex-start', marginVertical: space.xs }}>
          {parts.map((part, index) => {
            if (part.type === 'routine-trigger') {
              return (
                <View
                  key={index}
                  style={{
                    flexDirection: 'row',
                    alignItems: 'center',
                    gap: 6,
                    borderRadius: radius.pill,
                    backgroundColor: colors.surface,
                    paddingHorizontal: 12,
                    paddingVertical: 6,
                  }}
                >
                  <CalendarClock size={14} color={colors.textSecondary} strokeWidth={1.75} />
                  <Text style={{ fontSize: 13, color: colors.textSecondary }}>
                    {`Routine · ${String(part.routine_name ?? 'scheduled run')}`}
                  </Text>
                </View>
              );
            }
            return null;
          })}
        </View>
      );
    }

    return (
      <View style={{ alignItems: 'flex-end', marginVertical: 5 }}>
        {replyQuote ? (
          <View style={{ flexDirection: 'row', alignItems: 'center', gap: 4, marginBottom: 4, marginRight: 8, opacity: 0.8 }}>
            <CornerDownLeft size={13} color={colors.textSecondary} strokeWidth={1.75} />
            <Text numberOfLines={1} style={{ fontSize: 15, color: colors.textSecondary, maxWidth: 260 }}>
              {replyQuote}
            </Text>
          </View>
        ) : null}

        <View
          style={{
            maxWidth: '80%',
            borderRadius: radius.card,
            backgroundColor: colors.primary,
            paddingHorizontal: 16,
            paddingVertical: 14,
          }}
        >
          {parts.map((part, index) => {
            if (part.type === 'text') {
              return (
                <Text
                  key={index}
                  style={{
                    fontSize: 17,
                    lineHeight: 22,
                    fontWeight: '400',
                    color: colors.onPrimary,
                  }}
                >
                  {String(part.text ?? '')}
                </Text>
              );
            }
            return null;
          })}
        </View>
      </View>
    );
  }

  // Agent Message
  return (
    <View style={{ alignItems: 'flex-start', marginVertical: 5 }}>
      {replyQuote ? (
        <View style={{ flexDirection: 'row', alignItems: 'center', gap: 4, marginBottom: 4, marginLeft: 8, opacity: 0.8 }}>
          <CornerDownLeft size={13} color={colors.textSecondary} strokeWidth={1.75} />
          <Text numberOfLines={1} style={{ fontSize: 15, color: colors.textSecondary, maxWidth: 280 }}>
            {replyQuote}
          </Text>
        </View>
      ) : null}

      <View
        style={{
          maxWidth: '85%',
          borderRadius: radius.card,
          backgroundColor: colors.surface,
          paddingHorizontal: 16,
          paddingVertical: 14,
          gap: 12,
        }}
      >
        {parts.map((part, index) => {
          if (part.type === 'text') {
            const textContent = String(part.text ?? '');

            const isQuestion =
              textContent.includes('Want me to tweak this') ||
              textContent.includes('Which option') ||
              textContent.includes('How would you like to proceed');

            if (isQuestion) {
              return (
                <OptionListCard
                  key={index}
                  question={textContent}
                  selectedOption={selectedOption}
                  onSelect={handleOptionPress}
                />
              );
            }

            return (
              <Text
                key={index}
                style={{
                  fontSize: 17,
                  lineHeight: 22,
                  fontWeight: '400',
                  color: colors.textPrimary,
                }}
              >
                {textContent}
              </Text>
            );
          }

          if (part.type === 'reasoning') {
            return <ReasoningView key={index} text={String(part.text ?? '')} />;
          }

          if (part.type === 'file') {
            const url = part.url as string | undefined;
            const filename = String(part.filename ?? 'artifact.md');
            const size = String(part.size ?? '3.1 KB');
            const mediaType = String(part.mediaType ?? '');

            if (url && mediaType.startsWith('image/')) {
              return (
                <Image
                  key={index}
                  source={{ uri: url }}
                  style={{ width: 220, height: 220, borderRadius: radius.card }}
                  contentFit="cover"
                />
              );
            }

            return (
              <ArtifactCard
                key={index}
                filename={filename}
                size={size}
                onPress={() => {
                  if (url) void Linking.openURL(url);
                }}
              />
            );
          }

          if (part.type === 'data-routine-proposal') {
            const proposal = part.data as RoutineProposal | undefined;
            if (!proposal?.routineId) return null;
            return (
              <RoutineProposalCard
                key={index}
                proposal={proposal}
                {...(onEditRoutine ? { onEdit: onEditRoutine } : {})}
              />
            );
          }

          if (part.type.startsWith('tool-')) {
            return <ToolPartView key={index} part={part as ToolPart} />;
          }

          return null;
        })}

        {/* Action Toolbar */}
        <View
          style={{
            marginTop: 4,
            paddingTop: 8,
            borderTopWidth: StyleSheet.hairlineWidth,
            borderTopColor: colors.divider,
            flexDirection: 'row',
            alignItems: 'center',
            justifyContent: 'space-between',
          }}
        >
          <View style={{ flexDirection: 'row', alignItems: 'center', gap: 8 }}>
            {fullAssistantText ? (
              <Pressable
                onPress={() => void handleShareOrCopy()}
                style={({ pressed }) => ({
                  flexDirection: 'row',
                  alignItems: 'center',
                  gap: 4,
                  borderRadius: radius.pill,
                  backgroundColor: colors.surfaceRaised,
                  paddingHorizontal: 10,
                  paddingVertical: 4,
                  opacity: pressed ? 0.6 : 1,
                })}
              >
                {copied ? (
                  <Check size={12} color={colors.success} strokeWidth={2} />
                ) : (
                  <Copy size={12} color={colors.textSecondary} strokeWidth={1.75} />
                )}
                <Text style={{ fontSize: 13, color: colors.textSecondary }}>
                  {copied ? 'Copied' : 'Copy'}
                </Text>
              </Pressable>
            ) : null}

            <Text style={{ fontSize: 13, color: colors.textSecondary }}>
              {[agent?.name, modelLabel].filter(Boolean).join(' · ')}
            </Text>
          </View>

          {runId && onViewTask ? (
            <Pressable
              onPress={() => onViewTask(runId)}
              style={({ pressed }) => ({
                borderRadius: radius.pill,
                backgroundColor: colors.primary,
                paddingHorizontal: 12,
                paddingVertical: 5,
                opacity: pressed ? 0.6 : 1,
              })}
            >
              <Text style={{ fontSize: 12, fontWeight: '500', color: colors.onPrimary }}>
                View task →
              </Text>
            </Pressable>
          ) : null}
        </View>
      </View>
    </View>
  );
}

/**
 * 6.3 File attachment card:
 * surface fill, radius 24, padding 12 horizontal, 44x44 tile icon block
 * file name 20/500 with extension in textTertiary, file size 15pt textSecondary
 */
export function ArtifactCard({
  filename,
  size = '3.1 KB',
  onPress,
}: {
  filename: string;
  size?: string;
  onPress?: () => void;
}) {
  const parts = filename.split('.');
  const ext = parts.length > 1 ? `.${parts.pop()}` : '';
  const baseName = parts.join('.');

  return (
    <Pressable
      onPress={onPress}
      style={({ pressed }) => ({
        flexDirection: 'row',
        alignItems: 'center',
        gap: 12,
        borderRadius: radius.card,
        backgroundColor: colors.surfaceRaised,
        paddingHorizontal: 12,
        paddingVertical: 10,
        opacity: pressed ? 0.6 : 1,
      })}
    >
      <View
        style={{
          width: 44,
          height: 44,
          borderRadius: radius.tile,
          backgroundColor: colors.surfaceRaised,
          alignItems: 'center',
          justifyContent: 'center',
        }}
      >
        <Text style={{ fontSize: 13, fontWeight: '700', color: colors.textPrimary }}>
          M↓
        </Text>
      </View>

      <View style={{ flex: 1, minWidth: 0 }}>
        <Text numberOfLines={1} style={{ fontSize: 20, lineHeight: 26, fontWeight: '500', color: colors.textPrimary }}>
          {baseName}
          <Text style={{ color: colors.textTertiary }}>{ext}</Text>
        </Text>
        <Text style={{ fontSize: 15, lineHeight: 20, color: colors.textSecondary }}>
          {size}
        </Text>
      </View>
    </Pressable>
  );
}

/**
 * 6.4 Quick-reply options inside an agent bubble:
 * White (surfaceRaised) list with radius 20, no shadow.
 * Each row is 60 tall with a leading letter badge (A, B, C...) 32x32, radius 10,
 * surface fill, textSecondary 15pt letter. Then option text 20/400.
 * Rows separated by hairline divider inset from the left.
 * After choice: collapses to only chosen row with success green check.
 */
export function OptionListCard({
  question,
  options = [
    { key: 'A', label: 'This works' },
    { key: 'B', label: 'Vegetarian' },
    { key: 'C', label: 'No seafood' },
    { key: 'D', label: 'Cooking for two' },
    { key: 'E', label: 'Shorter Sunday cook' },
  ],
  selectedOption,
  onSelect,
}: {
  question: string;
  options?: Array<{ key: string; label: string }>;
  selectedOption: string | null;
  onSelect: (option: string) => void;
}) {
  return (
    <View style={{ gap: 10 }}>
      <Text style={{ fontSize: 17, lineHeight: 22, fontWeight: '400', color: colors.textPrimary }}>
        {question}
      </Text>

      <View
        style={{
          backgroundColor: colors.surfaceRaised,
          borderRadius: radius.inner,
          overflow: 'hidden',
        }}
      >
        {selectedOption ? (
          <View
            style={{
              height: 60,
              flexDirection: 'row',
              alignItems: 'center',
              justifyContent: 'space-between',
              paddingHorizontal: 16,
            }}
          >
            <Text style={{ fontSize: 20, lineHeight: 26, fontWeight: '400', color: colors.textPrimary }}>
              {selectedOption}
            </Text>
            <Check size={22} color={colors.success} strokeWidth={2.2} />
          </View>
        ) : (
          options.map((opt, i) => (
            <View key={opt.key}>
              <Pressable
                onPress={() => onSelect(opt.label)}
                style={({ pressed }) => ({
                  height: 60,
                  flexDirection: 'row',
                  alignItems: 'center',
                  paddingHorizontal: 16,
                  gap: 14,
                  opacity: pressed ? 0.6 : 1,
                })}
              >
                <View
                  style={{
                    width: 32,
                    height: 32,
                    borderRadius: radius.tile,
                    backgroundColor: colors.surface,
                    alignItems: 'center',
                    justifyContent: 'center',
                  }}
                >
                  <Text style={{ fontSize: 15, fontWeight: '500', color: colors.textSecondary }}>
                    {opt.key}
                  </Text>
                </View>
                <Text style={{ fontSize: 20, lineHeight: 26, fontWeight: '400', color: colors.textPrimary }}>
                  {opt.label}
                </Text>
              </Pressable>

              {i < options.length - 1 && (
                <View
                  style={{
                    height: StyleSheet.hairlineWidth,
                    backgroundColor: colors.divider,
                    marginLeft: 62,
                  }}
                />
              )}
            </View>
          ))
        )}
      </View>
    </View>
  );
}

function ReasoningView({ text }: { text: string }) {
  const [expanded, setExpanded] = useState(false);
  if (!text.trim()) return null;

  return (
    <View style={{ marginVertical: 4 }}>
      <Pressable
        onPress={() => setExpanded((prev) => !prev)}
        style={({ pressed }) => ({
          flexDirection: 'row',
          alignItems: 'center',
          gap: 6,
          alignSelf: 'flex-start',
          borderRadius: radius.pill,
          backgroundColor: colors.surfaceRaised,
          paddingHorizontal: 12,
          paddingVertical: 6,
          opacity: pressed ? 0.6 : 1,
        })}
      >
        <Text style={{ fontSize: 13, color: colors.textSecondary }}>Thought trace</Text>
        {expanded ? (
          <ChevronUp size={14} color={colors.textSecondary} strokeWidth={1.75} />
        ) : (
          <ChevronDown size={14} color={colors.textSecondary} strokeWidth={1.75} />
        )}
      </Pressable>
      {expanded ? (
        <View
          style={{
            marginTop: 8,
            borderRadius: radius.card,
            backgroundColor: colors.surfaceRaised,
            padding: 12,
          }}
        >
          <Text style={{ fontSize: 13, lineHeight: 18, color: colors.textSecondary }}>
            {text}
          </Text>
        </View>
      ) : null}
    </View>
  );
}

function ToolPartView({ part }: { part: ToolPart }) {
  const name = part.type.replace(/^tool-/, '');
  const state = part.state ?? 'input-available';
  const failed = state === 'output-error';

  return (
    <View style={{ marginVertical: 2 }}>
      <View
        style={{
          flexDirection: 'row',
          alignItems: 'center',
          gap: 6,
          alignSelf: 'flex-start',
          borderRadius: radius.pill,
          backgroundColor: colors.surfaceRaised,
          paddingHorizontal: 10,
          paddingVertical: 4,
        }}
      >
        <View
          style={{
            width: 8,
            height: 8,
            borderRadius: radius.pill,
            backgroundColor: failed ? colors.recording : colors.success,
          }}
        />
        <Text style={{ fontSize: 13, color: colors.textSecondary }}>{name}</Text>
      </View>
    </View>
  );
}
