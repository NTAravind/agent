import type {
  AgentGroup,
  GroupCreate,
  GroupMembers,
  GroupMode,
  GroupPatch,
  StartRunResponse,
  Thread,
} from '@agent/shared';

import { authedFetch } from '@/lib/api-session';

/** Lists the user's dynamic agent groups. */
export async function fetchGroups(): Promise<AgentGroup[]> {
  const response = await authedFetch<{ groups: AgentGroup[] }>('/api/groups');
  return response.groups;
}

/** Reads one owned group. */
export async function fetchGroup(id: string): Promise<AgentGroup> {
  const response = await authedFetch<{ group: AgentGroup }>(`/api/groups/${id}`);
  return response.group;
}

/** Creates a group and its membership. */
export async function createGroup(input: GroupCreate): Promise<AgentGroup> {
  const response = await authedFetch<{ group: AgentGroup }>('/api/groups', {
    method: 'POST',
    body: JSON.stringify(input),
  });
  return response.group;
}

/** Updates group metadata. */
export async function updateGroup(id: string, patch: GroupPatch): Promise<AgentGroup> {
  const response = await authedFetch<{ group: AgentGroup }>(`/api/groups/${id}`, {
    method: 'PATCH',
    body: JSON.stringify(patch),
  });
  return response.group;
}

/** Replaces the group's whole membership set; the lead is included. */
export async function replaceGroupMembers(id: string, input: GroupMembers): Promise<AgentGroup> {
  const response = await authedFetch<{ group: AgentGroup }>(`/api/groups/${id}/members`, {
    method: 'PUT',
    body: JSON.stringify(input),
  });
  return response.group;
}

/** Deletes a group while preserving its chat history. */
export async function deleteGroup(id: string): Promise<void> {
  await authedFetch<{ deleted: boolean }>(`/api/groups/${id}`, { method: 'DELETE' });
}

/** Creates a durable chat thread owned by a group. */
export async function createGroupThread(groupId: string, title?: string): Promise<Thread> {
  const response = await authedFetch<{ thread: Thread }>('/api/threads', {
    method: 'POST',
    body: JSON.stringify({
      groupId,
      ...(title ? { title } : {}),
    }),
  });
  return response.thread;
}

export type StartGroupRunInput = {
  groupId: string;
  threadId: string;
  goal: string;
  tz?: string;
};

/** Starts a group run through the same durable pipeline as ordinary agents. */
export async function startGroupRun(input: StartGroupRunInput): Promise<StartRunResponse> {
  return await authedFetch<StartRunResponse>('/api/agents/run', {
    method: 'POST',
    body: JSON.stringify({
      groupId: input.groupId,
      threadId: input.threadId,
      goal: input.goal,
      ...(input.tz ? { tz: input.tz } : {}),
    }),
  });
}

export type { AgentGroup, GroupCreate, GroupMembers, GroupMode, GroupPatch };
