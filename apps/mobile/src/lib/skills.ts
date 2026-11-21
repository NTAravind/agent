import type { Skill, SkillCreate, SkillPatch } from '@agent/shared';

import { authedFetch } from '@/lib/api-session';

/** The user's skills, each with its assigned agent ids. */
export async function fetchSkills(): Promise<Skill[]> {
  const response = await authedFetch<{ skills: Skill[] }>('/api/skills');
  return response.skills;
}

export async function createSkill(input: SkillCreate): Promise<Skill> {
  const response = await authedFetch<{ skill: Skill }>('/api/skills', {
    method: 'POST',
    body: JSON.stringify(input),
  });
  return response.skill;
}

export async function updateSkill(id: string, patch: SkillPatch): Promise<Skill> {
  const response = await authedFetch<{ skill: Skill }>(`/api/skills/${id}`, {
    method: 'PATCH',
    body: JSON.stringify(patch),
  });
  return response.skill;
}

export async function deleteSkill(id: string): Promise<void> {
  await authedFetch<{ deleted: boolean }>(`/api/skills/${id}`, {
    method: 'DELETE',
  });
}

/** Replaces the agent's whole skill assignment set. */
export async function setAgentSkills(agentId: string, skillIds: string[]): Promise<string[]> {
  const response = await authedFetch<{ agentId: string; skillIds: string[] }>(
    `/api/agents/${agentId}/skills`,
    {
      method: 'PUT',
      body: JSON.stringify({ skillIds }),
    },
  );
  return response.skillIds;
}
