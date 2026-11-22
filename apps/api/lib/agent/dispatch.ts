export type RunDispatchKind = "group" | "group-member" | "supervisor" | "agent";

/**
 * Chooses the graph for a durable run.
 *
 * A group parent has a group id but no member agent. A group member turn also
 * has the group id, but is a child of that parent and must always resume the
 * existing single-agent graph—even when the member is configured as a
 * Supervisor agent.
 */
export function selectRunDispatch(input: {
  groupId: string | null;
  parentRunId: string | null;
  agentId: string | null;
  isSupervisor: boolean;
}): RunDispatchKind {
  if (input.groupId && input.parentRunId) return "group-member";
  if (input.groupId && !input.agentId) return "group";
  if (input.isSupervisor) return "supervisor";
  return "agent";
}
