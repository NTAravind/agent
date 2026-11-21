import { requireUser, toErrorResponse } from "@/lib/auth";
import { loadRunForUser, runError } from "@/lib/agent/runs";
import { inngest } from "@/lib/inngest/client";
import { runResumed } from "@/lib/inngest/events";
import { supabaseAdmin } from "@/lib/supabase/server";

/**
 * POST /api/runs/:id/resume — queues `run/resumed` for a paused run. The
 * Inngest handler continues the graph from its LangGraph checkpoint (the node
 * that hit the pause boundary re-runs). A run of a sleeping agent is refused:
 * wake the agent to resume everything at once.
 */
export async function POST(request: Request, context: { params: Promise<{ id: string }> }) {
  try {
    const user = await requireUser(request);
    const { id } = await context.params;

    const run = await loadRunForUser(id, user.id);
    if (!run) throw runError("No such run.", 404, "not_found");
    if (run.status !== "paused") {
      throw runError("This task is not paused.", 409, "conflict");
    }
    if (run.agent_id) {
      const { data: agent } = await supabaseAdmin()
        .from("agents")
        .select("sleeping")
        .eq("id", run.agent_id)
        .eq("user_id", user.id)
        .maybeSingle();
      if ((agent as { sleeping?: boolean } | null)?.sleeping) {
        throw runError("This agent is asleep — wake it first.", 409, "conflict");
      }
    }

    await inngest.send(runResumed.create({ runId: id, userId: user.id }));
    return Response.json({ ok: true }, { status: 202 });
  } catch (error) {
    return toErrorResponse(error);
  }
}
