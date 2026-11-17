import { requireUser, toErrorResponse } from "@/lib/auth";
import { supabaseAdmin } from "@/lib/supabase/server";

/**
 * GET /api/mcp/agents/:agentId/tools — all attachable tool permissions.
 * PUT /api/mcp/agents/:agentId/tools — batch-update permission rows.
 *     Body: { permissions: [{ mcpToolId, enabled, approvalRequired }] }
 *
 * `risk_level = high` can NEVER have approval disabled (API-enforced; the
 * loader re-checks). Updating a tool the agent hasn't attached is rejected.
 */

async function assertAgentOwned(userId: string, agentId: string): Promise<boolean> {
  const { data } = await supabaseAdmin()
    .from("agents")
    .select("id")
    .eq("id", agentId)
    .eq("user_id", userId)
    .maybeSingle();
  return Boolean(data);
}

export async function GET(request: Request, ctx: { params: Promise<{ agentId: string }> }) {
  try {
    const user = await requireUser(request);
    const { agentId } = await ctx.params;
    if (!(await assertAgentOwned(user.id, agentId))) {
      return Response.json(
        { error: { code: "not_found", message: "Unknown agent." } },
        { status: 404 },
      );
    }

    const admin = supabaseAdmin();

    // Tools reachable through this agent's *connected* attachments.
    const { data: attachments } = await admin
      .from("agent_mcp_servers")
      .select("user_mcp_connection_id, enabled")
      .eq("agent_id", agentId)
      .eq("enabled", true);
    if (!attachments?.length) return Response.json({ agentId, permissions: [] });

    const { data: connections } = await admin
      .from("user_mcp_connections")
      .select("id, mcp_server_id, status")
      .eq("user_id", user.id)
      .in(
        "id",
        attachments.map((row) => row.user_mcp_connection_id as string),
      )
      .eq("status", "connected");
    if (!connections?.length) return Response.json({ agentId, permissions: [] });

    const serverIds = connections.map((row) => row.mcp_server_id as string);
    const { data: servers } = await admin
      .from("mcp_servers")
      .select("id, slug, name")
      .in("id", serverIds);

    const { data: tools } = await admin
      .from("mcp_tools")
      .select(
        "id, mcp_server_id, external_tool_id, name, description, risk_level, approval_required_default, enabled",
      )
      .in("mcp_server_id", serverIds)
      .eq("enabled", true)
      .order("name");
    if (!tools?.length) return Response.json({ agentId, permissions: [] });

    const { data: permissions } = await admin
      .from("agent_mcp_tool_permissions")
      .select("mcp_tool_id, enabled, approval_required, risk_level")
      .eq("agent_id", agentId)
      .in(
        "mcp_tool_id",
        tools.map((row) => row.id as string),
      );
    const byTool = new Map((permissions ?? []).map((row) => [row.mcp_tool_id as string, row]));

    const serverById = new Map((servers ?? []).map((row) => [row.id as string, row]));

    const result = tools.map((tool) => {
      const permission = byTool.get(tool.id as string);
      const riskLevel =
        (permission?.risk_level as string | undefined) ?? (tool.risk_level as string);
      return {
        mcpToolId: tool.id as string,
        serverId: tool.mcp_server_id as string,
        serverName:
          (serverById.get(tool.mcp_server_id as string)?.name as string | undefined) ?? "Unknown",
        name: tool.name as string,
        externalToolId: tool.external_tool_id as string,
        description: tool.description as string,
        riskLevel,
        enabled: permission ? Boolean(permission.enabled) : true,
        approvalRequired:
          riskLevel === "high"
            ? true
            : (permission
                ? Boolean(permission.approval_required)
                : Boolean(tool.approval_required_default)),
        hasPermissionRow: Boolean(permission),
      };
    });

    return Response.json({ agentId, permissions: result });
  } catch (error) {
    return toErrorResponse(error);
  }
}

type PermissionUpdate = {
  mcpToolId: string;
  enabled: boolean;
  approvalRequired: boolean;
};

export async function PUT(request: Request, ctx: { params: Promise<{ agentId: string }> }) {
  try {
    const user = await requireUser(request);
    const { agentId } = await ctx.params;
    const body = (await request.json().catch(() => ({}))) as { permissions?: PermissionUpdate[] };

    if (!Array.isArray(body.permissions) || body.permissions.length === 0) {
      return Response.json(
        { error: { code: "bad_request", message: "permissions must be a non-empty array." } },
        { status: 400 },
      );
    }
    if (body.permissions.length > 200) {
      return Response.json(
        { error: { code: "bad_request", message: "Too many permissions in one update." } },
        { status: 400 },
      );
    }

    if (!(await assertAgentOwned(user.id, agentId))) {
      return Response.json(
        { error: { code: "not_found", message: "Unknown agent." } },
        { status: 404 },
      );
    }

    const admin = supabaseAdmin();
    const updated: PermissionUpdate[] = [];

    for (const permission of body.permissions) {
      if (
        !permission ||
        typeof permission.mcpToolId !== "string" ||
        typeof permission.enabled !== "boolean" ||
        typeof permission.approvalRequired !== "boolean"
      ) {
        return Response.json(
          {
            error: {
              code: "bad_request",
              message: "Each permission needs mcpToolId, enabled and approvalRequired.",
            },
          },
          { status: 400 },
        );
      }

      // The tool must be one this agent can actually reach (connected attach).
      const { data: tool } = await admin
        .from("mcp_tools")
        .select("id, risk_level, mcp_server_id, enabled")
        .eq("id", permission.mcpToolId)
        .maybeSingle();
      if (!tool || !tool.enabled) {
        return Response.json(
          { error: { code: "not_found", message: "Unknown tool." } },
          { status: 404 },
        );
      }

      const { data: connection } = await admin
        .from("user_mcp_connections")
        .select("id")
        .eq("user_id", user.id)
        .eq("mcp_server_id", tool.mcp_server_id as string)
        .eq("status", "connected")
        .maybeSingle();

      const { data: attached } = connection
        ? await admin
            .from("agent_mcp_servers")
            .select("id")
            .eq("agent_id", agentId)
            .eq("enabled", true)
            .eq("user_mcp_connection_id", connection.id as string)
            .maybeSingle()
        : { data: null };

      if (!attached) {
        return Response.json(
          { error: { code: "bad_request", message: "Tool is not attached to this agent." } },
          { status: 400 },
        );
      }

      // High risk can never disable approval.
      const riskLevel = (tool.risk_level as string) ?? "medium";
      const approvalRequired = riskLevel === "high" ? true : permission.approvalRequired;

      const { error } = await admin.from("agent_mcp_tool_permissions").upsert(
        {
          agent_id: agentId,
          mcp_tool_id: permission.mcpToolId,
          enabled: permission.enabled,
          approval_required: approvalRequired,
          risk_level: riskLevel,
        },
        { onConflict: "agent_id,mcp_tool_id" },
      );
      if (error) {
        throw new Error(`Could not save tool permission: ${error.message}`);
      }

      updated.push({
        mcpToolId: permission.mcpToolId,
        enabled: permission.enabled,
        approvalRequired,
      });
    }

    return Response.json({ updated });
  } catch (error) {
    return toErrorResponse(error);
  }
}
