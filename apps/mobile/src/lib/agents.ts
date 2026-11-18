import type {
  Agent,
  AgentCreate,
  AgentPatch,
  AgentRun,
  Approval,
  RunEvent,
  StartRunResponse,
} from "@agent/shared";

import { apiFetch } from "@/lib/api";
import { supabase } from "@/lib/supabase";

async function accessToken(): Promise<string | null> {
  const { data, error } = await supabase.auth.getSession();
  if (error || !data.session) return null;
  return data.session.access_token;
}

/** Starts an agent run (executed durably by Inngest). */
export async function startRun(goal: string, model?: string | null): Promise<StartRunResponse> {
  const token = await accessToken();
  if (!token) throw new Error('Not signed in.');
  return await apiFetch<StartRunResponse>("/api/agents/run", {
    token,
    init: { method: "POST", body: JSON.stringify({ goal, ...(model ? { model } : {}) }) },
  });
}

// --- Agent CRUD ------------------------------------------------------------

export type { Agent, AgentCreate, AgentPatch };

export async function fetchAgents(): Promise<Agent[]> {
  const token = await accessToken();
  if (!token) return [];
  const response = await apiFetch<{ agents: Agent[] }>("/api/agents", { token });
  return response.agents;
}

export async function createAgent(input: AgentCreate): Promise<Agent> {
  const token = await accessToken();
  if (!token) throw new Error('Not signed in.');
  const response = await apiFetch<{ agent: Agent }>("/api/agents", {
    token,
    init: { method: "POST", body: JSON.stringify(input) },
  });
  return response.agent;
}

export async function updateAgent(id: string, patch: AgentPatch): Promise<Agent> {
  const token = await accessToken();
  if (!token) throw new Error('Not signed in.');
  const response = await apiFetch<{ agent: Agent }>(`/api/agents/${id}`, {
    token,
    init: { method: "PATCH", body: JSON.stringify(patch) },
  });
  return response.agent;
}

/** Removes the agent; MCP attachments cascade, run history is kept. */
export async function deleteAgent(id: string): Promise<void> {
  const token = await accessToken();
  if (!token) throw new Error('Not signed in.');
  await apiFetch<{ deleted: boolean }>(`/api/agents/${id}`, {
    token,
    init: { method: "DELETE" },
  });
}

export type RunListItem = {
  id: string;
  goal: string;
  status: string;
  model: string | null;
  tokens_used: number;
  created_at: string;
  finished_at: string | null;
};

export async function fetchRuns(): Promise<RunListItem[]> {
  const token = await accessToken();
  if (!token) return [];
  const response = await apiFetch<{ runs: RunListItem[] }>("/api/runs", { token });
  return response.runs;
}

export type RunDetail = {
  run: AgentRun;
  events: RunEvent[];
  pendingApprovals?: Approval[];
};

export async function fetchRun(id: string): Promise<RunDetail> {
  const token = await accessToken();
  if (!token) throw new Error('Not signed in.');
  return await apiFetch<RunDetail>(`/api/runs/${id}`, { token });
}

/** Records an approve/deny decision; the run resumes via Inngest. */
export async function decideApproval(
  id: string,
  decision: 'approve' | 'deny',
): Promise<void> {
  const token = await accessToken();
  if (!token) throw new Error('Not signed in.');
  await apiFetch<{ ok: boolean }>(`/api/approvals/${id}`, {
    token,
    init: { method: 'POST', body: JSON.stringify({ decision }) },
  });
}
