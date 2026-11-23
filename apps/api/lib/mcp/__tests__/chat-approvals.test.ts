import assert from "node:assert/strict";
import { describe, it } from "node:test";

import {
  generateText,
  isStepCount,
  jsonSchema,
  tool,
  type ModelMessage,
} from "ai";
import { MockLanguageModelV4 } from "ai/test";

import { buildMcpChatTools } from "@/lib/mcp/chat-tools";
import type {
  LoadedMcpTool,
  McpToolRuntime,
} from "@/lib/mcp/tools-loader";

const TOOL_NAME = "mcp_composio_COMPOSIO_MULTI_EXECUTE_TOOL";
const SECRET = "test-only-tool-approval-secret-with-enough-entropy";

function runtimeFor(entry: LoadedMcpTool): McpToolRuntime {
  const declaration = tool({
    description: entry.description,
    inputSchema: jsonSchema(entry.inputSchema),
  });

  return {
    tools: new Map([[entry.name, entry]]),
    declarations: { [entry.name]: declaration },
    approvalRequired: new Set(
      entry.approvalRequired ? [entry.name] : [],
    ),
    handles: (name) => name === entry.name,
    requiresApproval: (name) =>
      name === entry.name && entry.approvalRequired,
    execute: async () => ({ ok: true }),
  };
}

function loadedTool(overrides: Partial<LoadedMcpTool> = {}): LoadedMcpTool {
  return {
    name: TOOL_NAME,
    connectionId: "connection-1",
    serverId: "server-1",
    serverSlug: "composio",
    serverName: "Composio",
    provider: "composio",
    externalToolId: "COMPOSIO_MULTI_EXECUTE_TOOL",
    description: "Execute an approved Composio action.",
    inputSchema: {
      type: "object",
      properties: { query: { type: "string" } },
      required: ["query"],
    },
    riskLevel: "high",
    approvalRequired: true,
    ...overrides,
  };
}

function mockModel() {
  const usage = {
    inputTokens: {
      total: 10,
      noCache: 10,
      cacheRead: undefined,
      cacheWrite: undefined,
    },
    outputTokens: {
      total: 10,
      text: 10,
      reasoning: undefined,
    },
  };

  return new MockLanguageModelV4({
    doGenerate: [
      {
        content: [
          {
            type: "tool-call",
            toolCallId: "call-1",
            toolName: TOOL_NAME,
            input: JSON.stringify({ query: "inbox" }),
          },
        ],
        finishReason: { unified: "tool-calls", raw: undefined },
        usage,
        warnings: [],
      },
      {
        content: [{ type: "text", text: "The tool completed." }],
        finishReason: { unified: "stop", raw: undefined },
        usage,
        warnings: [],
      },
    ],
  });
}

describe("ordinary-chat MCP approvals", () => {
  it("keeps shared loader declarations non-executing and binds chat execution separately", async () => {
    const entry = loadedTool();
    const runtime = runtimeFor(entry);
    const chat = buildMcpChatTools(runtime);

    assert.ok(chat.tools[entry.name]);
    assert.equal(typeof chat.tools[entry.name].execute, "function");
    assert.equal(runtime.declarations[entry.name].execute, undefined);
    assert.deepEqual(chat.approval[entry.name], {
      type: "user-approval",
      reason: `MCP tool "${entry.externalToolId}" from ${entry.serverName} requires your approval before it can run.`,
    });

    const execute = chat.tools[entry.name].execute as
      | ((input: unknown, options: unknown) => Promise<unknown>)
      | undefined;
    await execute?.({ query: "inbox" }, { toolCallId: "call-1" });
  });

  it("does not execute an MCP tool until a signed approval is accepted", async () => {
    const calls: Array<Record<string, unknown>> = [];
    const entry = loadedTool();
    const runtime = runtimeFor(entry);
    runtime.execute = async (_name, args) => {
      calls.push(args);
      return { ok: true };
    };
    const chat = buildMcpChatTools(runtime);
    const model = mockModel();

    const first = await generateText({
      model,
      tools: chat.tools,
      toolApproval: chat.approval,
      experimental_toolApprovalSecret: SECRET,
      prompt: "Search my Gmail inbox",
    });

    assert.equal(calls.length, 0);
    const request = first.content.find(
      (part) => part.type === "tool-approval-request",
    );
    assert.ok(request);
    assert.equal(request.type, "tool-approval-request");
    assert.ok(request.signature);

    const messages: ModelMessage[] = [
      { role: "user", content: "Search my Gmail inbox" },
      ...first.responseMessages,
      {
        role: "tool",
        content: [
          {
            type: "tool-approval-response",
            approvalId: request.approvalId,
            approved: true,
          },
        ],
      },
    ];

    await generateText({
      model,
      tools: chat.tools,
      toolApproval: chat.approval,
      experimental_toolApprovalSecret: SECRET,
      messages,
      stopWhen: isStepCount(2),
    });

    assert.deepEqual(calls, [{ query: "inbox" }]);
  });

  it("does not execute a denied MCP tool", async () => {
    const calls: Array<Record<string, unknown>> = [];
    const entry = loadedTool();
    const runtime = runtimeFor(entry);
    runtime.execute = async (_name, args) => {
      calls.push(args);
      return { ok: true };
    };
    const chat = buildMcpChatTools(runtime);
    const model = mockModel();

    const first = await generateText({
      model,
      tools: chat.tools,
      toolApproval: chat.approval,
      experimental_toolApprovalSecret: SECRET,
      prompt: "Search my Gmail inbox",
    });
    const request = first.content.find(
      (part) => part.type === "tool-approval-request",
    );
    assert.ok(request);

    const messages: ModelMessage[] = [
      { role: "user", content: "Search my Gmail inbox" },
      ...first.responseMessages,
      {
        role: "tool",
        content: [
          {
            type: "tool-approval-response",
            approvalId: request.approvalId,
            approved: false,
          },
        ],
      },
    ];

    await generateText({
      model,
      tools: chat.tools,
      toolApproval: chat.approval,
      experimental_toolApprovalSecret: SECRET,
      messages,
      stopWhen: isStepCount(2),
    });

    assert.equal(calls.length, 0);
  });

  it("rejects changed tool input without executing the tool", async () => {
    const calls: Array<Record<string, unknown>> = [];
    const entry = loadedTool();
    const runtime = runtimeFor(entry);
    runtime.execute = async (_name, args) => {
      calls.push(args);
      return { ok: true };
    };
    const chat = buildMcpChatTools(runtime);
    const model = mockModel();

    const first = await generateText({
      model,
      tools: chat.tools,
      toolApproval: chat.approval,
      experimental_toolApprovalSecret: SECRET,
      prompt: "Search my Gmail inbox",
    });
    const request = first.content.find(
      (part) => part.type === "tool-approval-request",
    );
    assert.ok(request);

    const responseMessages = structuredClone(first.responseMessages);
    const assistant = responseMessages.find(
      (message) => message.role === "assistant",
    );
    assert.ok(assistant && assistant.role === "assistant");
    if (typeof assistant.content === "string") {
      assert.fail("approval response history must retain structured content");
    }
    const toolCall = assistant.content.find(
      (part) => part.type === "tool-call",
    );
    assert.ok(toolCall);
    toolCall.input = { query: "different inbox" };

    const messages: ModelMessage[] = [
      { role: "user", content: "Search my Gmail inbox" },
      ...responseMessages,
      {
        role: "tool",
        content: [
          {
            type: "tool-approval-response",
            approvalId: request.approvalId,
            approved: true,
          },
        ],
      },
    ];

    await assert.rejects(() =>
      generateText({
        model,
        tools: chat.tools,
        toolApproval: chat.approval,
        experimental_toolApprovalSecret: SECRET,
        messages,
      }),
    );
    assert.equal(calls.length, 0);
  });

  it("rejects a tampered approval signature without executing the tool", async () => {
    const calls: Array<Record<string, unknown>> = [];
    const entry = loadedTool();
    const runtime = runtimeFor(entry);
    runtime.execute = async (_name, args) => {
      calls.push(args);
      return { ok: true };
    };
    const chat = buildMcpChatTools(runtime);
    const model = mockModel();

    const first = await generateText({
      model,
      tools: chat.tools,
      toolApproval: chat.approval,
      experimental_toolApprovalSecret: SECRET,
      prompt: "Search my Gmail inbox",
    });
    const request = first.content.find(
      (part) => part.type === "tool-approval-request",
    );
    assert.ok(request);

    const responseMessages = structuredClone(first.responseMessages);
    const assistant = responseMessages.find(
      (message) => message.role === "assistant",
    );
    assert.ok(assistant && assistant.role === "assistant");
    if (typeof assistant.content === "string") {
      assert.fail("approval response history must retain structured content");
    }
    const approvalPart = assistant.content.find(
      (part) => part.type === "tool-approval-request",
    );
    assert.ok(approvalPart);
    assert.ok(approvalPart.signature);
    approvalPart.signature =
      approvalPart.signature.endsWith("x")
        ? `${approvalPart.signature.slice(0, -1)}y`
        : `${approvalPart.signature.slice(0, -1)}x`;

    const messages: ModelMessage[] = [
      { role: "user", content: "Search my Gmail inbox" },
      ...responseMessages,
      {
        role: "tool",
        content: [
          {
            type: "tool-approval-response",
            approvalId: request.approvalId,
            approved: true,
          },
        ],
      },
    ];

    await assert.rejects(() =>
      generateText({
        model,
        tools: chat.tools,
        toolApproval: chat.approval,
        experimental_toolApprovalSecret: SECRET,
        messages,
      }),
    );
    assert.equal(calls.length, 0);
  });
});
