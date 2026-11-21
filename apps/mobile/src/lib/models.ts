import type { ModelInfo, ModelsResponse, Thread, ThreadWithMessages } from "@agent/shared";

import { authedFetch } from "@/lib/api-session";

/** Fetch only dashboard-enabled models, plus provider availability metadata. */
export async function fetchEnabledModels(): Promise<ModelsResponse | null> {
  try {
    return await authedFetch<ModelsResponse>("/api/models", { cache: "no-store" });
  } catch (error) {
    console.warn("[models] could not load enabled models:", error);
    return null;
  }
}

export async function fetchThreads(): Promise<Thread[]> {
  const response = await authedFetch<{ threads: Thread[] }>("/api/threads");
  return response.threads;
}

export async function fetchThread(threadId: string): Promise<ThreadWithMessages | null> {
  return await authedFetch<ThreadWithMessages>(`/api/threads/${threadId}`);
}

export async function deleteThread(threadId: string): Promise<void> {
  await authedFetch<{ ok: boolean }>(`/api/threads/${threadId}`, { method: "DELETE" });
}

export type ModelOption = Pick<
  ModelInfo,
  "id" | "provider" | "label" | "capabilities" | "tier" | "available" | "privateOk"
>;
