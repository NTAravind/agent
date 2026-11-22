/**
 * Privacy policy for group handoffs (Phase 11).
 *
 * A group's rolling summary can contain note- or memory-derived material. The
 * model registry marks every model with `privateOk`; only Google models may
 * receive that material. For every other target the server drops the rolling
 * summary and the model-supplied handoff context, leaving only the explicit
 * task. This is deliberately stricter than trying to classify prose after the
 * fact: copied private facts are indistinguishable from ordinary prose.
 */

export const PRIVATE_CONTEXT_TOOLS = [
  "search_notes",
  "read_note",
  "recall_memory",
  "list_memories",
] as const;

const PRIVATE_TOOL_SET = new Set<string>(PRIVATE_CONTEXT_TOOLS);

/**
 * Google-only fallback chain for a group turn that may carry private context.
 * A private-safe primary is not enough: its normal cross-provider fallbacks
 * would otherwise receive the same prompt.
 */
export const PRIVATE_MODEL_IDS = [
  "google:gemini-3.8-flash",
  "google:gemini-3.6-flash",
  "google:gemini-3.5-flash-lite",
] as const;

/** A fallback chain that never leaves private-ok providers. */
export function privateModelChain(preferred?: string | null): string[] {
  const chain: string[] = [...PRIVATE_MODEL_IDS];
  if (preferred?.startsWith("google:") && !chain.some((id) => id === preferred)) {
    chain.unshift(preferred);
  }
  return chain;
}

export type GroupBrief = {
  /** The explicit task for the next member. */
  task: string;
  /** Optional context proposed by the current member. */
  context?: string;
  /** Rolling group summary from previous turns. */
  summary?: string;
};

/**
 * Builds the brief that may cross a model boundary.
 *
 * A non-private target receives the explicit task only. Both the rolling
 * summary and the free-form context are removed, because either can contain
 * note- or memory-derived content copied by an earlier member.
 */
export function buildHandoffBrief(
  brief: GroupBrief,
  targetPrivateOk: boolean,
): GroupBrief {
  if (targetPrivateOk) {
    return {
      task: brief.task,
      ...(brief.context ? { context: brief.context } : {}),
      ...(brief.summary ? { summary: brief.summary } : {}),
    };
  }

  return { task: brief.task };
}

/** True when a serialized brief contains no group summary/context. */
export function isPrivateSafeBrief(brief: GroupBrief): boolean {
  return !brief.context && !brief.summary;
}

/**
 * Whether a handoff/consult may cross into a target that cannot see private
 * context.
 *
 * The boundary is the caller's own privacy policy, not the prose it wrote:
 * a member whose model may read notes/memories can copy that material into
 * any `task` or `question` it authors, and copied facts are indistinguishable
 * from ordinary text. So a private-capable caller may only hand work to a
 * private-capable target. A non-private caller never touches that material,
 * so it may hand off anywhere.
 */
export function handoffAllowedForPrivacy(
  callerPrivateOk: boolean,
  targetPrivateOk: boolean,
): boolean {
  return !callerPrivateOk || targetPrivateOk;
}

/**
 * The message returned to the model when the boundary blocks a handoff. It
 * names the target's model class without leaking any private material.
 */
export const PRIVATE_HANDOFF_BLOCKED =
  "This handoff would send private-context work to a member whose model cannot read private context. Ask a member whose model allows private context, or restate the task without relying on note/memory material."; 

/**
 * Removes note/memory tools from a model-visible tool list when the target
 * model is not allowed to see private context.
 */
export function filterPrivateTools<T extends string>(
  names: Iterable<T>,
  targetPrivateOk: boolean,
): T[] {
  if (targetPrivateOk) return [...names];
  return [...names].filter((name) => !PRIVATE_TOOL_SET.has(name));
}

/** Whether a concrete tool may run for a target with the given privacy policy. */
export function toolAllowedForPrivacy(toolName: string, targetPrivateOk: boolean): boolean {
  return targetPrivateOk || !PRIVATE_TOOL_SET.has(toolName);
}
