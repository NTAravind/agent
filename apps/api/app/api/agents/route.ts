import { requireUser, toErrorResponse } from "@/lib/auth";
import { supabaseAdmin } from "@/lib/supabase/server";
import { defaultAgentId } from "@/lib/mcp/tools-loader";

/**
 * GET  /api/agents — the caller's agents (creates the default "Personal"
 *      agent on first call so the MCP attach picker always has a target).
 * POST /api/agents — create an agent. Body: { name }
 *
 * Minimal by design (Phase 6): the marketplace needs a picker + a run target.
 * Full agent management (models, prompts) is a later phase.
 */

export async function GET(request: Request) {
  try {
    const user = await requireUser(request);

    // Ensure a default agent exists (also the fallback target for runs that
    // don't specify one — see loadMcpToolsForRun).
    await defaultAgentId(user.id);

    const { data, error } = await supabaseAdmin()
      .from("agents")
      .select("id, name, model, avatar_emoji, created_at")
      .eq("user_id", user.id)
      .order("created_at", { ascending: true });
    if (error) throw new Error(`Could not list agents: ${error.message}`);

    return Response.json({
      agents: (data ?? []).map((row) => ({
        id: row.id as string,
        name: row.name as string,
        model: (row.model as string | null) ?? null,
        avatarEmoji: (row.avatar_emoji as string | null) ?? null,
        createdAt: row.created_at as string,
      })),
    });
  } catch (error) {
    return toErrorResponse(error);
  }
}

export async function POST(request: Request) {
  try {
    const user = await requireUser(request);
    const body = (await request.json().catch(() => ({}))) as { name?: string };
    const name = body.name?.trim();
    if (!name || name.length > 60) {
      return Response.json(
        { error: { code: "bad_request", message: "name (1-60 chars) is required." } },
        { status: 400 },
      );
    }

    const { data, error } = await supabaseAdmin()
      .from("agents")
      .insert({ user_id: user.id, name })
      .select("id, name, model, avatar_emoji, created_at")
      .single();
    if (error) throw new Error(`Could not create agent: ${error.message}`);

    return Response.json(
      {
        agent: {
          id: data.id as string,
          name: data.name as string,
          model: (data.model as string | null) ?? null,
          avatarEmoji: (data.avatar_emoji as string | null) ?? null,
          createdAt: data.created_at as string,
        },
      },
      { status: 201 },
    );
  } catch (error) {
    return toErrorResponse(error);
  }
}
