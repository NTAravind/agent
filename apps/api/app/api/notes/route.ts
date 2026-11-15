import { requireUser, toErrorResponse } from "@/lib/auth";
import { listNotes, searchNotes } from "@/lib/knowledge/search";

/**
 * GET /api/notes?q=&k= — list the notes, or search them (hybrid).
 */
export async function GET(request: Request) {
  try {
    const user = await requireUser(request);
    const url = new URL(request.url);
    const query = url.searchParams.get("q")?.trim() ?? "";
    const k = Number(url.searchParams.get("k") ?? 8);

    if (query) {
      const matches = await searchNotes({ userId: user.id, query, k });
      return Response.json({ query, matches });
    }

    const notes = await listNotes(user.id);
    return Response.json({ notes });
  } catch (error) {
    return toErrorResponse(error);
  }
}
