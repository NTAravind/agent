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

import {
  approvalInputDigest,
  assertGrantUsable,
  type ApprovalGrantOperation,
  type ApprovalGrantState,
  type ApprovalGrantStore,
} from "@/lib/chat/approval-grant";
import { buildMcpChatTools } from "@/lib/mcp/chat-tools";
import type {
  LoadedMcpTool,
  McpToolRuntime,
} from "@/lib/mcp/tools-loader";

const TOOL_NAME = "mcp_composio_COMPOSIO_MULTI_EXECUTE_TOOL";
const SECRET = "test-only-tool-approval-secret-with-enough-entropy";
const USER_ID = "11111111-1111-4111-8111-111111111111";
const THREAD_ID = "22222222-2222-4222-8222-222222222222";
const AGENT_ID = "33333333-3333-4333-8333-333333333333";

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

/**
 * An in-memory grant store that enforces the production rules.
 *
 * The rules live in `assertGrantUsable`, so this store is the same policy the
 * Supabase-backed store applies — only the storage differs.
 */
function memoryGrantStore() {
  const rows = new Map<string, ApprovalGrantState & { toolCallId: string }>();

  const store: ApprovalGrantStore = {
    async record(input: ApprovalGrantOperation) {
      if (rows.has(input.toolCallId)) return;
      rows.set(input.toolCallId, {
        toolCallId: input.toolCallId,
        status: "pending",
        expiresAt: Date.now() + 24 * 60 * 60 * 1000,
        userId: input.context.userId,
        threadId: input.context.threadId,
        agentId: input.context.agentId,
        connectionId: input.context.connectionId,
        toolName: input.context.toolName,
        inputDigest: approvalInputDigest(input.input),
      });
    },

    async consume(input: ApprovalGrantOperation) {
      const row = rows.get(input.toolCallId);
      if (!row) {
        throw new Error("This approval was not issued by the server.");
      }
      assertGrantUsable(row, input);
      row.status = "consumed";
    },

    async deny(input: { toolCallId: string }) {
      const row = rows.get(input.toolCallId);
      if (row && row.status === "pending") row.status = "denied";
    },
  };

  return { store, rows };
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
      {
        content: [{ type: "text", text: "The tool completed." }],
        finishReason: { unified: "stop", raw: undefined },
        usage,
        warnings: [],
      },
      {
        content: [{ type: "text", text: "The tool completed." }],
        finishReason: { unified: "stop", raw: undefined },
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

/** Issues an approval request and returns the messages needed to continue. */
async function requestApproval(
  chat: ReturnType<typeof buildMcpChatTools>,
  model: ReturnType<typeof mockModel>,
): Promise<{ approvalId: string; messages: ModelMessage[] }> {
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
  assert.equal(request.type, "tool-approval-request");

  return {
    approvalId: request.approvalId,
    messages: [
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
    ],
  };
}

describe("ordinary-chat MCP approvals", () => {
  it("keeps shared loader declarations non-executing and binds chat execution separately", async () => {
    const entry = loadedTool();
    const runtime = runtimeFor(entry);
    const { store } = memoryGrantStore();
    const chat = buildMcpChatTools(
      runtime,
      { userId: USER_ID, threadId: THREAD_ID, agentId: AGENT_ID },
      { grantStore: store },
    );

    assert.ok(chat.tools[entry.name]);
    assert.equal(typeof chat.tools[entry.name].execute, "function");
    assert.equal(runtime.declarations[entry.name].execute, undefined);
    assert.deepEqual(chat.approvalRequired, [entry.name]);

    const reason = `MCP tool "${entry.externalToolId}" from ${entry.serverName} requires your approval before it can run.`;
    const approval = chat.approval[entry.name];
    const decision = await approval({ query: "inbox" }, { toolCallId: "call-1" });
    assert.deepEqual(decision, { type: "user-approval", reason });

    const execute = chat.tools[entry.name].execute as
      | ((input: unknown, options: unknown) => Promise<unknown>)
      | undefined;
    // The approval above recorded the grant, so the tool may run once.
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
    const { store } = memoryGrantStore();
    const chat = buildMcpChatTools(
      runtime,
      { userId: USER_ID, threadId: THREAD_ID, agentId: AGENT_ID },
      { grantStore: store },
    );
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
    const { store } = memoryGrantStore();
    const chat = buildMcpChatTools(
      runtime,
      { userId: USER_ID, threadId: THREAD_ID, agentId: AGENT_ID },
      { grantStore: store },
    );
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
    const { store } = memoryGrantStore();
    const chat = buildMcpChatTools(
      runtime,
      { userId: USER_ID, threadId: THREAD_ID, agentId: AGENT_ID },
      { grantStore: store },
    );
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
    const { store } = memoryGrantStore();
    const chat = buildMcpChatTools(
      runtime,
      { userId: USER_ID, threadId: THREAD_ID, agentId: AGENT_ID },
      { grantStore: store },
    );
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

  it("executes an approved tool only once, even when the approval is replayed", async () => {
    const calls: Array<Record<string, unknown>> = [];
    const entry = loadedTool();
    const runtime = runtimeFor(entry);
    runtime.execute = async (_name, args) => {
      calls.push(args);
      return { ok: true };
    };
    const { store } = memoryGrantStore();
    const chat = buildMcpChatTools(
      runtime,
      { userId: USER_ID, threadId: THREAD_ID, agentId: AGENT_ID },
      { grantStore: store },
    );
    const model = mockModel();

    const { messages } = await requestApproval(chat, model);

    await generateText({
      model,
      tools: chat.tools,
      toolApproval: chat.approval,
      experimental_toolApprovalSecret: SECRET,
      messages,
      stopWhen: isStepCount(2),
    });
    assert.equal(calls.length, 1);

    // The same signed approval, submitted again, must not run the tool twice.
    await generateText({
      model,
      tools: chat.tools,
      toolApproval: chat.approval,
      experimental_toolApprovalSecret: SECRET,
      messages,
      stopWhen: isStepCount(2),
    });

    assert.equal(calls.length, 1);
  });

  it("refuses an approval that is replayed into another thread", async () => {
    const calls: Array<Record<string, unknown>> = [];
    const entry = loadedTool();
    const runtime = runtimeFor(entry);
    runtime.execute = async (_name, args) => {
      calls.push(args);
      return { ok: true };
    };
    const { store } = memoryGrantStore();
    const chat = buildMcpChatTools(
      runtime,
      { userId: USER_ID, threadId: THREAD_ID, agentId: AGENT_ID },
      { grantStore: store },
    );
    const model = mockModel();

    const { messages } = await requestApproval(chat, model);

    // The same signed approval, replayed into a different conversation.
    const otherThread = buildMcpChatTools(
      runtime,
      {
        userId: USER_ID,
        threadId: "44444444-4444-4444-8444-444444444444",
        agentId: AGENT_ID,
      },
      { grantStore: store },
    );

    await generateText({
      model,
      tools: otherThread.tools,
      toolApproval: otherThread.approval,
      experimental_toolApprovalSecret: SECRET,
      messages,
      stopWhen: isStepCount(2),
    });

    assert.equal(calls.length, 0);
  });

  it("refuses an approval that is replayed for another agent", async () => {
    const calls: Array<Record<string, unknown>> = [];
    const entry = loadedTool();
    const runtime = runtimeFor(entry);
    runtime.execute = async (_name, args) => {
      calls.push(args);
      return { ok: true };
    };
    const { store } = memoryGrantStore();
    const chat = buildMcpChatTools(
      runtime,
      { userId: USER_ID, threadId: THREAD_ID, agentId: AGENT_ID },
      { grantStore: store },
    );
    const model = mockModel();

    const { messages } = await requestApproval(chat, model);

    const otherAgent = buildMcpChatTools(
      runtime,
      {
        userId: USER_ID,
        threadId: THREAD_ID,
        agentId: "55555555-5555-4555-8555-555555555555",
      },
      { grantStore: store },
    );

    await generateText({
      model,
      tools: otherAgent.tools,
      toolApproval: otherAgent.approval,
      experimental_toolApprovalSecret: SECRET,
      messages,
      stopWhen: isStepCount(2),
    });

    assert.equal(calls.length, 0);
  });

  it("refuses an approval after the MCP connection changed", async () => {
    const calls: Array<Record<string, unknown>> = [];
    const entry = loadedTool();
    const runtime = runtimeFor(entry);
    runtime.execute = async (_name, args) => {
      calls.push(args);
      return { ok: true };
    };
    const { store } = memoryGrantStore();
    const chat = buildMcpChatTools(
      runtime,
      { userId: USER_ID, threadId: THREAD_ID, agentId: AGENT_ID },
      { grantStore: store },
    );
    const model = mockModel();

    const { messages } = await requestApproval(chat, model);

    // The integration was reconnected: the same tool now runs on another
    // connection, so the approval issued for the old one no longer applies.
    const reconnected = runtimeFor(
      loadedTool({ connectionId: "connection-2" }),
    );
    reconnected.execute = runtime.execute;

    const afterReconnect = buildMcpChatTools(
      reconnected,
      { userId: USER_ID, threadId: THREAD_ID, agentId: AGENT_ID },
      { grantStore: store },
    );

    await generateText({
      model,
      tools: afterReconnect.tools,
      toolApproval: afterReconnect.approval,
      experimental_toolApprovalSecret: SECRET,
      messages,
      stopWhen: isStepCount(2),
    });

    assert.equal(calls.length, 0);
  });

  it("refuses an approval that expired", async () => {
    const calls: Array<Record<string, unknown>> = [];
    const entry = loadedTool();
    const runtime = runtimeFor(entry);
    runtime.execute = async (_name, args) => {
      calls.push(args);
      return { ok: true };
    };
    const { store, rows } = memoryGrantStore();
    const chat = buildMcpChatTools(
      runtime,
      { userId: USER_ID, threadId: THREAD_ID, agentId: AGENT_ID },
      { grantStore: store },
    );
    const model = mockModel();

    const { messages } = await requestApproval(chat, model);

    const grant = rows.get("call-1");
    assert.ok(grant);
    grant.expiresAt = Date.now() - 1;

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
});
