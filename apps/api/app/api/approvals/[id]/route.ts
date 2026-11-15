import { requireUser, toErrorResponse } from "@/lib/auth";
import { decideApproval } from "@/lib/approvals";
import { inngest } from "@/lib/inngest/client";
import { approvalDecided } from "@/lib/inngest/events";
import { updateRun } from "@/lib/agent/runs";

/**
 * POST /api/approvals/:id — { decision: "approve" | "deny" }.
 *
 * Records the decision and emits `approval/decided`, which resumes the
 * parked run (approve → the tool executes; deny → the agent re-plans).
 */
export async function POST(request: Request, context: { params: Promise<{ id: string }> }) {
  try {
    const user = await requireUser(request);
    const { id } = await context.params;
    const body = (await request.json().catch(() => ({}))) as { decision?: string };

    if (body.decision !== "approve" && body.decision !== "deny") {
      return Response.json(
        { error: { code: "bad_request", message: 'decision must be "approve" or "deny".' } },
        { status: 400 },
      );
    }

    const { status, approval } = await decideApproval(user.id, id, body.decision);
    if (!approval) {
      return Response.json(
        { error: { code: "not_found", message: "No such approval." } },
        { status: 404 },
      );
    }

    // The run is awake again either way (deny → the graph re-plans).
    await updateRun(approval.run_id, { status: "running" });

    await inngest.send(
      approvalDecided.create({
        approvalId: approval.id,
        runId: approval.run_id,
        userId: user.id,
        decision: body.decision,
      }),
    );

    return Response.json({ ok: true, status });
  } catch (error) {
    return toErrorResponse(error);
  }
}
