import assert from "node:assert/strict";
import { describe, it } from "node:test";

import { shouldPersistOrdinaryRunResult } from "@/lib/agent/run-persistence";

const USER_ID = "11111111-1111-4111-8111-111111111111";
const THREAD_ID = "22222222-2222-4222-8222-222222222222";

describe("ordinary run message persistence", () => {
  it("persists a root ordinary run result", () => {
    assert.equal(
      shouldPersistOrdinaryRunResult({
        user_id: USER_ID,
        thread_id: THREAD_ID,
        agent_id: null,
        group_id: null,
        parent_run_id: null,
        routine_id: null,
      }),
      true,
    );
  });

  it("skips group, child, Supervisor-child, and routine runs", () => {
    const root = {
      user_id: USER_ID,
      thread_id: THREAD_ID,
      agent_id: null,
      group_id: null,
      parent_run_id: null,
      routine_id: null,
    };

    assert.equal(
      shouldPersistOrdinaryRunResult({ ...root, group_id: "group-1" }),
      false,
    );
    assert.equal(
      shouldPersistOrdinaryRunResult({ ...root, parent_run_id: "parent-1" }),
      false,
    );
    assert.equal(
      shouldPersistOrdinaryRunResult({ ...root, routine_id: "routine-1" }),
      false,
    );
  });

  it("skips a run without an owned ordinary conversation", () => {
    assert.equal(
      shouldPersistOrdinaryRunResult({
        user_id: USER_ID,
        thread_id: null,
        group_id: null,
        parent_run_id: null,
        routine_id: null,
      }),
      false,
    );
    assert.equal(shouldPersistOrdinaryRunResult(null), false);
  });
});
