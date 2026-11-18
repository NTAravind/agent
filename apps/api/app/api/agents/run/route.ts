import { requireUser, toErrorResponse } from "@/lib/auth";
import { executeRun } from "@/lib/agent/execute";
import { createRun } from "@/lib/agent/runs";
import { inngest } from "@/lib/inngest/client";
import { agentRunRequested } from "@/lib/inngest/events";
import { defaultMobileModel, primeMobileModel } from "@/lib/models/catalog";
import { supabaseAdmin } from "@/lib/supabase/server";
import { defaultAgentId } from "@/lib/mcp/tools-loader";

/**
 * POST /api/agents/run — start an agent run.
 *
 * The run is queued and executed by Inngest (durable, survives closing the
 * app). Body: { goal, threadId?, inline?, model?, agentId? }.
 * `agentId` selects whose MCP attachments apply; when omitted the user's
 * default agent is used (created on demand), so runs always target an agent.
 * `inline` runs the graph in this request — handy for local testing.
 */
export async function POST(request: Request) {
  try {
    const user = await requireUser(request);
    const body = (await request.json().catch(() => ({}))) as {
      goal?: string;
      threadId?: string;
      inline?: boolean;
      model?: string;
      agentId?: string;
    };

    const goal = body.goal?.trim();
    if (!goal || goal.length < 3) {
      return Response.json(
        { error: { code: "bad_request", message: "A goal of at least 3 characters is required." } },
        { status: 400 },
      );
    }

    const preferredModel = body.model ?? await defaultMobileModel({ tools: true, structuredOutput: true });
    if (!preferredModel || !(await primeMobileModel(preferredModel))) {
      return Response.json({ error: { code: "bad_request", message: "Choose a model enabled in the provider dashboard." } }, { status: 400 });
    }

    // Resolve the target agent (must own it), else the default agent.
    let agentId: string | null = null;
    if (body.agentId) {
      const { data: agent } = await supabaseAdmin()
        .from("agents")
        .select("id")
        .eq("id", body.agentId)
        .eq("user_id", user.id)
        .maybeSingle();
      if (!agent) {
        return Response.json(
          { error: { code: "not_found", message: "Unknown agent." } },
          { status: 404 },
        );
      }
      agentId = agent.id as string;
    } else {
      // Default agent on demand — but never block a run if the agents table
      // isn't migrated yet (Phase 6 ships code before the migration runs).
      agentId = await defaultAgentId(user.id).catch(() => null);
    }

    const run = await createRun({
      userId: user.id,
      goal,
      threadId: body.threadId ?? null,
      agentId,
      model: preferredModel,
    });

    if (body.inline) {
      const result = await executeRun({ runId: run.id, userId: user.id, goal, preferredModel });
      return Response.json({ runId: run.id, status: result.status, agentId });
    }

    await inngest.send(
      agentRunRequested.create({
        runId: run.id,
        userId: user.id,
        ...(agentId ? { agentId } : {}),
        goal,
        threadId: body.threadId,
        preferredModel,
      }),
    );

    return Response.json({ runId: run.id, status: "queued", agentId }, { status: 202 });
  } catch (error) {
    return toErrorResponse(error);
  }
}
