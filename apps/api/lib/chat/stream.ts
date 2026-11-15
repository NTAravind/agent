import { isStepCount, streamText, type ModelMessage, type TextStreamPart, type ToolSet } from "ai";
import type { Provider, RequiredCapabilities } from "@agent/shared";

import { assertCapabilities } from "@/lib/models/capability";
import { ModelLayerError } from "@/lib/models/errors";
import { findRegistryEntry } from "@/lib/models/registry";
import { resolveModel } from "@/lib/models/resolver";
import { recordUsage } from "@/lib/models/usage";

export type ChatStreamAttempt = {
  modelId: string;
  provider: Provider | null;
  outcome: "ok" | "error" | "skipped";
  reason?: string;
};

export type ChatStreamOptions = {
  messages: ModelMessage[];
  /** Registry ids to try, in order. */
  modelIds: string[];
  userId: string;
  runId?: string | null;
  /** Capabilities the request needs (e.g. vision when an image is attached). */
  required?: RequiredCapabilities;
  temperature?: number;
  maxOutputTokens?: number;
  /** Tool set exposed to the model (see lib/tools). */
  tools?: ToolSet;
  /** System prompt. */
  system?: string;
  /** How many tool round-trips are allowed in one turn. */
  maxSteps?: number;
};

export type ChatStream = {
  /** The UI-message stream parts, ready for toUIMessageStream(). */
  stream: ReadableStream<TextStreamPart<ToolSet>>;
  modelId: string;
  provider: Provider;
  attempts: ChatStreamAttempt[];
};

/**
 * Streams a chat completion with cross-provider fallback.
 *
 * The fallback only applies *before the first token*: a provider that fails
 * with 429/5xx/auth has not produced anything yet, so we can safely try the
 * next model. Once text has been streamed, a failure is surfaced to the client
 * instead — switching models mid-answer would read as two different replies.
 */
export async function createChatStream(options: ChatStreamOptions): Promise<ChatStream> {
  const attempts: ChatStreamAttempt[] = [];

  for (const modelId of options.modelIds) {
    const entry = findRegistryEntry(modelId);
    if (!entry) {
      attempts.push({ modelId, provider: null, outcome: "skipped", reason: "unknown_model" });
      continue;
    }

    // Capability gate — before any provider call.
    try {
      assertCapabilities(entry, options.required ?? {});
    } catch (error) {
      attempts.push({
        modelId,
        provider: entry.provider,
        outcome: "skipped",
        reason: error instanceof Error ? error.message : "capability_mismatch",
      });
      await recordUsage({
        userId: options.userId,
        provider: entry.provider,
        model: modelId,
        runId: options.runId ?? null,
        status: "skipped",
        detail: error instanceof Error ? error.message : "capability_mismatch",
      });
      continue;
    }

    let model;
    try {
      model = resolveModel(modelId).model;
    } catch (error) {
      attempts.push({
        modelId,
        provider: entry.provider,
        outcome: "skipped",
        reason: error instanceof Error ? error.message : "provider_not_configured",
      });
      await recordUsage({
        userId: options.userId,
        provider: entry.provider,
        model: modelId,
        runId: options.runId ?? null,
        status: "skipped",
        detail: error instanceof Error ? error.message : "provider_not_configured",
      });
      continue;
    }

    let failureReason: string | undefined;
    let failureStatus: "error" | "rate_limited" = "error";

    const result = streamText({
      model,
      messages: options.messages,
      ...(options.system ? { system: options.system } : {}),
      ...(options.temperature !== undefined ? { temperature: options.temperature } : {}),
      ...(options.maxOutputTokens !== undefined ? { maxOutputTokens: options.maxOutputTokens } : {}),
      ...(options.tools ? { tools: options.tools } : {}),
      ...(options.maxSteps ? { stopWhen: isStepCount(options.maxSteps) } : {}),
      maxRetries: 1,
      onError: ({ error }) => {
        failureReason = error instanceof Error ? error.message : String(error);
        const status = (error as { statusCode?: number })?.statusCode;
        failureStatus = status === 429 ? "rate_limited" : "error";
      },
      onFinish: async ({ usage }) => {
        await recordUsage({
          userId: options.userId,
          provider: entry.provider,
          model: modelId,
          runId: options.runId ?? null,
          status: failureReason ? failureStatus : "ok",
          inputTokens: usage?.inputTokens ?? null,
          outputTokens: usage?.outputTokens ?? null,
        });
      },
    });

    // Wait for a *content* part: the UI protocol emits `start` /
    // `message-metadata` before the provider request resolves, so a
    // request-time failure (429, 5xx, auth) shows up as an error part right
    // after those. Buffer the pre-content parts so they can be re-emitted.
    const reader = result.stream.getReader();
    const buffered: TextStreamPart<ToolSet>[] = [];
    let firstContent: TextStreamPart<ToolSet> | undefined;

    while (true) {
      const { done, value } = await reader.read();
      if (done) {
        failureReason = failureReason ?? "provider returned an empty stream";
        break;
      }
      if (!value) continue;
      if (value.type === "error") {
        failureReason = describeStreamError(value.error);
        break;
      }
      buffered.push(value);
      if (value.type === "start" || value.type === "start-step") {
        continue;
      }
      firstContent = value;
      break;
    }

    if (failureReason || !firstContent) {
      const reason = failureReason ?? "provider stream ended before any content";
      console.error(`[chat] ${modelId} failed before first token: ${reason}`);
      attempts.push({
        modelId,
        provider: entry.provider,
        outcome: "error",
        reason,
      });
      await reader.cancel().catch(() => {});
      await recordUsage({
        userId: options.userId,
        provider: entry.provider,
        model: modelId,
        runId: options.runId ?? null,
        status: failureStatus,
        detail: reason,
      });
      continue;
    }

    attempts.push({ modelId, provider: entry.provider, outcome: "ok" });

    // Re-emit the buffered pre-content parts, then the rest of the stream.
    const combined = new ReadableStream<TextStreamPart<ToolSet>>({
      start(controller) {
        for (const part of buffered) controller.enqueue(part);
        controller.enqueue(firstContent);
      },
      async pull(controller) {
        const { done, value } = await reader.read();
        if (done) {
          controller.close();
          return;
        }
        if (!value) return;
        if (value.type === "error") {
          // Mid-stream failure: surface the real reason instead of the SDK's
          // generic "An error occurred." (throws out of the merged stream,
          // which the UI stream's onError turns into the error part).
          const reason = describeStreamError(value.error);
          console.error(`[chat] ${modelId} failed mid-stream: ${reason}`);
          await recordUsage({
            userId: options.userId,
            provider: entry.provider,
            model: modelId,
            runId: options.runId ?? null,
            status: failureStatus,
            detail: reason,
          });
          throw new Error(reason);
        }
        controller.enqueue(value);
      },
      cancel(reason) {
        void reader.cancel(reason).catch(() => {});
      },
    });

    return { stream: combined, modelId, provider: entry.provider, attempts };
  }

  const summary = attempts
    .map((attempt) => `${attempt.modelId}: ${attempt.outcome}${attempt.reason ? ` (${attempt.reason})` : ""}`)
    .join("; ");

  throw new ModelLayerError("all_models_failed", `Every model failed. ${summary}`, { attempts });
}

function describeStreamError(error: unknown): string {
  if (!error) return "provider error";
  if (typeof error === "string") return error;
  const err = error as { message?: string; statusCode?: number };
  if (err.statusCode) return `${err.statusCode}: ${err.message ?? "provider error"}`;
  return err.message ?? "provider error";
}
