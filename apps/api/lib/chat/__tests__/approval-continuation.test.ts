import assert from "node:assert/strict";
import { describe, it } from "node:test";

import {
  approvalDecisions,
  hasPendingToolApproval,
  isApprovalContinuation,
} from "@/lib/chat/approval-continuation";

describe("ordinary-chat approval continuation", () => {
  it("recognizes an assistant tool part after the user decision", () => {
    assert.equal(
      isApprovalContinuation([
        {
          role: "assistant",
          parts: [
            { type: "tool-mcp_composio_search_tools", state: "approval-responded" },
          ],
        },
      ]),
      true,
    );
  });

  it("recognizes dynamic MCP tool parts", () => {
    assert.equal(
      isApprovalContinuation([
        {
          role: "assistant",
          parts: [{ type: "dynamic-tool", state: "approval-responded" }],
        },
      ]),
      true,
    );
  });

  it("does not treat a normal assistant answer as a continuation", () => {
    assert.equal(
      isApprovalContinuation([
        { role: "assistant", parts: [{ type: "text", text: "done" }] },
      ]),
      false,
    );
  });

  it("detects an unanswered approval request", () => {
    assert.equal(
      hasPendingToolApproval({
        role: "assistant",
        parts: [
          { type: "tool-mcp_composio_search_tools", state: "approval-requested" },
        ],
      }),
      true,
    );
    assert.equal(
      hasPendingToolApproval({
        role: "assistant",
        parts: [
          { type: "tool-mcp_composio_search_tools", state: "approval-responded" },
        ],
      }),
      false,
    );
  });

  it("reads the approval decisions of the last assistant message", () => {
    assert.deepEqual(
      approvalDecisions([
        {
          role: "assistant",
          parts: [
            {
              type: "tool-mcp_composio_search_tools",
              state: "approval-responded",
              toolCallId: "call-1",
              approval: { id: "approval-1", approved: true },
            },
            {
              type: "tool-mcp_composio_send_email",
              state: "approval-responded",
              toolCallId: "call-2",
              approval: { id: "approval-2", approved: false },
            },
          ],
        },
      ]),
      [
        { toolCallId: "call-1", approved: true },
        { toolCallId: "call-2", approved: false },
      ],
    );
  });

  it("ignores decisions that are not on the last assistant message", () => {
    assert.deepEqual(
      approvalDecisions([
        {
          role: "assistant",
          parts: [
            {
              type: "tool-mcp_composio_search_tools",
              state: "approval-responded",
              toolCallId: "call-1",
              approval: { id: "approval-1", approved: false },
            },
          ],
        },
        { role: "user", parts: [{ type: "text", text: "hello" }] },
      ]),
      [],
    );
  });

  it("ignores tool parts that carry no decision", () => {
    assert.deepEqual(
      approvalDecisions([
        {
          role: "assistant",
          parts: [
            {
              type: "tool-mcp_composio_search_tools",
              state: "approval-requested",
              toolCallId: "call-1",
            },
          ],
        },
      ]),
      [],
    );
  });
});
