type MessagePartLike = {
  type?: unknown;
  state?: unknown;
  toolCallId?: unknown;
  approval?: { approved?: unknown } | unknown;
};

type MessageLike = {
  role?: unknown;
  parts?: unknown;
};

function isToolPart(part: MessagePartLike): boolean {
  return (
    typeof part.type === "string" &&
    (part.type === "dynamic-tool" || part.type.startsWith("tool-"))
  );
}

function partsOf(message: MessageLike | undefined): MessagePartLike[] {
  return Array.isArray(message?.parts)
    ? (message.parts as MessagePartLike[])
    : [];
}

/**
 * True when the request continues an assistant turn after the user answered
 * an inline tool-approval request.
 *
 * The AI SDK sends the complete UI history for that continuation. The last
 * message is the assistant message whose tool part has moved from
 * `approval-requested` to `approval-responded`; there is no new user message
 * to persist.
 */
export function isApprovalContinuation(messages: MessageLike[]): boolean {
  const last = messages.at(-1);
  return (
    last?.role === "assistant" &&
    partsOf(last).some(
      (part) => isToolPart(part) && part.state === "approval-responded",
    )
  );
}

/** True when an assistant message still contains an unanswered approval. */
export function hasPendingToolApproval(message: MessageLike | undefined): boolean {
  return partsOf(message).some(
    (part) => isToolPart(part) && part.state === "approval-requested",
  );
}

/** One inline approval decision carried by the UI history. */
export type ApprovalDecision = {
  toolCallId: string;
  approved: boolean;
};

/**
 * Reads the approval decisions of the last assistant message.
 *
 * The client sends the complete UI history, so the last assistant message
 * holds the tool parts that moved from `approval-requested` to
 * `approval-responded`. When a tool call carries more than one decision the
 * last one wins, matching how the AI SDK resolves it.
 */
export function approvalDecisions(messages: MessageLike[]): ApprovalDecision[] {
  const last = messages.at(-1);
  if (last?.role !== "assistant") return [];

  const decisions = new Map<string, boolean>();
  for (const part of partsOf(last)) {
    if (!isToolPart(part) || part.state !== "approval-responded") continue;
    if (typeof part.toolCallId !== "string") continue;
    const approval = part.approval as { approved?: unknown } | undefined;
    if (!approval || typeof approval.approved !== "boolean") continue;
    decisions.set(part.toolCallId, approval.approved);
  }

  return [...decisions].map(([toolCallId, approved]) => ({ toolCallId, approved }));
}
