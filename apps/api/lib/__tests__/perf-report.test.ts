import assert from "node:assert/strict";
import { describe, it } from "node:test";

import { buildPerfReport, percentile } from "../perf-report";

describe("performance report aggregation", () => {
  it("calculates interpolated percentiles", () => {
    assert.equal(percentile([], 0.5), null);
    assert.equal(percentile([10, 20], 0.5), 15);
    assert.equal(percentile([100, 200, 400], 0.95), 380);
  });

  it("aggregates node, provider, and per-run metrics", () => {
    const report = buildPerfReport({
      runs: [
        { id: "run-1", created_at: "2026-01-01T00:00:00.000Z", tokens_used: 10 },
        { id: "run-2", created_at: "2026-01-01T00:01:00.000Z", tokens_used: 0 },
      ],
      usage: [
        {
          id: 1,
          run_id: "run-1",
          provider: "google",
          model: "model-a",
          status: "ok",
          input_tokens: 8,
          output_tokens: 2,
          latency_ms: 100,
          created_at: "2026-01-01T00:00:01.000Z",
        },
        {
          id: 2,
          run_id: "run-1",
          provider: "google",
          model: "model-a",
          status: "error",
          input_tokens: 0,
          output_tokens: 0,
          latency_ms: 200,
          created_at: "2026-01-01T00:00:02.000Z",
        },
        {
          id: 3,
          run_id: "run-2",
          provider: "groq",
          model: "model-b",
          status: "rate_limited",
          input_tokens: 0,
          output_tokens: 0,
          latency_ms: 300,
          created_at: "2026-01-01T00:01:01.000Z",
        },
        {
          id: 4,
          run_id: null,
          provider: "google",
          model: "model-a",
          status: "ok",
          input_tokens: 50,
          output_tokens: 5,
          latency_ms: 400,
          created_at: "2026-01-01T00:02:00.000Z",
        },
        {
          id: 5,
          run_id: null,
          provider: "openrouter",
          model: "model-c",
          status: "ok",
          input_tokens: 1,
          output_tokens: 0,
          latency_ms: 50,
          created_at: "2026-01-01T00:03:00.000Z",
        },
      ],
      events: [
        {
          id: 1,
          run_id: "run-1",
          type: "node_start",
          payload: { node: "plan" },
          created_at: "2026-01-01T00:00:03.000Z",
        },
        {
          id: 2,
          run_id: "run-1",
          type: "node_end",
          payload: { node: "plan" },
          created_at: "2026-01-01T00:00:03.050Z",
        },
        {
          id: 3,
          run_id: "run-2",
          type: "perf",
          payload: { kind: "node", name: "act_llm", duration_ms: 100 },
          created_at: "2026-01-01T00:01:02.000Z",
        },
        {
          id: 4,
          run_id: "run-1",
          type: "perf",
          payload: { kind: "inngest_step", name: "execute-agent-graph", duration_ms: 500 },
          created_at: "2026-01-01T00:01:03.000Z",
        },
        {
          id: 5,
          run_id: "run-2",
          type: "perf",
          payload: { kind: "inngest_step", name: "execute-agent-graph", duration_ms: 600 },
          created_at: "2026-01-01T00:01:04.000Z",
        },
      ],
    });

    assert.equal(report.runs, 2);
    assert.deepEqual(
      report.nodeLatency.map((row) => [row.node, row.samples, row.p50Ms]),
      [
        ["act_llm", 1, 100],
        ["plan", 1, 50],
      ],
    );

    const google = report.providerLatency.find((row) => row.provider === "google");
    assert.equal(google?.calls, 3);
    assert.equal(google?.errorRatePct, 33.3);
    assert.equal(google?.p50Ms, 200);
    assert.equal(google?.p95Ms, 380);

    const groq = report.providerLatency.find((row) => row.provider === "groq");
    assert.equal(groq?.rateLimitedRatePct, 100);

    const openrouter = report.providerLatency.find((row) => row.provider === "openrouter");
    assert.equal(openrouter?.errorRatePct, 0);
    assert.equal(openrouter?.rateLimitedRatePct, 0);

    assert.equal(report.averageLlmCallsPerRun, 1.5);
    assert.equal(report.averageSuccessfulLlmCallsPerRun, 0.5);
    assert.equal(report.averageProviderTokensPerRun, 5);
    assert.equal(report.averageProviderTokensPerRunWithUsage, 5);
    assert.equal(report.averagePersistedTokensPerRun, 5);
    assert.equal(report.averageInngestStepsPerRun, 1);
    assert.equal(report.runsWithInngestStepSamples, 2);
  });

  it("returns explicit nulls for an empty dataset", () => {
    const report = buildPerfReport({ runs: [], usage: [], events: [] });
    assert.equal(report.runs, 0);
    assert.equal(report.averageLlmCallsPerRun, null);
    assert.equal(report.averageInngestStepsPerRun, null);
    assert.deepEqual(report.nodeLatency, []);
    assert.deepEqual(report.providerLatency, []);
  });
});
