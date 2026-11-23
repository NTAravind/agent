import assert from "node:assert/strict";
import { describe, it } from "node:test";

import { resolveTaskThreadScope } from "@/lib/agent/task-thread";

const AGENT_A = "6f9d5a1e-0f3f-4a5e-9c2f-1b2c3d4e5f60";
const AGENT_B = "7a0e6b2f-1a4c-4b6f-8d3a-2c3d4e5f6071";

describe("Task Mode thread scope", () => {
  it("creates a new thread for the requested agent", () => {
    assert.deepEqual(
      resolveTaskThreadScope({
        hasThread: false,
        requestedAgentId: AGENT_A,
        fallbackAgentId: AGENT_B,
      }),
      { ok: true, agentId: AGENT_A, threadAction: "create" },
    );
  });

  it("uses the default agent when a new thread omits one", () => {
    assert.deepEqual(
      resolveTaskThreadScope({
        hasThread: false,
        requestedAgentId: null,
        fallbackAgentId: AGENT_A,
      }),
      { ok: true, agentId: AGENT_A, threadAction: "create" },
    );
  });

  it("reuses the persisted thread agent when the request omits one", () => {
    assert.deepEqual(
      resolveTaskThreadScope({
        hasThread: true,
        storedAgentId: AGENT_A,
        requestedAgentId: null,
        fallbackAgentId: AGENT_B,
      }),
      { ok: true, agentId: AGENT_A, threadAction: "reuse" },
    );
  });

  it("binds an unscoped thread to the requested agent", () => {
    assert.deepEqual(
      resolveTaskThreadScope({
        hasThread: true,
        storedAgentId: null,
        requestedAgentId: AGENT_A,
        fallbackAgentId: AGENT_B,
      }),
      { ok: true, agentId: AGENT_A, threadAction: "bind" },
    );
  });

  it("binds an unscoped thread to the default agent when the request omits one", () => {
    assert.deepEqual(
      resolveTaskThreadScope({
        hasThread: true,
        storedAgentId: null,
        requestedAgentId: null,
        fallbackAgentId: AGENT_A,
      }),
      { ok: true, agentId: AGENT_A, threadAction: "bind" },
    );
  });

  it("rejects a request that moves a thread to another agent", () => {
    const result = resolveTaskThreadScope({
      hasThread: true,
      storedAgentId: AGENT_A,
      requestedAgentId: AGENT_B,
    });
    assert.equal(result.ok, false);
    if (!result.ok) assert.equal(result.code, "agent_mismatch");
  });
});
