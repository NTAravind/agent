import type { ModelInfo, ModelsResponse, Thread, ThreadWithMessages } from "@agent/shared";

import { apiFetch } from "@/lib/api";
import { supabase } from "@/lib/supabase";

async function accessToken(): Promise<string | null> {
  const { data, error } = await supabase.auth.getSession();
  if (error || !data.session) return null;
  return data.session.access_token;
}

/** Registry + provider availability, used by the model picker. */
export async function fetchModels(): Promise<ModelsResponse | null> {
  try {
    const token = await accessToken();
    if (!token) return null;
    return await apiFetch<ModelsResponse>("/api/models", { token });
  } catch (error) {
    console.warn("[models] could not load the registry:", error);
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
