import assert from "node:assert/strict";
import { describe, it } from "node:test";

import {
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
});
