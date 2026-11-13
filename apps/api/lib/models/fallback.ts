import type { LanguageModel } from "ai";
import type { ModelRegistryEntry, Provider, RequiredCapabilities } from "@agent/shared";

import { assertCapabilities } from "./capability";
import { ModelLayerError, ModelRegistryError } from "./errors";
import { findRegistryEntry } from "./registry";
import { resolveModel } from "./resolver";
import { recordUsage as defaultRecordUsage, type UsageRecord, type UsageStatus } from "./usage";

export type AttemptOutcome = "ok" | "rate_limited" | "error" | "skipped";

export type FallbackAttempt = {
  modelId: string;
  provider: Provider | null;
  outcome: AttemptOutcome;
  reason?: string;
  /** 1-based try number for this model (a retry increments it). */
  tryNumber: number;
  latencyMs?: number;
};

export type FallbackOptions = {
  /** What the request needs. Candidates that cannot serve it are skipped. */
  required?: RequiredCapabilities;
  userId?: string;
  runId?: string | null;
  /** Extra retries on the same model after a retryable failure. Default 1. */
  retriesPerModel?: number;
  /** Base backoff between retries. Default 1500 ms. */
  retryDelayMs?: number;
  /** Injectable sleep (tests). */
  sleep?: (ms: number) => Promise<void>;
  /** Called after a successful call with token counts, if the result carries them. */
  onUsage?: (entry: ModelRegistryEntry, usage: TokenUsage) => void | Promise<void>;
  /** Injectable usage recorder (tests). Defaults to writing provider_usage rows. */
  recordUsage?: (record: UsageRecord) => Promise<void>;
};

export type TokenUsage = {
  inputTokens: number;
  outputTokens: number;
};

export type FallbackResult<T> = {
  result: T;
  modelId: string;
  attempts: FallbackAttempt[];
};

const defaultSleep = (ms: number) => new Promise<void>((resolve) => setTimeout(resolve, ms));

type ErrorClassification = {
  outcome: AttemptOutcome;
  retryable: boolean;
  reason: string;
};

/** Decides whether a provider failure is worth retrying / falling back on. */
export function classifyError(error: unknown): ErrorClassification {
  const err = error as {
    statusCode?: number;
    status?: number;
    isRetryable?: boolean;
    name?: string;
    message?: string;
    cause?: { name?: string; message?: string };
  };

  const status = err?.statusCode ?? err?.status;
  const message = err?.message ?? String(error);

  if (status === 429) {
    return { outcome: "rate_limited", retryable: true, reason: message || "rate limited" };
  }
  if (typeof status === "number" && status >= 500) {
    return { outcome: "error", retryable: true, reason: message || `provider error ${status}` };
  }
  if (status === 408 || status === 409) {
    return { outcome: "error", retryable: true, reason: message || `provider error ${status}` };
  }
  if (err?.isRetryable === true) {
    return { outcome: "error", retryable: true, reason: message || "retryable provider error" };
  }
  const name = err?.name ?? err?.cause?.name ?? "";
  if (name === "TimeoutError" || name === "AbortError" || /timeout|timed out/i.test(message)) {
    return { outcome: "error", retryable: true, reason: message || "timeout" };
  }

  return { outcome: "error", retryable: false, reason: message || "provider error" };
}

/** Pulls token counts out of a result when the AI SDK reported them. */
function extractUsage(result: unknown): TokenUsage | null {
  const usage = (result as { usage?: Record<string, number | undefined> } | null)?.usage;
  if (!usage) return null;
  const inputTokens = usage.inputTokens ?? usage.promptTokens ?? 0;
  const outputTokens = usage.outputTokens ?? usage.completionTokens ?? 0;
  if (inputTokens === 0 && outputTokens === 0) return null;
  return { inputTokens, outputTokens };
}

/**
 * Runs `run` against the first model that works, falling back through the list
 * on retryable failures (429, 5xx, timeout).
 *
 * Order of operations: capability check -> resolve model -> call -> on
 * retryable failure retry once -> next model. Candidates that cannot serve the
 * request (missing capability, no API key) are skipped, never silently used.
 */
export async function withFallback<T>(
  ids: string[],
  run: (model: LanguageModel, entry: ModelRegistryEntry) => Promise<T>,
  options: FallbackOptions = {},
): Promise<FallbackResult<T>> {
  const retries = options.retriesPerModel ?? 1;
  const delay = options.retryDelayMs ?? 1500;
  const sleep = options.sleep ?? defaultSleep;
  const record = options.recordUsage ?? defaultRecordUsage;
  const attempts: FallbackAttempt[] = [];

  if (ids.length === 0) {
    throw new ModelLayerError("all_models_failed", "No models were provided.");
  }

  for (const id of ids) {
    const entry = findRegistryEntry(id);
    if (!entry) {
      attempts.push({
        modelId: id,
        provider: null,
        outcome: "skipped",
        reason: "unknown_model",
        tryNumber: 0,
      });
      continue;
    }

    // Capability gate — before any provider call.
    try {
      assertCapabilities(entry, options.required ?? {});
    } catch (error) {
      attempts.push({
        modelId: id,
        provider: entry.provider,
        outcome: "skipped",
        reason: error instanceof Error ? error.message : "capability_mismatch",
        tryNumber: 0,
      });
      await record({
        userId: options.userId ?? "00000000-0000-0000-0000-000000000000",
        provider: entry.provider,
        model: id,
        runId: options.runId ?? null,
        status: "skipped",
      });
      continue;
    }

    // Resolve the provider model — throws when the API key is missing.
    let model: LanguageModel;
    try {
      model = resolveModel(id).model;
    } catch (error) {
      attempts.push({
        modelId: id,
        provider: entry.provider,
        outcome: "skipped",
        reason: error instanceof Error ? error.message : "provider_not_configured",
        tryNumber: 0,
      });
      await record({
        userId: options.userId ?? "00000000-0000-0000-0000-000000000000",
        provider: entry.provider,
        model: id,
        runId: options.runId ?? null,
        status: "skipped",
      });
      continue;
    }

    for (let tryNumber = 1; tryNumber <= retries + 1; tryNumber += 1) {
      const startedAt = Date.now();
      try {
        const result = await run(model, entry);
        const latencyMs = Date.now() - startedAt;

        attempts.push({ modelId: id, provider: entry.provider, outcome: "ok", tryNumber, latencyMs });

        const usage = extractUsage(result);
        await record({
          userId: options.userId ?? "00000000-0000-0000-0000-000000000000",
          provider: entry.provider,
          model: id,
          runId: options.runId ?? null,
          status: "ok",
          inputTokens: usage?.inputTokens ?? null,
          outputTokens: usage?.outputTokens ?? null,
          latencyMs,
        });
        if (usage) await options.onUsage?.(entry, usage);

        return { result, modelId: id, attempts };
      } catch (error) {
        const latencyMs = Date.now() - startedAt;
        const classification = classifyError(error);

        attempts.push({
          modelId: id,
          provider: entry.provider,
          outcome: classification.outcome,
          reason: classification.reason,
          tryNumber,
          latencyMs,
        });

        await record({
          userId: options.userId ?? "00000000-0000-0000-0000-000000000000",
          provider: entry.provider,
          model: id,
          runId: options.runId ?? null,
          status: classification.outcome as UsageStatus,
          latencyMs,
        });

        if (classification.retryable && tryNumber <= retries) {
          await sleep(delay * tryNumber);
          continue;
        }
        break; // move to the next model
      }
    }
  }

  const summary = attempts
    .map((attempt) => `${attempt.modelId}: ${attempt.outcome}${attempt.reason ? ` (${attempt.reason})` : ""}`)
    .join("; ");

  throw new ModelLayerError(
    "all_models_failed",
    `All candidate models failed. ${summary}`,
    { attempts },
  );
}

export { ModelRegistryError };
