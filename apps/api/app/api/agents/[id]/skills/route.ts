import { AgentSkillsPutSchema } from "@agent/shared";

import { requireUser, toErrorResponse } from "@/lib/auth";
import { setAgentSkills } from "@/lib/skills/load";
import { zodMessage } from "@/lib/zod-error";

/**
 * PUT /api/agents/:id/skills — replaces the agent's whole skill assignment
 * set: { skillIds: [...] }. Every id is verified to belong to the caller;
 * the agent id comes from the URL (server context), never from the model.
 */
export async function PUT(request: Request, ctx: { params: Promise<{ id: string }> }) {
  try {
    const user = await requireUser(request);
    const { id } = await ctx.params;

    const parsed = AgentSkillsPutSchema.safeParse(await request.json().catch(() => null));
    if (!parsed.success) {
      return Response.json(
        { error: { code: "bad_request", message: zodMessage(parsed.error) } },
        { status: 400 },
      );
    }

    const stored = await setAgentSkills(user.id, id, parsed.data.skillIds);
    if (!stored) {
      return Response.json(
        { error: { code: "not_found", message: "Unknown agent." } },
        { status: 404 },
      );
    }

    return Response.json({ agentId: id, skillIds: stored });
  } catch (error) {
    return toErrorResponse(error);
  }
}
