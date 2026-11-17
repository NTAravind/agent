import { requireUser, toErrorResponse } from "@/lib/auth";
import { supabaseAdmin } from "@/lib/supabase/server";

/**
 * PUT    /api/mcp/agents/:agentId/servers/:connectionId — toggle attachment.
 *        Body: { enabled: boolean }
 * DELETE /api/mcp/agents/:agentId/servers/:connectionId — detach (keeps
 *        permission rows so re-attaching restores the user's choices).
 */

async function findAttachment(userId: string, agentId: string, connectionId: string) {
  const admin = supabaseAdmin();
  const { data: agent } = await admin
    .from("agents")
    .select("id")
    .eq("id", agentId)
    .eq("user_id", userId)
    .maybeSingle();
  if (!agent) return null;

  const { data } = await admin
    .from("agent_mcp_servers")
    .select("id")
    .eq("agent_id", agentId)
    .eq("user_mcp_connection_id", connectionId)
    .maybeSingle();
  return (data as { id: string } | null) ?? null;
}

export async function PUT(
  request: Request,
  ctx: { params: Promise<{ agentId: string; connectionId: string }> },
) {
  try {
    const user = await requireUser(request);
    const { agentId, connectionId } = await ctx.params;
    const body = (await request.json().catch(() => ({}))) as { enabled?: boolean };

    if (typeof body.enabled !== "boolean") {
      return Response.json(
        { error: { code: "bad_request", message: "enabled must be a boolean." } },
        { status: 400 },
      );
    }

    const attachment = await findAttachment(user.id, agentId, connectionId);
    if (!attachment) {
      return Response.json(
        { error: { code: "not_found", message: "Attachment not found." } },
        { status: 404 },
      );
    }

    const { error } = await supabaseAdmin()
      .from("agent_mcp_servers")
      .update({ enabled: body.enabled, updated_at: new Date().toISOString() })
      .eq("id", attachment.id);
    if (error) throw new Error(`Could not update attachment: ${error.message}`);

    return Response.json({ enabled: body.enabled });
  } catch (error) {
    return toErrorResponse(error);
  }
}

export async function DELETE(
  _request: Request,
  ctx: { params: Promise<{ agentId: string; connectionId: string }> },
) {
  try {
    const user = await requireUser(_request);
    const { agentId, connectionId } = await ctx.params;

    const attachment = await findAttachment(user.id, agentId, connectionId);
    if (!attachment) {
      return Response.json(
        { error: { code: "not_found", message: "Attachment not found." } },
        { status: 404 },
      );
    }

    const { error } = await supabaseAdmin()
      .from("agent_mcp_servers")
      .delete()
      .eq("id", attachment.id);
    if (error) throw new Error(`Could not detach integration: ${error.message}`);

    return Response.json({ detached: true });
  } catch (error) {
    return toErrorResponse(error);
  }
}
