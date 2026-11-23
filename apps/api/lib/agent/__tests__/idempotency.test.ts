import assert from "node:assert/strict";
import { describe, it } from "node:test";

import { parseIdempotencyKey, runStartStatus } from "@/lib/agent/idempotency";

const KEY = "3f2504e0-4f89-41d3-9a0c-0305e82c3301";

describe("task start idempotency", () => {
  it("accepts a missing header (the request is simply not retry-safe)", () => {
    assert.deepEqual(parseIdempotencyKey(null), { ok: true, key: null });
    assert.deepEqual(parseIdempotencyKey(undefined), { ok: true, key: null });
    assert.deepEqual(parseIdempotencyKey("  "), { ok: true, key: null });
  });

  it("accepts a UUID key", () => {
    assert.deepEqual(parseIdempotencyKey(KEY), { ok: true, key: KEY });
    assert.deepEqual(parseIdempotencyKey(` ${KEY} `), { ok: true, key: KEY });
  });

  it("rejects a key that is not a UUID", () => {
    for (const value of ["abc", "1234", "'; drop table agent_runs; --"]) {
      const result = parseIdempotencyKey(value);
      assert.equal(result.ok, false);
    }
  });

  it("reports an unfinished run as accepted and a finished one as ok", () => {
    assert.equal(runStartStatus("queued"), 202);
    assert.equal(runStartStatus("running"), 202);
    assert.equal(runStartStatus("awaiting_approval"), 202);
    assert.equal(runStartStatus("paused"), 202);
    assert.equal(runStartStatus("succeeded"), 200);
    assert.equal(runStartStatus("failed"), 200);
    assert.equal(runStartStatus("cancelled"), 200);
  });
});
