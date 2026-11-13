import assert from "node:assert/strict";
import { describe, it } from "node:test";

import { ModelLayerError } from "../errors";
import { classifyError, withFallback } from "../fallback";
import { __setModelFactoryForTests } from "../resolver";
import type { UsageRecord } from "../usage";

type FakeModel = { modelId: string };

function rateLimitError() {
  const error = new Error("rate limit exceeded") as Error & { statusCode: number };
  error.statusCode = 429;
  return error;
}

function serverError() {
  const error = new Error("upstream unavailable") as Error & { statusCode: number };
  error.statusCode = 503;
  return error;
}

const noSleep = async () => {};

describe("classifyError", () => {
  it("treats 429 as retryable rate limiting", () => {
    const classification = classifyError(rateLimitError());
    assert.equal(classification.outcome, "rate_limited");
    assert.equal(classification.retryable, true);
  });

  it("treats 5xx as retryable", () => {
    assert.equal(classifyError(serverError()).retryable, true);
  });

  it("treats timeouts as retryable", () => {
    const error = new Error("Request timed out");
    error.name = "TimeoutError";
    assert.equal(classifyError(error).retryable, true);
  });

  it("treats 400 as not retryable", () => {
    const error = new Error("bad request") as Error & { statusCode: number };
    error.statusCode = 400;
    const classification = classifyError(error);
    assert.equal(classification.retryable, false);
    assert.equal(classification.outcome, "error");
  });
});

describe("withFallback", () => {
  it("falls through to the next model after a 429 on the primary", async () => {
    const calls: string[] = [];
    const restore = __setModelFactoryForTests((entry) => ({ modelId: entry.id }) as never);

    const result = await withFallback(
      ["google:gemini-3.8-flash", "groq:gpt-oss-120b"],
      async (model) => {
        const modelId = (model as unknown as FakeModel).modelId;
        calls.push(modelId);
        if (modelId === "google:gemini-3.8-flash") throw rateLimitError();
        return { text: "ok" };
      },
      {
        sleep: noSleep,
        retriesPerModel: 1,
        recordUsage: async () => {},
      },
    );

    assert.equal(result.modelId, "groq:gpt-oss-120b");
    assert.deepEqual(calls, ["google:gemini-3.8-flash", "google:gemini-3.8-flash", "groq:gpt-oss-120b"]);

    const outcomes = result.attempts.map((attempt) => `${attempt.modelId}:${attempt.outcome}:${attempt.tryNumber}`);
    assert.deepEqual(outcomes, [
      "google:gemini-3.8-flash:rate_limited:1",
      "google:gemini-3.8-flash:rate_limited:2",
      "groq:gpt-oss-120b:ok:1",
    ]);

    restore();
  });

  it("skips a fallback that lacks a required capability", async () => {
    const restore = __setModelFactoryForTests((entry) => ({ modelId: entry.id }) as never);
    const used: string[] = [];

    const result = await withFallback(
      ["groq:gpt-oss-120b", "google:gemini-3.8-flash"],
      async (model) => {
        used.push((model as unknown as FakeModel).modelId);
        return { text: "ok" };
      },
      {
        required: { vision: true },
        sleep: noSleep,
        recordUsage: async () => {},
      },
    );

    assert.equal(result.modelId, "google:gemini-3.8-flash");
    assert.deepEqual(used, ["google:gemini-3.8-flash"]);
    assert.equal(result.attempts[0]?.outcome, "skipped");
    assert.match(String(result.attempts[0]?.reason), /vision/);

    restore();
  });

  it("throws all_models_failed when every candidate fails", async () => {
    const restore = __setModelFactoryForTests((entry) => ({ modelId: entry.id }) as never);

    await assert.rejects(
      withFallback(
        ["google:gemini-3.8-flash", "groq:gpt-oss-120b"],
        async () => {
          throw serverError();
        },
        { sleep: noSleep, retriesPerModel: 0, recordUsage: async () => {} },
      ),
      (error: unknown) => {
        assert.ok(error instanceof ModelLayerError);
        assert.equal(error.code, "all_models_failed");
        return true;
      },
    );

    restore();
  });

  it("records one usage row per attempt", async () => {
    const rows: UsageRecord[] = [];
    const restore = __setModelFactoryForTests((entry) => ({ modelId: entry.id }) as never);

    await withFallback(
      ["google:gemini-3.8-flash", "groq:gpt-oss-120b"],
      async (model, entry) => {
        if (entry.id === "google:gemini-3.8-flash") throw rateLimitError();
        return { text: "ok", usage: { inputTokens: 12, outputTokens: 7 } };
      },
      {
        sleep: noSleep,
        retriesPerModel: 0,
        userId: "11111111-1111-1111-1111-111111111111",
        recordUsage: async (row) => {
          rows.push(row);
        },
      },
    );

    assert.equal(rows.length, 2);
    assert.equal(rows[0]?.status, "rate_limited");
    assert.equal(rows[1]?.status, "ok");
    assert.equal(rows[1]?.inputTokens, 12);
    assert.equal(rows[1]?.outputTokens, 7);

    restore();
  });
});
