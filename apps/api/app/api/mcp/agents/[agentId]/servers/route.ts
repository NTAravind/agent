import { requireUser, toErrorResponse } from "@/lib/auth";
import { supabaseAdmin } from "@/lib/supabase/server";
import { getConnection, toPublicConnection, type ConnectionRow } from "@/lib/mcp/connections";
import { defaultAgentId } from "@/lib/mcp/tools-loader";

/**
 * GET  /api/mcp/agents/:agentId/servers — attachments (+ tools + permission state).
 * POST /api/mcp/agents/:agentId/servers — attach a connection.
 *      Body: { connectionId }
 *
 * Attaching seeds per-tool permission rows with catalog defaults so the UI
 * can show/toggle them immediately.
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

    const agentExists = await assertAgentOwned(user.id, agentId);
    if (!agentExists) {
      return Response.json(
        { error: { code: "not_found", message: "Unknown agent." } },
        { status: 404 },
      );
    }

    const admin = supabaseAdmin();
    const { data: attachments, error } = await admin
      .from("agent_mcp_servers")
      .select("id, user_mcp_connection_id, enabled, created_at")
      .eq("agent_id", agentId)
      .order("created_at");
    if (error) throw new Error(`Could not list attachments: ${error.message}`);

    const connectionIds = (attachments ?? []).map(
      (row) => row.user_mcp_connection_id as string,
    );
    if (connectionIds.length === 0) {
      return Response.json({ agentId, attachments: [] });
    }

    const { data: connectionRows } = await admin
      .from("user_mcp_connections")
      .select(
        "id, user_id, mcp_server_id, status, auth_type, metadata, last_checked_at, created_at",
      )
      .eq("user_id", user.id)
      .in("id", connectionIds);

    const connectionById = new Map(
      ((connectionRows ?? []) as unknown as Array<Pick<ConnectionRow, "id" | "mcp_server_id"> & {
        status: string;
        auth_type: string;
        metadata: Record<string, unknown>;
        last_checked_at: string | null;
        created_at: string;
      }>).map((row) => [row.id, row]),
    );

    const serverIds = [...connectionById.values()].map((row) => row.mcp_server_id);
    const { data: serverRows } = await admin
      .from("mcp_servers")
      .select("id, slug, name, provider, category, icon_url, enabled")
      .in("id", serverIds);

    const { data: toolRows } = await admin
      .from("mcp_tools")
      .select("id, mcp_server_id, external_tool_id, name, description, risk_level, approval_required_default, enabled")
      .in("mcp_server_id", serverIds)
      .eq("enabled", true)
      .order("name");

    const { data: permissionRows } = await admin
      .from("agent_mcp_tool_permissions")
      .select("mcp_tool_id, enabled, approval_required, risk_level")
      .eq("agent_id", agentId)
      .in(
        "mcp_tool_id",
        (toolRows ?? []).map((row) => row.id as string),
      );

    const permissionByTool = new Map(
      (permissionRows ?? []).map((row) => [row.mcp_tool_id as string, row]),
    );

    const result = (attachments ?? []).map((attachment) => {
      const connection = connectionById.get(attachment.user_mcp_connection_id as string);
      const server = (serverRows ?? []).find((row) => row.id === connection?.mcp_server_id);
      const tools = (toolRows ?? [])
        .filter((tool) => tool.mcp_server_id === connection?.mcp_server_id)
        .map((tool) => {
          const permission = permissionByTool.get(tool.id as string);
          const riskLevel =
            (permission?.risk_level as string | undefined) ?? (tool.risk_level as string);
          const approvalRequired =
            riskLevel === "high"
              ? true
              : ((permission?.approval_required as boolean | undefined) ??
                Boolean(tool.approval_required_default));
          return {
            id: tool.id as string,
            name: tool.name as string,
            externalToolId: tool.external_tool_id as string,
            description: tool.description as string,
            riskLevel,
            approvalRequired,
            enabled: permission ? Boolean(permission.enabled) : true,
            hasPermissionRow: Boolean(permission),
          };
        });

      return {
        attachmentId: attachment.id as string,
        enabled: Boolean(attachment.enabled),
        connection: connection
          ? {
              id: connection.id,
              status: connection.status,
              authType: connection.auth_type,
              lastCheckedAt: connection.last_checked_at,
            }
          : null,
        server: server
          ? {
              id: server.id as string,
              slug: server.slug as string,
              name: server.name as string,
              provider: server.provider as string,
              category: server.category as string,
              iconUrl: (server.icon_url as string | null) ?? null,
              enabled: Boolean(server.enabled),
            }
          : null,
        tools,
      };
    });

    return Response.json({ agentId, attachments: result });
  } catch (error) {
    return toErrorResponse(error);
  }
}

export async function POST(request: Request, ctx: { params: Promise<{ agentId: string }> }) {
  try {
    const user = await requireUser(request);
    const { agentId } = await ctx.params;
    const body = (await request.json().catch(() => ({}))) as { connectionId?: string };

    if (!body.connectionId) {
      return Response.json(
        { error: { code: "bad_request", message: "connectionId is required." } },
        { status: 400 },
      );
    }

    const agentExists = await assertAgentOwned(user.id, agentId);
    if (!agentExists) {
      return Response.json(
        { error: { code: "not_found", message: "Unknown agent." } },
        { status: 404 },
      );
    }

    const connection = await getConnection(user.id, body.connectionId);
    if (!connection || connection.status !== "connected") {
      return Response.json(
        { error: { code: "bad_request", message: "Connect this integration first." } },
        { status: 400 },
      );
    }

    const admin = supabaseAdmin();

    // Attach (idempotent).
    const { data: attachment, error: attachError } = await admin
      .from("agent_mcp_servers")
      .upsert(
        { agent_id: agentId, user_mcp_connection_id: connection.id, enabled: true },
        { onConflict: "agent_id,user_mcp_connection_id" },
      )
      .select("id")
      .single();
    if (attachError) {
      throw new Error(`Could not attach integration: ${attachError.message}`);
    }

    // Seed per-tool permission rows with catalog defaults (high risk → approval on).
    const { data: tools } = await admin
      .from("mcp_tools")
      .select("id, risk_level, approval_required_default")
      .eq("mcp_server_id", connection.mcp_server_id)
      .eq("enabled", true);

    for (const tool of tools ?? []) {
      const riskLevel = (tool.risk_level as string) ?? "medium";
      await admin.from("agent_mcp_tool_permissions").upsert(
        {
          agent_id: agentId,
          mcp_tool_id: tool.id as string,
          enabled: true,
          approval_required:
            riskLevel === "high" ? true : Boolean(tool.approval_required_default),
          risk_level: riskLevel,
        },
        { onConflict: "agent_id,mcp_tool_id" },
      );
    }

    return Response.json({ attached: true, attachmentId: attachment.id }, { status: 201 });
  } catch (error) {
    return toErrorResponse(error);
  }
}
