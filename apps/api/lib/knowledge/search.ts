import type { Memory, Note, NoteChunk, NoteWithContent } from "@agent/shared";

import { embedTexts } from "@/lib/models/embeddings";
import { supabaseAdmin } from "@/lib/supabase/server";

/** Formats a 768-dimension embedding for PostgRPC. */
export function toVectorLiteral(embedding: number[]): string {
  return `[${embedding.join(",")}]`;
}

export type SearchNotesOptions = {
  userId: string;
  query: string;
  k?: number;
};

/**
 * Hybrid search over note chunks: cosine similarity fused with full-text rank
 * (reciprocal-rank fusion, done in the SQL function).
 */
export async function searchNotes({
  userId,
  query,
  k = 8,
}: SearchNotesOptions): Promise<NoteChunk[]> {
  const trimmed = query.trim();
  if (!trimmed) return [];

  let embedding: number[] = [];
  try {
    [embedding] = await embedTexts([trimmed]);
  } catch (error) {
    console.warn("[knowledge] could not embed the query, falling back to lexical search:", error);
  }

  const { data, error } = await supabaseAdmin().rpc("search_notes", {
    p_user_id: userId,
    query_embedding: embedding.length > 0 ? toVectorLiteral(embedding) : null,
    query_text: trimmed,
    k,
  });

  if (error) {
    console.warn("[knowledge] search_notes failed:", error.message);
    return [];
  }

  return (data ?? []) as NoteChunk[];
}

export async function searchMemories({
  userId,
  query,
  k = 8,
}: {
  userId: string;
  query: string;
  k?: number;
}): Promise<Array<Memory & { score: number }>> {
  const trimmed = query.trim();
  if (!trimmed) return [];

  let embedding: number[] = [];
  try {
    [embedding] = await embedTexts([trimmed]);
  } catch (error) {
    console.warn("[knowledge] could not embed the memory query:", error);
    return [];
  }
  if (embedding.length === 0) return [];

  const { data, error } = await supabaseAdmin().rpc("search_memories", {
    p_user_id: userId,
    query_embedding: toVectorLiteral(embedding),
    k,
  });

  if (error) {
    console.warn("[knowledge] search_memories failed:", error.message);
    return [];
  }

  return (data ?? []) as Array<Memory & { score: number }>;
}

export async function listNotes(userId: string, limit = 200): Promise<Note[]> {
  const { data, error } = await supabaseAdmin()
    .from("notes")
    .select("id, path, title, frontmatter, content_hash, updated_at")
    .eq("user_id", userId)
    .order("path", { ascending: true })
    .limit(limit);

  if (error) {
    console.warn("[knowledge] listNotes failed:", error.message);
    return [];
  }

  return (data ?? []) as Note[];
}

export async function countChunks(userId: string): Promise<number> {
  const { count } = await supabaseAdmin()
    .from("note_chunks")
    .select("id", { count: "exact", head: true })
    .eq("note_id", userId); // placeholder, replaced below
  void count;

  const { data: noteIds } = await supabaseAdmin()
    .from("notes")
    .select("id")
    .eq("user_id", userId);

  if (!noteIds || noteIds.length === 0) return 0;

  const { count: chunkCount } = await supabaseAdmin()
    .from("note_chunks")
    .select("id", { count: "exact", head: true })
    .in("note_id", noteIds.map((note) => note.id));

  return chunkCount ?? 0;
}

/** Reads a note with its outgoing links and the notes that link back to it. */
export async function getNote(userId: string, path: string): Promise<NoteWithContent | null> {
  const { data: note, error } = await supabaseAdmin()
    .from("notes")
    .select("id, path, title, frontmatter, content_hash, updated_at")
    .eq("user_id", userId)
    .eq("path", path)
    .maybeSingle();

  if (error || !note) return null;

  const { data: chunks } = await supabaseAdmin()
    .from("note_chunks")
    .select("heading, content")
    .eq("note_id", note.id)
    .order("idx", { ascending: true });

  const content = (chunks ?? []).map((chunk) => chunk.content).join("\n\n");

  const { data: links } = await supabaseAdmin()
    .from("note_links")
    .select("to_path")
    .eq("from_note", note.id);

  const { data: backlinkRows } = await supabaseAdmin()
    .from("note_links")
    .select("from_note")
    .eq("to_path", path);

  const backlinkIds = (backlinkRows ?? []).map((row) => row.from_note as string);
  let backlinks: NoteWithContent["backlinks"] = [];
  if (backlinkIds.length > 0) {
    const { data: backlinkNotes } = await supabaseAdmin()
      .from("notes")
      .select("path, title")
      .eq("user_id", userId)
      .in("id", backlinkIds);
    backlinks = (backlinkNotes ?? []) as NoteWithContent["backlinks"];
  }

  return {
    note: note as Note,
    content,
    links: (links ?? []).map((row) => row.to_path as string),
    backlinks,
  };
}

export async function listMemories(userId: string, limit = 200): Promise<Memory[]> {
  const { data, error } = await supabaseAdmin()
    .from("memories")
    .select("id, kind, content, source_thread_id, created_at")
    .eq("user_id", userId)
    .order("created_at", { ascending: false })
    .limit(limit);

  if (error) {
    console.warn("[knowledge] listMemories failed:", error.message);
    return [];
  }

  return (data ?? []) as Memory[];
}

export async function deleteMemory(userId: string, id: string): Promise<void> {
  await supabaseAdmin().from("memories").delete().eq("id", id).eq("user_id", userId);
}

/**
 * Upserts memories, skipping near-duplicates.
 * `similar` is the cosine similarity threshold above which a memory counts
 * as already known.
 */
export async function upsertMemories(
  userId: string,
  items: Array<{ kind: Memory["kind"]; content: string; sourceThreadId?: string | null }>,
  { similar = 0.92 }: { similar?: number } = {},
): Promise<{ inserted: number; skipped: number }> {
  if (items.length === 0) return { inserted: 0, skipped: 0 };

  const embeddings = await embedTexts(items.map((item) => item.content));

  let inserted = 0;
  let skipped = 0;

  for (const [index, item] of items.entries()) {
    const embedding = embeddings[index];
    if (!embedding) continue;

    const { data: similarRows } = await supabaseAdmin().rpc("search_memories", {
      p_user_id: userId,
      query_embedding: toVectorLiteral(embedding),
      k: 1,
    });

    const best = (similarRows ?? [])[0] as { score?: number } | undefined;
    if (best && typeof best.score === "number" && best.score >= similar) {
      skipped += 1;
      continue;
    }

    const { error } = await supabaseAdmin().from("memories").insert({
      user_id: userId,
      kind: item.kind,
      content: item.content,
      source_thread_id: item.sourceThreadId ?? null,
      embedding: toVectorLiteral(embedding),
    });

    if (error) {
      console.warn("[knowledge] could not store a memory:", error.message);
      continue;
    }
    inserted += 1;
  }

  return { inserted, skipped };
}
