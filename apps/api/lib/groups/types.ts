import type { AgentSummary, GroupMemberRole, GroupMode } from "@agent/shared";

/** A group member as the runtime sees it (never taken from model arguments). */
export type GroupRuntimeMember = {
  id: string;
  name: string;
  role: GroupMemberRole;
  model: string | null;
  instructions: string | null;
  /** Asleep members are rejected at run entry and skipped by routing. */
  sleeping: boolean;
  summary: AgentSummary;
};

/** The persisted group configuration plus its server-resolved members. */
export type GroupRuntime = {
  id: string;
  userId: string;
  name: string;
  description: string | null;
  leadAgentId: string | null;
  mode: GroupMode;
  maxHops: number;
  tokenBudget: number;
  members: GroupRuntimeMember[];
  createdAt: string;
  updatedAt: string;
};

/**
 * Context handed to one member turn. It is stored on the child run so an
 * approval resume can rebuild the exact same tool set and privacy policy.
 */
export type GroupToolContext = {
  groupId: string;
  parentRunId: string;
  threadId: string | null;
  actingAgentId: string;
  mode: GroupMode;
  members: Array<{
    id: string;
    name: string;
    model: string | null;
  }>;
  /** The compact task for this turn. */
  brief: string;
  /** Rolling group summary, capped by the server. */
  summary: string;
  /** Nested-ask depth for this turn. */
  depth: number;
  /** Maximum nested-ask depth permitted by the runtime. */
  maxDepth: number;
  /** Whether this member's model may see note/memory-derived context. */
  privateAllowed: boolean;
  /** Handoff turns expose handoff_to; nested consults do not. */
  canHandoff: boolean;
};

/** The handoff marker returned by the handoff_to tool. */
export type GroupHandoff = {
  from: string;
  to: string;
  toName: string;
  task: string;
  context?: string;
};
