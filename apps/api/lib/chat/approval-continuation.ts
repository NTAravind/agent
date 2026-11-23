type MessagePartLike = {
  type?: unknown;
  state?: unknown;
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
