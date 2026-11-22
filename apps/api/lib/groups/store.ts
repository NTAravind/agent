import type {
  AgentGroup,
  AgentGroupMember,
  GroupMemberRole,
  GroupMode,
} from "@agent/shared";
import { MAX_GROUP_MEMBERS } from "@agent/shared";

import { loadAgentSummaries } from "@/lib/agents";
import { supabaseAdmin } from "@/lib/supabase/server";
import type { GroupRuntime, GroupRuntimeMember } from "@/lib/groups/types";

/**
 * Persistence for agent groups (Phase 11).
 *
 * The service role bypasses RLS, so every top-level query filters by
 * `user_id`. Membership rows are reached only through group ids that were
 * already selected from the user's own groups.
 */

export type AgentGroupRow = {
  id: string;
  user_id: string;
  name: string;
  description: string | null;
  lead_agent_id: string | null;
  mode: GroupMode;
  max_hops: number;
  token_budget: number;
  created_at: string;
  updated_at: string;
};

type GroupMemberRow = {
  group_id: string;
  agent_id: string;
  role: GroupMemberRole;
  created_at?: string;
};

type AgentRow = {
  id: string;
  name: string;
  role: string | null;
  system_prompt: string | null;
  model: string | null;
  sleeping: boolean;
};

/** One child membership row plus the fields the atomic RPC needs. */
export type GroupMembershipMember = { agentId: string; role: GroupMemberRole };

export const ACTIVE_GROUP_RUN_STATUSES = [
  "queued",
  "running",
  "awaiting_approval",
  "paused",
] as const;

export const GROUP_COLUMNS =
  "id, user_id, name, description, lead_agent_id, mode, max_hops, token_budget, created_at, updated_at";

function groupError(message: string, status = 400, code = "bad_request"): Error {
  return Object.assign(new Error(message), { status, code });
}

/** Confirms every id is an agent owned by this user; returns the unique ids. */
async function assertOwnedAgents(
  userId: string,
  agentIds: string[],
): Promise<string[]> {
  const unique = [...new Set(agentIds)];
  if (unique.length === 0) return [];

  const { data, error } = await supabaseAdmin()
    .from("agents")
    .select("id")
    .eq("user_id", userId)
    .in("id", unique);
  if (error) throw new Error(`Could not verify group members: ${error.message}`);

  const owned = new Set((data ?? []).map((row) => row.id as string));
  const missing = unique.filter((id) => !owned.has(id));
  if (missing.length > 0) {
    throw groupError("One or more group members are unknown.", 400, "bad_request");
  }
  return unique;
}

/** The lead counts towards the group's size, so the cap is checked on the set. */
function assertMembershipSize(memberIds: string[]): void {
  if (memberIds.length > MAX_GROUP_MEMBERS) {
    throw groupError(
      `A group can have at most ${MAX_GROUP_MEMBERS} members.`,
      400,
      "bad_request",
    );
  }
}

async function loadMemberRows(groupIds: string[]): Promise<GroupMemberRow[]> {
  if (groupIds.length === 0) return [];
  const { data, error } = await supabaseAdmin()
    .from("group_members")
    .select("group_id, agent_id, role, created_at")
    .in("group_id", groupIds)
    .order("created_at", { ascending: true });
  if (error) throw new Error(`Could not load group members: ${error.message}`);
  return (data ?? []) as GroupMemberRow[];
}

async function loadAgentRows(userId: string, agentIds: string[]): Promise<AgentRow[]> {
  if (agentIds.length === 0) return [];
  const { data, error } = await supabaseAdmin()
    .from("agents")
    .select("id, name, role, system_prompt, model, sleeping")
    .eq("user_id", userId)
    .in("id", agentIds);
  if (error) throw new Error(`Could not load group agents: ${error.message}`);
  return (data ?? []) as AgentRow[];
}

function toRuntime(
  row: AgentGroupRow,
  memberRows: GroupMemberRow[],
  agentRows: AgentRow[],
): GroupRuntime {
  const byId = new Map(agentRows.map((agent) => [agent.id, agent]));
  const members: GroupRuntimeMember[] = memberRows.map((member) => {
    const agent = byId.get(member.agent_id);
    return {
      id: member.agent_id,
      name: agent?.name ?? "Agent",
      role: member.role,
      model: agent?.model ?? null,
      instructions: agent?.system_prompt ?? null,
      sleeping: agent?.sleeping === true,
      summary: { name: agent?.name ?? "Agent", avatar: { type: "emoji", value: "🤖" } },
    };
  });
  return {
    id: row.id,
    userId: row.user_id,
    name: row.name,
    description: row.description,
    leadAgentId: row.lead_agent_id,
    mode: row.mode,
    maxHops: row.max_hops,
    tokenBudget: row.token_budget,
    members,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
}

/** Runtime group with server-resolved members. */
export async function getGroupRuntime(
  userId: string,
  groupId: string,
): Promise<GroupRuntime | null> {
  const { data: group, error } = await supabaseAdmin()
    .from("agent_groups")
    .select(GROUP_COLUMNS)
    .eq("id", groupId)
    .eq("user_id", userId)
    .maybeSingle();
  if (error) throw new Error(`Could not read the group: ${error.message}`);
  if (!group) return null;

  const memberRows = await loadMemberRows([groupId]);
  const agentRows = await loadAgentRows(userId, memberRows.map((member) => member.agent_id));
  const runtime = toRuntime(group as AgentGroupRow, memberRows, agentRows);

  // Resolve signed image avatars for the members.
  const summaries = await loadAgentSummaries(
    runtime.members.map((member) => member.id),
    userId,
  );
  runtime.members = runtime.members.map((member) => ({
    ...member,
    summary: summaries.get(member.id) ?? member.summary,
  }));
  return runtime;
}

/** The user's groups, newest first. */
export async function listGroupRuntimes(userId: string): Promise<GroupRuntime[]> {
  const { data, error } = await supabaseAdmin()
    .from("agent_groups")
    .select(GROUP_COLUMNS)
    .eq("user_id", userId)
    .order("created_at", { ascending: false });
  if (error) throw new Error(`Could not list groups: ${error.message}`);

  const groups = (data ?? []) as AgentGroupRow[];
  const memberRows = await loadMemberRows(groups.map((group) => group.id));
  const agentRows = await loadAgentRows(userId, memberRows.map((member) => member.agent_id));
  const byGroup = new Map<string, GroupMemberRow[]>();
  for (const member of memberRows) {
    const list = byGroup.get(member.group_id) ?? [];
    list.push(member);
    byGroup.set(member.group_id, list);
  }

  const runtimes = groups.map((group) =>
    toRuntime(group, byGroup.get(group.id) ?? [], agentRows),
  );
  const summaries = await loadAgentSummaries(
    runtimes.flatMap((group) => group.members.map((member) => member.id)),
    userId,
  );
  return runtimes.map((group) => ({
    ...group,
    members: group.members.map((member) => ({
      ...member,
      summary: summaries.get(member.id) ?? member.summary,
    })),
  }));
}

/** Maps a runtime group to the shared camelCase API shape. */
export function toPublicGroup(group: GroupRuntime): AgentGroup {
  const members: AgentGroupMember[] = group.members.map((member) => ({
    agentId: member.id,
    role: member.role,
    agent: member.summary,
  }));
  return {
    id: group.id,
    name: group.name,
    description: group.description,
    leadAgentId: group.leadAgentId,
    mode: group.mode,
    maxHops: group.maxHops,
    tokenBudget: group.tokenBudget,
    members,
    createdAt: group.createdAt,
    updatedAt: group.updatedAt,
  };
}

/** Creates a group and replaces its initial membership atomically enough for the API. */
export async function createGroup(input: {
  userId: string;
  name: string;
  description?: string | null;
  leadAgentId: string;
  mode?: GroupMode;
  maxHops?: number;
  tokenBudget?: number;
  memberIds: string[];
}): Promise<GroupRuntime> {
  const memberIds = await assertOwnedAgents(input.userId, [
    input.leadAgentId,
    ...input.memberIds,
  ]);
  if (!memberIds.includes(input.leadAgentId)) memberIds.unshift(input.leadAgentId);
  assertMembershipSize(memberIds);

  const { data, error } = await supabaseAdmin()
    .from("agent_groups")
    .insert({
      user_id: input.userId,
      name: input.name,
      description: input.description ?? null,
      lead_agent_id: input.leadAgentId,
      mode: input.mode ?? "handoff",
      max_hops: input.maxHops ?? 8,
      token_budget: input.tokenBudget ?? 50_000,
    })
    .select(GROUP_COLUMNS)
    .single();
  if (error || !data) {
    throw new Error(`Could not create the group: ${error?.message ?? "insert failed"}`);
  }

  const group = data as AgentGroupRow;
  const rows = memberIds.map((agentId) => ({
    group_id: group.id,
    agent_id: agentId,
    role: agentId === input.leadAgentId ? "lead" : "member",
  }));
  const memberInsert = await supabaseAdmin().from("group_members").insert(rows);
  if (memberInsert.error) {
    // Best-effort rollback: the group must never survive without its members.
    await supabaseAdmin().from("agent_groups").delete().eq("id", group.id).eq("user_id", input.userId);
    throw new Error(`Could not add group members: ${memberInsert.error.message}`);
  }

  const runtime = await getGroupRuntime(input.userId, group.id);
  if (!runtime) throw new Error("The group was created but could not be read back.");
  return runtime;
}

/** Updates group metadata (membership is replaced through the members route). */
export async function updateGroup(
  userId: string,
  groupId: string,
  patch: {
    name?: string;
    description?: string | null;
    mode?: GroupMode;
    maxHops?: number;
    tokenBudget?: number;
  },
): Promise<GroupRuntime | null> {
  const current = await getGroupRuntime(userId, groupId);
  if (!current) return null;

  const update: Record<string, unknown> = {};
  if (patch.name !== undefined) update.name = patch.name;
  if (patch.description !== undefined) update.description = patch.description;
  if (patch.mode !== undefined) update.mode = patch.mode;
  if (patch.maxHops !== undefined) update.max_hops = patch.maxHops;
  if (patch.tokenBudget !== undefined) update.token_budget = patch.tokenBudget;

  const { data, error } = await supabaseAdmin()
    .from("agent_groups")
    .update(update)
    .eq("id", groupId)
    .eq("user_id", userId)
    .select(GROUP_COLUMNS)
    .single();
  if (error || !data) {
    throw new Error(`Could not update the group: ${error?.message ?? "update failed"}`);
  }
  return getGroupRuntime(userId, groupId);
}

/** Replaces the membership of a group and keeps the lead row consistent. */
export async function replaceGroupMembers(
  userId: string,
  groupId: string,
  input: { leadAgentId: string; memberIds: string[] },
): Promise<GroupRuntime | null> {
  const current = await getGroupRuntime(userId, groupId);
  if (!current) return null;

  const memberIds = await assertOwnedAgents(userId, [input.leadAgentId, ...input.memberIds]);
  if (!memberIds.includes(input.leadAgentId)) memberIds.unshift(input.leadAgentId);
  assertMembershipSize(memberIds);

  // One transactional RPC swaps the whole set: no reader can observe a group
  // with zero (or half-replaced) members, and the lead column updates with it.
  const members: GroupMembershipMember[] = memberIds.map((agentId) => ({
    agentId,
    role: agentId === input.leadAgentId ? ("lead" as const) : ("member" as const),
  }));
  const { error } = await supabaseAdmin().rpc("replace_group_members", {
    p_group_id: groupId,
    p_user_id: userId,
    p_lead_agent_id: input.leadAgentId,
    p_members: members,
  });
  if (error) {
    throw new Error(`Could not replace group members: ${error.message}`);
  }

  return getGroupRuntime(userId, groupId);
}

/**
 * Active (queued/running/awaiting/paused) runs for a group. A group cannot be
 * deleted while one exists — its thread, messages and children reference it.
 */
export async function listActiveGroupRuns(
  userId: string,
  groupId: string,
): Promise<Array<{ id: string; parent_run_id: string | null; status: string }>> {
  const { data, error } = await supabaseAdmin()
    .from("agent_runs")
    .select("id, parent_run_id, status")
    .eq("group_id", groupId)
    .eq("user_id", userId)
    .in("status", [...ACTIVE_GROUP_RUN_STATUSES]);
  if (error) throw new Error(`Could not read the group's active runs: ${error.message}`);
  return (data ?? []) as Array<{ id: string; parent_run_id: string | null; status: string }>;
}

/**
 * The group's newest parent run that is still in flight, or null. Used to
 * recover the "running" pill after the app is killed mid-run.
 */
export async function findActiveGroupParentRun(
  userId: string,
  groupId: string,
): Promise<{ id: string; status: string } | null> {
  const { data, error } = await supabaseAdmin()
    .from("agent_runs")
    .select("id, status")
    .eq("group_id", groupId)
    .eq("user_id", userId)
    .is("parent_run_id", null)
    .in("status", [...ACTIVE_GROUP_RUN_STATUSES])
    .order("created_at", { ascending: false })
    .limit(1)
    .maybeSingle();
  if (error) throw new Error(`Could not read the group's active runs: ${error.message}`);
  return (data as { id: string; status: string } | null) ?? null;
}

/** Deletes a group owned by the user. */
export async function deleteGroup(userId: string, groupId: string): Promise<boolean> {
  const { data, error } = await supabaseAdmin()
    .from("agent_groups")
    .delete()
    .eq("id", groupId)
    .eq("user_id", userId)
    .select("id");
  if (error) throw new Error(`Could not delete the group: ${error.message}`);
  return Boolean(data?.length);
}
