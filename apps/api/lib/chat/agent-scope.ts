export type ChatAgentScope =
  | {
      ok: true;
      agentId: string | null;
      /** The thread has no agent yet and must be bound to `agentId`. */
      bindToThread: boolean;
    }
  | {
      ok: false;
      code: "agent_mismatch";
      message: string;
    };

/**
 * Resolves the agent that owns an ordinary chat.
 *
 * A thread's persisted agent is authoritative. A request may omit `agentId`
 * (the stored scope is then used) or repeat the same id, but it may not move
 * an existing thread to a different agent.
 */
export function resolveChatAgentScope(
  requestedAgentId: string | null | undefined,
  storedAgentId: string | null | undefined,
): ChatAgentScope {
  const requested = requestedAgentId ?? null;
  const stored = storedAgentId ?? null;

  if (stored) {
    if (requested && requested !== stored) {
      return {
        ok: false,
        code: "agent_mismatch",
        message: "This conversation belongs to a different agent.",
      };
    }
    return { ok: true, agentId: stored, bindToThread: false };
  }

  if (requested) {
    return { ok: true, agentId: requested, bindToThread: true };
  }

  return { ok: true, agentId: null, bindToThread: false };
}
