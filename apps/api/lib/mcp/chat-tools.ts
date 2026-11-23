import { jsonSchema, tool, type Tool } from "ai";

import type { McpToolRuntime } from "@/lib/mcp/tools-loader";

/**
 * Ordinary-chat bindings for one agent's MCP runtime.
 *
 * The durable graph deliberately keeps MCP declarations non-executing because
 * it applies its own run-backed approval gate before calling the runtime.
 * Short chats use the same loaded runtime and policy, but need an executable
 * declaration for the AI SDK. Binding it here keeps the shared loader free of
 * an `execute` function that could accidentally bypass the graph's gate.
 */
export type McpChatTools = {
  /** Executable declarations exposed to the ordinary chat model. */
  tools: Record<string, Tool>;
  /** Per-tool manual approval policy for `streamText.toolApproval`. */
  approval: Record<
    string,
    { type: "user-approval"; reason: string }
  >;
};

/** Builds ordinary-chat MCP tools from an already agent-scoped runtime. */
export function buildMcpChatTools(runtime: McpToolRuntime): McpChatTools {
  const tools: Record<string, Tool> = {};
  const approval: McpChatTools["approval"] = {};

  for (const entry of runtime.tools.values()) {
    tools[entry.name] = tool({
      description: `[MCP:${entry.serverName}] ${entry.description}`.slice(0, 1_000),
      inputSchema: jsonSchema(entry.inputSchema),
      execute: async (input) =>
        await runtime.execute(
          entry.name,
          (input ?? {}) as Record<string, unknown>,
        ),
    }) as Tool;

    if (runtime.requiresApproval(entry.name)) {
      approval[entry.name] = {
        type: "user-approval",
        reason: `MCP tool "${entry.externalToolId}" from ${entry.serverName} requires your approval before it can run.`,
      };
    }
  }

  return { tools, approval };
}
