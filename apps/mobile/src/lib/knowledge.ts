import type { Memory, Note, NoteChunk, NoteWithContent } from "@agent/shared";

import { authedFetch } from "@/lib/api-session";

export async function fetchNotes(): Promise<Note[]> {
  const response = await authedFetch<{ notes: Note[] }>("/api/notes");
  return response.notes;
}

export async function searchNotes(query: string, k = 10): Promise<NoteChunk[]> {
  const response = await authedFetch<{ matches: NoteChunk[] }>(
    `/api/notes?q=${encodeURIComponent(query)}&k=${k}`
  );
  return response.matches;
}

export async function fetchNote(path: string): Promise<NoteWithContent | null> {
  return await authedFetch<NoteWithContent>(`/api/notes/${encodeURIComponent(path)}`);
}

/**
 * Creates or updates a vault note (Phase 9).
 *
 * The API commits straight to the vault — user-initiated edits never need an
 * approval — and upserts the notes index.
 */
export async function saveNote(path: string, content: string): Promise<void> {
  await authedFetch<{ note: unknown; vaultCommitted: boolean }>(
    `/api/notes/${encodeURIComponent(path)}`,
    {
      method: "PUT",
      body: content,
      headers: { "Content-Type": "text/markdown" },
    },
  );
}

/** Deletes a vault note (Phase 9). */
export async function deleteNote(path: string): Promise<void> {
  await authedFetch<{ deleted: boolean }>(`/api/notes/${encodeURIComponent(path)}`, {
    method: "DELETE",
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
  const response = await authedFetch<{ memories: Memory[] }>("/api/memories");
  return response.memories;
}

export async function deleteMemory(id: string): Promise<void> {
  await authedFetch<{ ok: boolean }>(`/api/memories/${id}`, { method: "DELETE" });
}

export async function syncVault(): Promise<{ ok: boolean; queued?: boolean; message?: string }> {
  try {
    return await authedFetch<{ ok: boolean; queued?: boolean; message?: string }>("/api/notes/sync", {
      method: "POST",
      body: JSON.stringify({}),
    });
  } catch (error) {
    return {
      ok: false,
      message: error instanceof Error ? error.message : String(error),
    };
  }
}
