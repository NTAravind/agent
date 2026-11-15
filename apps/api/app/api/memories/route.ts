import { requireUser, toErrorResponse } from "@/lib/auth";
import { listMemories } from "@/lib/knowledge/search";

/** GET /api/memories — the memories extracted from past conversations. */
export async function GET(request: Request) {
  try {
    const user = await requireUser(request);
    const memories = await listMemories(user.id);
    return Response.json({ memories });
  } catch (error) {
    return toErrorResponse(error);
  }
}
