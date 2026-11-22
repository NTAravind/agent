import assert from "node:assert/strict";
import { describe, it } from "node:test";

import { resolveChatAgentScope } from "@/lib/chat/agent-scope";

const AGENT_A = "6f9d5a1e-0f3f-4a5e-9c2f-1b2c3d4e5f60";
const AGENT_B = "7a0e6b2f-1a4c-4b6f-8d3a-2c3d4e5f6071";

describe("chat agent scope", () => {
  it("uses the stored thread agent when the request omits an agent", () => {
    assert.deepEqual(resolveChatAgentScope(null, AGENT_A), {
      ok: true,
      agentId: AGENT_A,
      bindToThread: false,
    });
  });

  it("accepts a request that repeats the stored thread agent", () => {
    assert.deepEqual(resolveChatAgentScope(AGENT_A, AGENT_A), {
      ok: true,
      agentId: AGENT_A,
      bindToThread: false,
    });
  });

  it("rejects a request that moves a thread to another agent", () => {
    const result = resolveChatAgentScope(AGENT_B, AGENT_A);
    assert.equal(result.ok, false);
    if (!result.ok) assert.equal(result.code, "agent_mismatch");
  });

  it("binds an unscoped thread to a requested agent", () => {
    assert.deepEqual(resolveChatAgentScope(AGENT_A, null), {
      ok: true,
      agentId: AGENT_A,
      bindToThread: true,
    });
  });

  it("keeps a thread unscoped when no agent is requested", () => {
    assert.deepEqual(resolveChatAgentScope(null, null), {
      ok: true,
      agentId: null,
      bindToThread: false,
    });
  });
});
