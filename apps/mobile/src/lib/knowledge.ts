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

/**
 * Creates or updates a vault note (Phase 9).
 *
 * The API commits straight to the vault — user-initiated edits never need an
 * approval — and upserts the notes index.
 */
export async function saveNote(path: string, content: string): Promise<void> {
  const token = await accessToken();
  if (!token) throw new Error("Not signed in.");
  await apiFetch<{ note: unknown; vaultCommitted: boolean }>(
    `/api/notes/${encodeURIComponent(path)}`,
    {
      token,
      init: {
        method: "PUT",
        body: content,
        headers: { "Content-Type": "text/markdown" },
      },
    },
  );
}

/** Deletes a vault note (Phase 9). */
export async function deleteNote(path: string): Promise<void> {
  const token = await accessToken();
  if (!token) throw new Error("Not signed in.");
  await apiFetch<{ deleted: boolean }>(`/api/notes/${encodeURIComponent(path)}`, {
    token,
    init: { method: "DELETE" },
  });
}

/** Suggests a vault path for a brand new note. */
export function suggestNotePath(title: string): string {
  const slug = title
    .trim()
    .replace(/[^\w\s-]/g, '')
    .replace(/\s+/g, '-')
    .replace(/-+/g, '-')
    .toLowerCase()
    .slice(0, 60);
  const stamp = new Date().toISOString().slice(0, 16).replace(/[:T]/g, '-');
  return `${slug || 'untitled'}-${stamp}.md`;
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
