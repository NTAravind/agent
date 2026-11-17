import type { ModelInfo, ModelsResponse, Thread, ThreadWithMessages } from "@agent/shared";

import { apiFetch } from "@/lib/api";
import { supabase } from "@/lib/supabase";

async function accessToken(): Promise<string | null> {
  const { data, error } = await supabase.auth.getSession();
  if (error || !data.session) return null;
  return data.session.access_token;
}

/** Fetch only dashboard-enabled models, plus provider availability metadata. */
export async function fetchEnabledModels(): Promise<ModelsResponse | null> {
  try {
    const token = await accessToken();
    if (!token) return null;
    return await apiFetch<ModelsResponse>("/api/models", { token, init: { cache: "no-store" } });
  } catch (error) {
    console.warn("[models] could not load enabled models:", error);
    return null;
  }
}

export async function fetchThreads(): Promise<Thread[]> {
  const token = await accessToken();
  if (!token) return [];
  const response = await apiFetch<{ threads: Thread[] }>("/api/threads", { token });
  return response.threads;
}

export async function fetchThread(threadId: string): Promise<ThreadWithMessages | null> {
  const token = await accessToken();
  if (!token) return null;
  return await apiFetch<ThreadWithMessages>(`/api/threads/${threadId}`, { token });
}

export async function deleteThread(threadId: string): Promise<void> {
  const token = await accessToken();
  if (!token) return;
  await apiFetch<{ ok: boolean }>(`/api/threads/${threadId}`, { token, init: { method: "DELETE" } });
}

export type ModelOption = Pick<
  ModelInfo,
  "id" | "provider" | "label" | "capabilities" | "tier" | "available" | "privateOk"
>;
