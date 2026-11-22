import assert from "node:assert/strict";
import { describe, it } from "node:test";

import {
  currentPerfScope,
  measurePerf,
  tracePerf,
  withPerfScope,
} from "../perf";

describe("performance tracing", () => {
  it("is inert when PERF_TRACE is not enabled", async () => {
    const previous = process.env.PERF_TRACE;
    delete process.env.PERF_TRACE;
    const logs: unknown[] = [];
    const originalLog = console.log;
    console.log = (...args: unknown[]) => logs.push(args);

    try {
      const result = await measurePerf("chat_stage", "auth", async () => "ok");
      assert.equal(result, "ok");
      assert.equal(logs.length, 0);
    } finally {
      console.log = originalLog;
      if (previous === undefined) delete process.env.PERF_TRACE;
      else process.env.PERF_TRACE = previous;
    }
  });

  it("emits a structured timing event and preserves the operation result", async () => {
    const previous = process.env.PERF_TRACE;
    process.env.PERF_TRACE = "1";
    const lines: string[] = [];
    const originalLog = console.log;
    console.log = (value: unknown) => lines.push(String(value));

    try {
      const result = await measurePerf("chat_stage", "prompt_build", async () => "built", {
        metadata: { private_value: 0 },
      });
      assert.equal(result, "built");
      assert.equal(lines.length, 1);
      const event = JSON.parse(lines[0]) as Record<string, unknown>;
      assert.equal(event.type, "perf_trace");
      assert.equal(event.kind, "chat_stage");
      assert.equal(event.name, "prompt_build");
      assert.equal(event.status, "ok");
      assert.equal(typeof event.duration_ms, "number");
    } finally {
      console.log = originalLog;
      if (previous === undefined) delete process.env.PERF_TRACE;
      else process.env.PERF_TRACE = previous;
    }
  });

  it("rethrows the original error without logging its message", async () => {
    const previous = process.env.PERF_TRACE;
    process.env.PERF_TRACE = "1";
    const lines: string[] = [];
    const originalLog = console.log;
    console.log = (value: unknown) => lines.push(String(value));
    const failure = new Error("private provider detail");

    try {
      await assert.rejects(
        measurePerf("model_attempt", "primary", async () => {
          throw failure;
        }),
        (error: unknown) => error === failure,
      );
      const event = JSON.parse(lines[0]) as Record<string, unknown>;
      assert.equal(event.status, "error");
      assert.equal(event.metadata && (event.metadata as { error_type?: string }).error_type, "Error");
      assert.equal(lines[0].includes("private provider detail"), false);
    } finally {
      console.log = originalLog;
      if (previous === undefined) delete process.env.PERF_TRACE;
      else process.env.PERF_TRACE = previous;
    }
  });

  it("inherits run scope through nested operations", () => {
    const previous = process.env.PERF_TRACE;
    process.env.PERF_TRACE = "1";
    const originalLog = console.log;
    console.log = () => {};

    try {
      withPerfScope({ kind: "agent", runId: "run-1" }, () => {
        assert.equal(currentPerfScope()?.runId, "run-1");
        tracePerf({ kind: "db_call", name: "threads" });
      });
    } finally {
      console.log = originalLog;
      if (previous === undefined) delete process.env.PERF_TRACE;
      else process.env.PERF_TRACE = previous;
    }
  });
});
