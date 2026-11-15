import type { Memory, Note, NoteChunk, NoteWithContent } from "@agent/shared";

import { apiFetch } from "@/lib/api";
import { supabase } from "@/lib/supabase";

async function accessToken(): Promise<string | null> {
  const { data, error } = await supabase.auth.getSession();
  if (error || !data.session) return null;
  return data.session.access_token;
}

export async function fetchNotes(): Promise<Note[]> {
  const token = await accessToken();
  if (!token) return [];
  const response = await apiFetch<{ notes: Note[] }>("/api/notes", { token });
  return response.notes;
}

export async function searchNotes(query: string, k = 10): Promise<NoteChunk[]> {
  const token = await accessToken();
  if (!token) return [];
  const response = await apiFetch<{ matches: NoteChunk[] }>(
    `/api/notes?q=${encodeURIComponent(query)}&k=${k}`,
    { token },
  );
  return response.matches;
}

export async function fetchNote(path: string): Promise<NoteWithContent | null> {
  const token = await accessToken();
  if (!token) return null;
  return await apiFetch<NoteWithContent>(`/api/notes/${encodeURIComponent(path)}`, { token });
}

export async function fetchMemories(): Promise<Memory[]> {
  const token = await accessToken();
  if (!token) return [];
  const response = await apiFetch<{ memories: Memory[] }>("/api/memories", { token });
  return response.memories;
}

export async function deleteMemory(id: string): Promise<void> {
  const token = await accessToken();
  if (!token) return;
  await apiFetch<{ ok: boolean }>(`/api/memories/${id}`, { token, init: { method: "DELETE" } });
}

export async function syncVault(): Promise<{ ok: boolean; queued?: boolean; message?: string }> {
  const token = await accessToken();
  if (!token) return { ok: false, message: "Not signed in." };

  try {
    return await apiFetch<{ ok: boolean; queued?: boolean; message?: string }>("/api/notes/sync", {
      token,
      init: { method: "POST", body: JSON.stringify({}) },
    });
  } catch (error) {
    return {
      ok: false,
      message: error instanceof Error ? error.message : String(error),
    };
  }
}
