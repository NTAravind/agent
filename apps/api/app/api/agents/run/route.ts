import { requireUser, toErrorResponse } from "@/lib/auth";
import { runAgent } from "@/lib/agent/graph";
import { createRun } from "@/lib/agent/runs";
import { inngest } from "@/lib/inngest/client";
import { agentRunRequested } from "@/lib/inngest/events";

/**
 * POST /api/agents/run — start an agent run.
 *
 * The run is queued and executed by Inngest (durable, survives closing the
 * app). Body: { goal: string, threadId?: string, inline?: boolean }.
 * `inline` runs the graph in this request — handy for local testing.
 */
export async function POST(request: Request) {
  try {
    const user = await requireUser(request);
    const body = (await request.json().catch(() => ({}))) as {
      goal?: string;
      threadId?: string;
      inline?: boolean;
    };

    const goal = body.goal?.trim();
    if (!goal || goal.length < 3) {
      return Response.json(
        { error: { code: "bad_request", message: "A goal of at least 3 characters is required." } },
        { status: 400 },
      );
    }

    const run = await createRun({ userId: user.id, goal, threadId: body.threadId ?? null });

    if (body.inline) {
      const result = await runAgent({ runId: run.id, userId: user.id, goal });
      return Response.json({ runId: run.id, status: result.status });
    }

    await inngest.send(
      agentRunRequested.create({ runId: run.id, userId: user.id, goal, threadId: body.threadId }),
    );

    return Response.json({ runId: run.id, status: "queued" }, { status: 202 });
  } catch (error) {
    return toErrorResponse(error);
  }
}
