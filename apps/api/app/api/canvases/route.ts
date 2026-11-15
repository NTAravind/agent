import { requireUser, toErrorResponse } from "@/lib/auth";
import { listCanvases } from "@/lib/canvases";

/**
 * GET /api/canvases — the user's canvases, newest update first.
 */
export async function GET(request: Request) {
  try {
    const user = await requireUser(request);
    const canvases = await listCanvases(user.id);
    return Response.json({ canvases });
  } catch (error) {
    return toErrorResponse(error);
  }
}
