import assert from "node:assert/strict";
import { describe, it } from "node:test";

import {
  buildThreadContext,
  formatThreadContext,
  textFromParts,
} from "@/lib/agent/thread-context";

describe("Task Mode thread context", () => {
  it("keeps only the text of a stored message", () => {
    assert.equal(
      textFromParts([
        { type: "text", text: "hello" },
        { type: "tool-mcp_composio_X", toolCallId: "call-1" },
        { type: "text", text: "world" },
      ]),
      "hello world",
    );
    assert.equal(textFromParts(undefined), "");
    assert.equal(textFromParts("not parts"), "");
  });

  it("keeps the last turns of the conversation", () => {
    const rows = [
      { role: "user", parts: [{ type: "text", text: "first" }] },
      { role: "assistant", parts: [{ type: "text", text: "second" }] },
      { role: "user", parts: [{ type: "text", text: "third" }] },
    ];

    const context = buildThreadContext(rows, 2);
    assert.deepEqual(context.turns, [
      { role: "assistant", text: "second" },
      { role: "user", text: "third" },
    ]);
  });

  it("truncates a very long turn", () => {
    const context = buildThreadContext([
      { role: "user", parts: [{ type: "text", text: "x".repeat(5_000) }] },
    ]);
    assert.equal(context.turns[0].text.length, 1_500);
  });

  it("renders the context as a compact prompt block", () => {
    assert.equal(formatThreadContext(null), "");
    assert.equal(formatThreadContext({ turns: [] }), "");
    assert.equal(
      formatThreadContext({
        turns: [
          { role: "user", text: "Find my invoices" },
          { role: "assistant", text: "There are three." },
        ],
      }),
      "User: Find my invoices\nAssistant: There are three.",
    );
  });
});
