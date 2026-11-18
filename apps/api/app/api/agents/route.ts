import { AgentCreateSchema } from "@agent/shared";

import { requireUser, toErrorResponse } from "@/lib/auth";
import {
  AGENT_COLUMNS,
  assertKnownModels,
  listAgentsWithCounts,
  storedAvatar,
  toPublicAgent,
  type AgentRow,
} from "@/lib/agents";
import { defaultAgentId } from "@/lib/mcp/tools-loader";
import { supabaseAdmin } from "@/lib/supabase/server";
import { zodMessage } from "@/lib/zod-error";

/**
 * GET  /api/agents — the caller's agents (creates the default "Personal"
 *      agent on first call so the MCP attach picker always has a target).
 *      Responses include the full `avatar` object and the enabled MCP tool
 *      count per agent.
 * POST /api/agents — create an agent; body validated by `AgentCreateSchema`
 *      (name required; role, instructions, model, fallbackModels, avatar,
 *      isSupervisor optional).
 */

export async function GET(request: Request) {
  try {
    const user = await requireUser(request);

    // Ensure a default agent exists (also the fallback target for runs that
    // don't specify one — see loadMcpToolsForRun).
    await defaultAgentId(user.id);

    const agents = await listAgentsWithCounts(user.id);
    return Response.json({ agents });
  } catch (error) {
    return toErrorResponse(error);
  }
}

export async function POST(request: Request) {
  try {
    const user = await requireUser(request);
    const raw = (await request.json().catch(() => ({}))) as Record<string, unknown>;

    // An empty string means "no value" for the nullable fields.
    const normalized = { ...raw };
    for (const key of ["role", "instructions", "model"] as const) {
      if (normalized[key] === "") normalized[key] = null;
    }

    const parsed = AgentCreateSchema.safeParse(normalized);
    if (!parsed.success) {
      return Response.json(
        { error: { code: "bad_request", message: zodMessage(parsed.error) } },
        { status: 400 },
      );
    }
    assertKnownModels(parsed.data.model, parsed.data.fallbackModels);

    const input = parsed.data;
    const { data, error } = await supabaseAdmin()
      .from("agents")
      .insert({
        user_id: user.id,
        name: input.name,
        role: input.role ?? null,
        system_prompt: input.instructions ?? null,
        model: input.model ?? null,
        fallback_models: input.fallbackModels ?? [],
        ...(input.avatar ? { avatar: storedAvatar(input.avatar) } : {}),
        ...(input.isSupervisor !== undefined ? { is_supervisor: input.isSupervisor } : {}),
      })
      .select(AGENT_COLUMNS)
      .single();
    if (error) throw new Error(`Could not create agent: ${error.message}`);

    return Response.json(
      { agent: await toPublicAgent(data as AgentRow) },
      { status: 201 },
    );
  } catch (error) {
    return toErrorResponse(error);
  }
}
