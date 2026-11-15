import { requireUser, toErrorResponse } from "@/lib/auth";
import { listRuns } from "@/lib/agent/runs";

/** GET /api/runs — the user's recent agent runs, newest first. */
export async function GET(request: Request) {
  try {
    const user = await requireUser(request);
    const runs = await listRuns(user.id);
    return Response.json({ runs });
  } catch (error) {
    return toErrorResponse(error);
  }
}
