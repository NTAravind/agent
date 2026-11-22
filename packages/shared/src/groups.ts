import { z } from "zod";

import { AgentSummarySchema } from "./agents";

/** The supported collaboration patterns for an agent group. */
export const GroupModeSchema = z.enum(["handoff", "roundtable"]);
export type GroupMode = z.infer<typeof GroupModeSchema>;

/** A member's role within a group. */
export const GroupMemberRoleSchema = z.enum(["lead", "member"]);
export type GroupMemberRole = z.infer<typeof GroupMemberRoleSchema>;

/**
 * The maximum size of a group, counting the lead. The lead is always part of
 * the membership, so a request may list at most `MAX_GROUP_MEMBERS - 1`
 * additional members.
 */
export const MAX_GROUP_MEMBERS = 12;

/** Request body for creating a group. */
export const GroupCreateSchema = z.object({
  name: z.string().min(1).max(100),
  description: z.string().max(500).nullish(),
  leadAgentId: z.string().uuid(),
  mode: GroupModeSchema.optional(),
  maxHops: z.number().int().min(1).max(20).optional(),
  tokenBudget: z.number().int().min(1000).max(500000).optional(),
  memberIds: z.array(z.string().uuid()).max(MAX_GROUP_MEMBERS - 1).optional(),
});
export type GroupCreate = z.infer<typeof GroupCreateSchema>;

/** Request body for updating a group. */
export const GroupPatchSchema = GroupCreateSchema.partial();
export type GroupPatch = z.infer<typeof GroupPatchSchema>;

/** Replacement membership for a group. The lead is added server-side. */
export const GroupMembersSchema = z.object({
  leadAgentId: z.string().uuid(),
  memberIds: z.array(z.string().uuid()).min(1).max(MAX_GROUP_MEMBERS - 1),
});
export type GroupMembers = z.infer<typeof GroupMembersSchema>;

/** A group member with its compact agent summary. */
export const AgentGroupMemberSchema = z.object({
  agentId: z.string().uuid(),
  role: GroupMemberRoleSchema,
  agent: AgentSummarySchema,
});
export type AgentGroupMember = z.infer<typeof AgentGroupMemberSchema>;

/** Agent group as returned by the API. */
export const AgentGroupSchema = z.object({
  id: z.string().uuid(),
  name: z.string(),
  description: z.string().nullable(),
  leadAgentId: z.string().uuid().nullable(),
  mode: GroupModeSchema,
  maxHops: z.number().int(),
  tokenBudget: z.number().int(),
  members: z.array(AgentGroupMemberSchema),
  /** Latest durable chat thread for this group, when one exists. */
  threadId: z.string().uuid().nullable().optional(),
  /** The group's live parent run, when one is in flight. */
  activeParentRunId: z.string().uuid().nullable().optional(),
  /** Status of the live parent run (queued/running/awaiting_approval/paused). */
  activeParentRunStatus: z.string().nullable().optional(),
  createdAt: z.string(),
  updatedAt: z.string(),
});
export type AgentGroup = z.infer<typeof AgentGroupSchema>;

/** Handoff metadata persisted with a group message. */
export const GroupHandoffSchema = z.object({
  from: z.string().uuid(),
  to: z.string().uuid(),
  task: z.string(),
});
export type GroupHandoff = z.infer<typeof GroupHandoffSchema>;

/** Handoff metadata returned by the API, optionally linked to its run. */
export const GroupHandoffPayloadSchema = GroupHandoffSchema.extend({
  runId: z.string().uuid().optional(),
});
export type GroupHandoffPayload = z.infer<typeof GroupHandoffPayloadSchema>;
