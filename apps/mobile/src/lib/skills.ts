import type { Skill, SkillCreate, SkillPatch } from '@agent/shared';

import { apiFetch } from '@/lib/api';
import { supabase } from '@/lib/supabase';

async function accessToken(): Promise<string | null> {
  const { data, error } = await supabase.auth.getSession();
  if (error || !data.session) return null;
  return data.session.access_token;
}

/** The user's skills, each with its assigned agent ids. */
export async function fetchSkills(): Promise<Skill[]> {
  const token = await accessToken();
  if (!token) return [];
  const response = await apiFetch<{ skills: Skill[] }>('/api/skills', { token });
  return response.skills;
}

export async function createSkill(input: SkillCreate): Promise<Skill> {
  const token = await accessToken();
  if (!token) throw new Error('Not signed in.');
  const response = await apiFetch<{ skill: Skill }>('/api/skills', {
    token,
    init: { method: 'POST', body: JSON.stringify(input) },
  });
  return response.skill;
}

export async function updateSkill(id: string, patch: SkillPatch): Promise<Skill> {
  const token = await accessToken();
  if (!token) throw new Error('Not signed in.');
  const response = await apiFetch<{ skill: Skill }>(`/api/skills/${id}`, {
    token,
    init: { method: 'PATCH', body: JSON.stringify(patch) },
  });
  return response.skill;
}

export async function deleteSkill(id: string): Promise<void> {
  const token = await accessToken();
  if (!token) throw new Error('Not signed in.');
  await apiFetch<{ deleted: boolean }>(`/api/skills/${id}`, {
    token,
    init: { method: 'DELETE' },
  });
}

/** Replaces the agent's whole skill assignment set. */
export async function setAgentSkills(agentId: string, skillIds: string[]): Promise<string[]> {
  const token = await accessToken();
  if (!token) throw new Error('Not signed in.');
  const response = await apiFetch<{ agentId: string; skillIds: string[] }>(
    `/api/agents/${agentId}/skills`,
    {
      token,
      init: { method: 'PUT', body: JSON.stringify({ skillIds }) },
    },
  );
  return response.skillIds;
}
