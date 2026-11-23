import { jsonSchema, tool, type Tool } from "ai";

import {
  supabaseApprovalGrantStore,
  type ApprovalGrantContext,
  type ApprovalGrantStore,
} from "@/lib/chat/approval-grant";
import type { McpToolRuntime } from "@/lib/mcp/tools-loader";

/**
 * Ordinary-chat bindings for one agent's MCP runtime.
 *
 * The durable graph deliberately keeps MCP declarations non-executing because
 * it applies its own run-backed approval gate before calling the runtime.
 * Short chats use the same loaded runtime and policy, but need an executable
 * declaration for the AI SDK. Binding it here keeps the shared loader free of
 * an `execute` function that could accidentally bypass the graph's gate.
 *
 * Approval-gated tools carry their own one-time grant:
 * - the approval policy records the grant before the signed request is issued,
 * - the execute callback consumes it before the MCP call runs.
 *
 * The AI SDK only reaches `execute` after it has verified the approval
 * signature and found an approved decision, so the grant is what stops the
 * same signed approval from being replayed, moved to another thread or
 * agent, or used after the underlying connection changed.
 */
export type McpChatTools = {
  /** Executable declarations exposed to the ordinary chat model. */
  tools: Record<string, Tool>;
  /** Per-tool manual approval policy for `streamText.toolApproval`. */
  approval: Record<
    string,
    (input: unknown, options: { toolCallId: string }) =>
      | { type: "user-approval"; reason: string }
      | Promise<{ type: "user-approval"; reason: string }>
  >;
  /** Names of the tools that require a human decision. */
  approvalRequired: string[];
};

/**
 * Builds ordinary-chat MCP tools from an already agent-scoped runtime.
 *
 * `scope` binds every approval to the conversation it was issued for.
 */
export function buildMcpChatTools(
  runtime: McpToolRuntime,
  scope: { userId: string; threadId: string; agentId: string | null },
  options: { grantStore?: ApprovalGrantStore } = {},
): McpChatTools {
  const grants = options.grantStore ?? supabaseApprovalGrantStore;
  const tools: Record<string, Tool> = {};
  const approval: McpChatTools["approval"] = {};
  const approvalRequired: string[] = [];

  for (const entry of runtime.tools.values()) {
    const context: ApprovalGrantContext = {
      userId: scope.userId,
      threadId: scope.threadId,
      agentId: scope.agentId,
      connectionId: entry.connectionId,
      toolName: entry.name,
    };

    const needsApproval = runtime.requiresApproval(entry.name);

    tools[entry.name] = tool({
      description: `[MCP:${entry.serverName}] ${entry.description}`.slice(0, 1_000),
      inputSchema: jsonSchema(entry.inputSchema),
      execute: async (input, options) => {
        if (needsApproval) {
          // One-time use, bound to this conversation. Throws when the approval
          // was never issued here, was already used, or does not match.
          await grants.consume({
            toolCallId: options.toolCallId,
            input,
            context,
          });
        }
        return await runtime.execute(
          entry.name,
          (input ?? {}) as Record<string, unknown>,
        );
      },
    }) as Tool;

    if (needsApproval) {
      approvalRequired.push(entry.name);
      const reason = `MCP tool "${entry.externalToolId}" from ${entry.serverName} requires your approval before it can run.`;
      approval[entry.name] = async (input, options) => {
        // The grant is written before the signed approval request reaches the
        // client, so the continuation always finds it.
        await grants.record({
          toolCallId: options.toolCallId,
          input,
          context,
        });
        return { type: "user-approval", reason };
      };
    }
  }

  return { tools, approval, approvalRequired };
}
