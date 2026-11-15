import { requireUser, toErrorResponse } from "@/lib/auth";
import { listApprovals } from "@/lib/approvals";

/**
 * GET /api/approvals?status=pending — the user's approvals (default pending),
 * newest first, for the approvals UI.
 */
export async function GET(request: Request) {
  try {
    const user = await requireUser(request);
    const status = new URL(request.url).searchParams.get("status") ?? "pending";
    const approvals = await listApprovals(
      user.id,
      status === "pending" || status === "approved" || status === "denied" || status === "expired"
        ? status
        : "pending",
    );
    return Response.json({ approvals });
  } catch (error) {
    return toErrorResponse(error);
  }
}
