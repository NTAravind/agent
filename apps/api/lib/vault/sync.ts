import { embedTexts } from "@/lib/models/embeddings";
import { supabaseAdmin } from "@/lib/supabase/server";
import { fetchVaultFile, isVaultConfigured, listVaultFiles, vaultRepo } from "./github";
import { contentHash, parseNote } from "./parse";

export type SyncResult = {
  repo: string | null;
  synced: number;
  skipped: number;
  removed: number;
  chunks: number;
  errors: string[];
};

/**
 * Pulls the vault from GitHub and refreshes the index.
 *
 * Notes are skipped when their git blob sha is unchanged, so a sync only
 * re-embeds what actually changed.
 */
export async function syncVault(userId: string): Promise<SyncResult> {
  const result: SyncResult = {
    repo: vaultRepo() ? `${vaultRepo()!.owner}/${vaultRepo()!.repo}` : null,
    synced: 0,
    skipped: 0,
    removed: 0,
    chunks: 0,
    errors: [],
  };

  if (!isVaultConfigured()) {
    result.errors.push("The GitHub vault is not configured.");
    return result;
  }

  const files = await listVaultFiles();
  const { data: existingRows } = await supabaseAdmin()
    .from("notes")
    .select("id, path, git_sha")
    .eq("user_id", userId);

  const existing = new Map(
    ((existingRows ?? []) as Array<{ id: string; path: string; git_sha: string | null }>).map(
      (row) => [row.path, row],
    ),
  );

  const seenPaths = new Set<string>();

  for (const file of files) {
    seenPaths.add(file.path);
    const previous = existing.get(file.path);

    if (previous && previous.git_sha === file.sha) {
      result.skipped += 1;
      continue;
    }

    try {
      const vaultFile = await fetchVaultFile(file.path);
      if (!vaultFile) {
        result.errors.push(`Could not read ${file.path}`);
        continue;
      }

      const parsed = parseNote(vaultFile.content);
      const hash = contentHash(vaultFile.content);

      const embeddings =
        parsed.chunks.length > 0 ? await embedTexts(parsed.chunks.map((chunk) => chunk.content)) : [];

      const { data: note, error: upsertError } = await supabaseAdmin()
        .from("notes")
        .upsert(
          {
            user_id: userId,
            path: file.path,
            title: parsed.title,
            frontmatter: parsed.frontmatter,
            content_hash: hash,
            git_sha: file.sha,
            updated_at: new Date().toISOString(),
          },
          { onConflict: "user_id,path" },
        )
        .select("id")
        .single();

      if (upsertError || !note) {
        result.errors.push(`${file.path}: ${upsertError?.message ?? "upsert failed"}`);
        continue;
      }

      const noteId = note.id as string;

      // Replace chunks and links for this note.
      await supabaseAdmin().from("note_chunks").delete().eq("note_id", noteId);
      await supabaseAdmin().from("note_links").delete().eq("from_note", noteId);

      if (parsed.chunks.length > 0) {
        const { error: chunkError } = await supabaseAdmin().from("note_chunks").insert(
          parsed.chunks.map((chunk, index) => ({
            note_id: noteId,
            idx: chunk.idx,
            heading: chunk.heading,
            content: chunk.content,
            embedding: embeddings[index] ?? null,
          })),
        );
        if (chunkError) {
          result.errors.push(`${file.path}: ${chunkError.message}`);
        }
        result.chunks += parsed.chunks.length;
      }

      if (parsed.links.length > 0) {
        await supabaseAdmin().from("note_links").insert(
          parsed.links.map((target) => ({ from_note: noteId, to_path: target })),
        );
      }

      result.synced += 1;
    } catch (error) {
      result.errors.push(`${file.path}: ${error instanceof Error ? error.message : String(error)}`);
    }
  }

  // Notes that vanished from the repo.
  for (const [path, row] of existing) {
    if (seenPaths.has(path)) continue;
    await supabaseAdmin().from("notes").delete().eq("id", row.id).eq("user_id", userId);
    result.removed += 1;
  }

  return result;
}
