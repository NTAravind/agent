export type TaskThreadScope =
  | {
      ok: true;
      agentId: string | null;
      /** Create a thread, bind an existing unscoped thread, or reuse it. */
      threadAction: "create" | "bind" | "reuse";
    }
  | {
      ok: false;
      code: "agent_mismatch";
      message: string;
    };

/**
 * Resolves the agent and thread action for a durable Task Mode start.
 *
 * A thread's persisted agent remains authoritative: a request may omit the
 * agent or repeat it, but it may not move the thread to another agent. When
 * Task Mode creates its own thread, the requested agent (or the user's
 * default agent) is attached as part of that creation.
 */
export function resolveTaskThreadScope(input: {
  hasThread: boolean;
  storedAgentId?: string | null;
  requestedAgentId?: string | null;
  fallbackAgentId?: string | null;
}): TaskThreadScope {
  const stored = input.storedAgentId ?? null;
  const requested = input.requestedAgentId ?? null;

  if (input.hasThread && stored) {
    if (requested && requested !== stored) {
      return {
        ok: false,
        code: "agent_mismatch",
        message: "This conversation belongs to a different agent.",
      };
    }
    return { ok: true, agentId: stored, threadAction: "reuse" };
  }

  const agentId = requested ?? input.fallbackAgentId ?? null;

  if (!input.hasThread) {
    return { ok: true, agentId, threadAction: "create" };
  }

  return {
    ok: true,
    agentId,
    threadAction: agentId ? "bind" : "reuse",
  };
}
