import { requireUser, toErrorResponse } from "@/lib/auth";
import { getNote } from "@/lib/knowledge/search";
import { putVaultFile, deleteVaultFile, isVaultConfigured } from "@/lib/vault/github";
import { supabaseAdmin } from "@/lib/supabase/server";
import { zodMessage } from "@/lib/zod-error";

/**
 * GET  /api/notes/:path — a note with its outgoing links and backlinks.
 * PUT  /api/notes/:path — user-initiated create/update (commits to GitHub, no approval).
 * DELETE /api/notes/:path — user-initiated delete.
 * The path is the vault path, URL-encoded (e.g. "Projects%2FIdea.md").
 */
async function getDecodedPath(context: { params: Promise<{ path: string[] }> }): Promise<string> {
  const { path } = await context.params;
  return decodeURIComponent((path ?? []).join("/"));
}

export async function GET(request: Request, context: { params: Promise<{ path: string[] }> }) {
  try {
    const user = await requireUser(request);
    const notePath = await getDecodedPath(context);

    if (!notePath) {
      return Response.json(
        { error: { code: "bad_request", message: "A note path is required." } },
        { status: 400 },
      );
    }

    const note = await getNote(user.id, notePath);
    if (!note) {
      return Response.json(
        { error: { code: "not_found", message: `No note at ${notePath}.` } },
        { status: 404 },
      );
    }

    return Response.json(note);
  } catch (error) {
    return toErrorResponse(error);
  }
}

export async function PUT(request: Request, context: { params: Promise<{ path: string[] }> }) {
  try {
    const user = await requireUser(request);
    const decodedPath = await getDecodedPath(context);

    if (!decodedPath.endsWith(".md")) {
      return Response.json(
        { error: { code: "bad_request", message: "Only .md files are supported." } },
        { status: 400 },
      );
    }

    const body = await request.text();
    if (!body.trim()) {
      return Response.json(
        { error: { code: "bad_request", message: "Content cannot be empty." } },
        { status: 400 },
      );
    }

    let gitSha: string | null = null;
    let vaultCommitted = false;

    if (isVaultConfigured()) {
      const written = await putVaultFile(decodedPath, body);
      gitSha = written.sha;
      vaultCommitted = true;
    }

    // Upsert the notes index (no chunking/embedding for now — sync will handle that)
    const { data: existing } = await supabaseAdmin()
      .from("notes")
      .select("id, content_hash")
      .eq("user_id", user.id)
      .eq("path", decodedPath)
      .maybeSingle();

    const contentHash = await crypto.subtle
      .digest("SHA-256", new TextEncoder().encode(body))
      .then((buf) => Array.from(new Uint8Array(buf)).map((b) => b.toString(16).padStart(2, "0")).join(""));

    if (existing) {
      if (existing.content_hash === contentHash && gitSha === null) {
        return Response.json({ note: existing, vaultCommitted: false, unchanged: true });
      }
      const { data, error } = await supabaseAdmin()
        .from("notes")
        .update({
          content_hash: contentHash,
          git_sha: gitSha ?? "",
          updated_at: new Date().toISOString(),
        })
        .eq("id", existing.id)
        .eq("user_id", user.id)
        .select("*")
        .single();
      if (error) throw new Error(`Could not update note index: ${error.message}`);
      return Response.json({ note: data, vaultCommitted });
    } else {
      const { data, error } = await supabaseAdmin()
        .from("notes")
        .insert({
          user_id: user.id,
          path: decodedPath,
          title: decodedPath.split("/").pop()?.replace(/\.md$/, "") ?? "Untitled",
          content_hash: contentHash,
          git_sha: gitSha ?? "",
        })
        .select("*")
        .single();
      if (error) throw new Error(`Could not create note index: ${error.message}`);
      return Response.json({ note: data, vaultCommitted }, { status: 201 });
    }
  } catch (error) {
    return toErrorResponse(error);
  }
}

export async function DELETE(request: Request, context: { params: Promise<{ path: string[] }> }) {
  try {
    const user = await requireUser(request);
    const decodedPath = await getDecodedPath(context);

    if (isVaultConfigured()) {
      await deleteVaultFile(decodedPath);
    }

    const { error } = await supabaseAdmin()
      .from("notes")
      .delete()
      .eq("user_id", user.id)
      .eq("path", decodedPath);

    if (error) throw new Error(`Could not delete note: ${error.message}`);
    return Response.json({ deleted: true });
  } catch (error) {
    return toErrorResponse(error);
  }
}
