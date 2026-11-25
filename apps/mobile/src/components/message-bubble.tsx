import React, { useState } from 'react';
import type { AgentSummary } from '@agent/shared';
import { Image } from 'expo-image';
import { Button } from 'heroui-native';
import { Linking, Pressable, Share, StyleSheet, Text, View } from 'react-native';
import {
  AlertTriangle,
  CalendarClock,
  Check,
  ChevronDown,
  ChevronUp,
  CornerDownLeft,
  FileText,
  Share2,
} from 'lucide-react-native';
import { SymbolIcon } from '@/components/symbol-icon';

import { AgentAvatar } from '@/components/agent-avatar';
import { MarkdownText } from '@/components/markdown-text';
import { RoutineProposalCard, type RoutineProposal } from '@/components/routine-proposal-card';
import { colors, radius, typography } from '@/theme';
import { hapticSelect } from '@/lib/haptics';

type Props = {
  role: 'user' | 'assistant' | 'system' | 'tool';
  parts: { type: string; [key: string]: unknown }[];
  modelLabel?: string | null;
  agent?: AgentSummary | null;
  runId?: string | null;
  onViewTask?: (runId: string) => void;
  onEditRoutine?: (routineId: string) => void;
  /** Records the user's decision for an inline tool approval request. */
  onToolApprovalResponse?: (response: { id: string; approved: boolean }) => void;
  replyQuote?: string | null;
  onSelectOption?: (option: string) => void;
  /** True while this message's AI response is still streaming tokens. */
  isStreaming?: boolean;
};

type ToolPart = {
  type: string;
  toolName?: string;
  state?: string;
  input?: unknown;
  output?: unknown;
  errorText?: string;
  approval?: {
    id: string;
    requestReason?: string;
    reason?: string;
    isAutomatic?: boolean;
    /** Server-issued proof for this approval request. Never rebuild it locally. */
    signature?: string;
  };
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
  onToolApprovalResponse,
  replyQuote,
  onSelectOption,
  isStreaming = false,
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
    hapticSelect();
    setSelectedOption(option);
    onSelectOption?.(option);
  };

  // User Message
  if (isUser) {
    const isRoutine = parts.some((part) => part.type === 'routine-trigger');
    if (isRoutine) {
      return (
        <View style={{ alignItems: 'flex-start' }}>
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
                  <SymbolIcon icon={CalendarClock} size={14} color={colors.textSecondary} strokeWidth={1.75} />
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
      <View style={{ alignItems: 'flex-end' }}>
        {replyQuote ? (
          <View style={{ flexDirection: 'row', alignItems: 'center', gap: 4, marginBottom: 4, marginRight: 8, opacity: 0.8 }}>
            <SymbolIcon icon={CornerDownLeft} size={13} color={colors.textSecondary} strokeWidth={1.75} />
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
    <View style={{ alignItems: 'flex-start' }}>
      {replyQuote ? (
        <View style={{ flexDirection: 'row', alignItems: 'center', gap: 4, marginBottom: 4, marginLeft: 8, opacity: 0.8 }}>
          <SymbolIcon icon={CornerDownLeft} size={13} color={colors.textSecondary} strokeWidth={1.75} />
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
            const explicitOptions = Array.isArray((part as any).options) ? (part as any).options : null;

            if (explicitOptions && explicitOptions.length > 0) {
              return (
                <OptionListCard
                  key={index}
                  question={textContent}
                  options={explicitOptions}
                  selectedOption={selectedOption}
                  onSelect={handleOptionPress}
                />
              );
            }

            return (
              <MarkdownText
                key={index}
                markdown={textContent}
                streaming={isStreaming}
              />
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

          if (part.type.startsWith('tool-') || part.type === 'dynamic-tool') {
            const toolPart = part as ToolPart;
            if (toolPart.state === 'approval-requested' && toolPart.approval) {
              return (
                <ToolApprovalCard
                  key={index}
                  part={toolPart}
                  onRespond={onToolApprovalResponse}
                />
              );
            }
            return <ToolPartView key={index} part={toolPart} />;
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
                accessibilityRole="button"
                accessibilityLabel="Share message"
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
                  <SymbolIcon icon={Check} size={12} color={colors.success} strokeWidth={2} />
                ) : (
                  <SymbolIcon icon={Share2} size={12} color={colors.textSecondary} strokeWidth={1.75} />
                )}
                <Text style={{ fontSize: 13, color: colors.textSecondary }}>
                  {copied ? 'Shared' : 'Share'}
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
  options,
  selectedOption,
  onSelect,
}: {
  question: string;
  options: Array<{ key: string; label: string }>;
  selectedOption: string | null;
  onSelect: (option: string) => void;
}) {
  if (!options || options.length === 0) {
    return null;
  }

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
            <SymbolIcon icon={Check} size={22} color={colors.success} strokeWidth={2.2} />
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
          <SymbolIcon icon={ChevronUp} size={14} color={colors.textSecondary} strokeWidth={1.75} />
        ) : (
          <SymbolIcon icon={ChevronDown} size={14} color={colors.textSecondary} strokeWidth={1.75} />
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
          <MarkdownText markdown={text} fontSize={13} color={colors.textSecondary} />
        </View>
      ) : null}
    </View>
  );
}

/** Shows the exact request payload so approval is informed, not blind. */
function approvalInputText(input: unknown): string | null {
  if (input === undefined || input === null) return null;
  if (typeof input === 'string') return input.slice(0, 4_000);
  try {
    const text = JSON.stringify(input, null, 2);
    return text ? text.slice(0, 4_000) : null;
  } catch {
    return null;
  }
}

function ToolApprovalCard({
  part,
  onRespond,
}: {
  part: ToolPart;
  onRespond?: (response: { id: string; approved: boolean }) => void;
}) {
  const name =
    part.toolName ??
    (part.type === 'dynamic-tool'
      ? 'MCP tool'
      : part.type.replace(/^tool-/, '') || 'MCP tool');
  const reason = part.approval?.requestReason ?? part.approval?.reason;
  const isAutomatic = part.approval?.isAutomatic === true;
  const input = approvalInputText(part.input);

  return (
    <View
      style={{
        width: '100%',
        borderRadius: radius.inner,
        backgroundColor: colors.surfaceRaised,
        padding: 14,
        gap: 10,
      }}
    >
      <View style={{ flexDirection: 'row', alignItems: 'center', gap: 7 }}>
        <SymbolIcon icon={AlertTriangle} size={17} color={colors.danger} strokeWidth={2} />
        <Text style={{ fontSize: 15, fontWeight: '600', color: colors.textPrimary }}>
          Approval required
        </Text>
      </View>

      <View
        style={{
          alignSelf: 'flex-start',
          borderRadius: radius.pill,
          backgroundColor: colors.surface,
          paddingHorizontal: 10,
          paddingVertical: 5,
        }}
      >
        <Text style={{ fontSize: 13, fontWeight: '500', color: colors.textPrimary }}>
          {name}
        </Text>
      </View>

      {reason ? (
        <Text style={{ fontSize: 15, lineHeight: 20, color: colors.textSecondary }}>
          {reason}
        </Text>
      ) : null}

      {input ? (
        <View
          style={{
            backgroundColor: colors.surface,
            borderRadius: radius.tile,
            padding: 12,
          }}
        >
          <Text
            style={{
              fontFamily: 'monospace',
              fontSize: 12,
              lineHeight: 18,
              color: colors.textPrimary,
            }}
          >
            {input}
          </Text>
        </View>
      ) : null}

      {isAutomatic ? (
        <Text style={{ fontSize: 13, color: colors.textSecondary }}>
          This request is being checked automatically.
        </Text>
      ) : (
        <View style={{ flexDirection: 'row', gap: 8, paddingTop: 2 }}>
          <Pressable
            onPress={() => onRespond?.({ id: part.approval!.id, approved: true })}
            disabled={!onRespond}
            accessibilityRole="button"
            accessibilityLabel={`Approve ${name}`}
            style={({ pressed }) => ({
              minHeight: 44,
              flex: 1,
              alignItems: 'center',
              justifyContent: 'center',
              borderRadius: radius.pill,
              backgroundColor: colors.primary,
              paddingHorizontal: 14,
              opacity: pressed ? 0.6 : onRespond ? 1 : 0.5,
            })}
          >
            <Text style={{ fontSize: 15, lineHeight: 20, fontWeight: '600', color: colors.onPrimary }}>
              Approve
            </Text>
          </Pressable>
          <Pressable
            onPress={() => onRespond?.({ id: part.approval!.id, approved: false })}
            disabled={!onRespond}
            accessibilityRole="button"
            accessibilityLabel={`Deny ${name}`}
            style={({ pressed }) => ({
              minHeight: 44,
              flex: 1,
              alignItems: 'center',
              justifyContent: 'center',
              borderRadius: radius.pill,
              backgroundColor: colors.surface,
              paddingHorizontal: 14,
              opacity: pressed ? 0.6 : onRespond ? 1 : 0.5,
            })}
          >
            <Text style={{ fontSize: 15, lineHeight: 20, fontWeight: '600', color: colors.textPrimary }}>
              Deny
            </Text>
          </Pressable>
        </View>
      )}
    </View>
  );
}

function ToolPartView({ part }: { part: ToolPart }) {
  const name =
    part.toolName ??
    (part.type === 'dynamic-tool'
      ? 'MCP tool'
      : part.type.replace(/^tool-/, '') || 'MCP tool');
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
            backgroundColor: failed ? colors.danger : colors.success,
          }}
        />
        <Text style={{ fontSize: 13, color: colors.textSecondary }}>{name}</Text>
      </View>
    </View>
  );
}
