import assert from "node:assert/strict";
import { describe, it } from "node:test";

import { selectRunDispatch } from "@/lib/agent/dispatch";

describe("run graph dispatch", () => {
  it("selects the group parent graph for a group run", () => {
    assert.equal(
      selectRunDispatch({
        groupId: "group-1",
        parentRunId: null,
        agentId: null,
        isSupervisor: false,
      }),
      "group",
    );
  });

  it("keeps a group member turn on the single-agent graph", () => {
    assert.equal(
      selectRunDispatch({
        groupId: "group-1",
        parentRunId: "parent-1",
        agentId: "agent-1",
        isSupervisor: true,
      }),
      "group-member",
    );
  });

  it("keeps Supervisor and ordinary agent dispatch unchanged", () => {
    assert.equal(
      selectRunDispatch({
        groupId: null,
        parentRunId: null,
        agentId: "agent-1",
        isSupervisor: true,
      }),
      "supervisor",
    );
    assert.equal(
      selectRunDispatch({
        groupId: null,
        parentRunId: null,
        agentId: "agent-1",
        isSupervisor: false,
      }),
      "agent",
    );
  });
});
