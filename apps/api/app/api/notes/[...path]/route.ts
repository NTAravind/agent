import { requireUser, toErrorResponse } from "@/lib/auth";
import { getNote } from "@/lib/knowledge/search";

/**
 * GET /api/notes/:path — a note with its outgoing links and backlinks.
 * The path is the vault path, URL-encoded (e.g. "Projects%2FIdea.md").
 */
export async function GET(request: Request, context: { params: Promise<{ path: string[] }> }) {
  try {
    const user = await requireUser(request);
    const { path } = await context.params;
    const notePath = decodeURIComponent((path ?? []).join("/"));

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
