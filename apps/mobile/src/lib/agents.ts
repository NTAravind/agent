import type { AgentRun, RunEvent, StartRunResponse } from "@agent/shared";

import { apiFetch } from "@/lib/api";
import { supabase } from "@/lib/supabase";

async function accessToken(): Promise<string | null> {
  const { data, error } = await supabase.auth.getSession();
  if (error || !data.session) return null;
  return data.session.access_token;
}

/** Starts an agent run (executed durably by Inngest). */
export async function startRun(goal: string): Promise<StartRunResponse> {
  const token = await accessToken();
  if (!token) throw new Error('Not signed in.');
  return await apiFetch<StartRunResponse>("/api/agents/run", {
    token,
    init: { method: "POST", body: JSON.stringify({ goal }) },
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
};

export async function fetchRun(id: string): Promise<RunDetail> {
  const token = await accessToken();
  if (!token) throw new Error('Not signed in.');
  return await apiFetch<RunDetail>(`/api/runs/${id}`, { token });
}
