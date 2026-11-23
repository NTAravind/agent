import { isStepCount, streamText, type ModelMessage, type TextStreamPart, type ToolSet } from "ai";
import type { Provider, RequiredCapabilities } from "@agent/shared";

import { assertCapabilities } from "@/lib/models/capability";
import { ModelLayerError } from "@/lib/models/errors";
import { findRegistryEntry } from "@/lib/models/registry";
import { resolveModel } from "@/lib/models/resolver";
import { recordUsage } from "@/lib/models/usage";
import { elapsedMs, tracePerf } from "@/lib/perf";

export type ChatStreamAttempt = {
  modelId: string;
  provider: Provider | null;
  outcome: "ok" | "error" | "skipped";
  reason?: string;
  latencyMs?: number;
  ttftMs?: number;
};

/**
 * Per-tool approval policy for `streamText.toolApproval`.
 *
 * A tool may use a static status or a function. The function form is what
 * lets the application record a one-time approval grant before the signed
 * request is issued.
 */
export type ChatToolApproval = Record<
  string,
  | { type: "user-approval"; reason: string }
  | ((
      input: unknown,
      options: { toolCallId: string },
    ) =>
      | { type: "user-approval"; reason: string }
      | Promise<{ type: "user-approval"; reason: string }>)
>;

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
  /** Per-tool manual approval policy for sensitive tool calls. */
  toolApproval?: ChatToolApproval;
  /** Server-only HMAC secret used to sign and verify approval requests. */
  toolApprovalSecret?: string | Uint8Array;
  /** System prompt. */
  system?: string;
  /** How many tool round-trips are allowed in one turn. */
  maxSteps?: number;
  /** Monotonic request start used to report end-to-end time to first token. */
  requestStartedAt?: number;
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

  // A manual approval without a signing secret would let a modified client
  // forge the decision. Fail closed before any provider request is made.
  if (
    options.toolApproval &&
    Object.keys(options.toolApproval).length > 0 &&
    !options.toolApprovalSecret
  ) {
    throw new Error(
      "TOOL_APPROVAL_SECRET is required for approval-gated chat tools.",
    );
  }

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
    const attemptStartedAt = performance.now();
    const attemptId = `${modelId}:${attemptStartedAt}:1`;

    const result = streamText({
      model,
      messages: options.messages,
      ...(options.system ? { system: options.system } : {}),
      ...(options.temperature !== undefined ? { temperature: options.temperature } : {}),
      ...(options.maxOutputTokens !== undefined ? { maxOutputTokens: options.maxOutputTokens } : {}),
      ...(options.tools ? { tools: options.tools } : {}),
      ...(options.toolApproval ? { toolApproval: options.toolApproval } : {}),
      ...(options.toolApprovalSecret
        ? { experimental_toolApprovalSecret: options.toolApprovalSecret }
        : {}),
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
      const latencyMs = elapsedMs(attemptStartedAt);
      console.error(`[chat] ${modelId} failed before first token: ${reason}`);
      tracePerf({
        kind: "model_attempt",
        name: modelId,
        duration_ms: latencyMs,
        status: "error",
        run_id: options.runId ?? null,
        provider: entry.provider,
        model: modelId,
        attempt_id: attemptId,
        try_number: 1,
        outcome: failureStatus,
        metadata: { phase: "pre_content", error_type: "provider_stream_error" },
      });
      attempts.push({
        modelId,
        provider: entry.provider,
        outcome: "error",
        reason,
        latencyMs,
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

    const ttftMs = elapsedMs(attemptStartedAt);
    const attempt: ChatStreamAttempt = {
      modelId,
      provider: entry.provider,
      outcome: "ok",
      ttftMs,
    };
    attempts.push(attempt);

    tracePerf({
      kind: "model_attempt",
      name: modelId,
      duration_ms: ttftMs,
      status: "ok",
      run_id: options.runId ?? null,
      provider: entry.provider,
      model: modelId,
      attempt_id: attemptId,
      try_number: 1,
      outcome: "ok",
      ttft_ms: ttftMs,
      metadata: { phase: "ttft" },
    });
    tracePerf({
      kind: "chat_stage",
      name: "model_ttft",
      duration_ms: ttftMs,
      status: "ok",
      run_id: options.runId ?? null,
      provider: entry.provider,
      model: modelId,
      attempt_id: attemptId,
      ttft_ms: ttftMs,
    });
    if (options.requestStartedAt !== undefined) {
      tracePerf({
        kind: "chat_stage",
        name: "request_ttft",
        duration_ms: elapsedMs(options.requestStartedAt),
        status: "ok",
        run_id: options.runId ?? null,
        provider: entry.provider,
        model: modelId,
        attempt_id: attemptId,
        ttft_ms: ttftMs,
      });
    }

    let attemptFinished = false;
    const traceAttemptTotal = (outcome: "ok" | "error"): void => {
      if (attemptFinished) return;
      attemptFinished = true;
      const latencyMs = elapsedMs(attemptStartedAt);
      attempt.latencyMs = latencyMs;
      tracePerf({
        kind: "model_attempt",
        name: modelId,
        duration_ms: latencyMs,
        status: outcome === "ok" ? "ok" : "error",
        run_id: options.runId ?? null,
        provider: entry.provider,
        model: modelId,
        attempt_id: attemptId,
        try_number: 1,
        outcome,
        ttft_ms: ttftMs,
        metadata: { phase: "total" },
      });
    };

    // Re-emit the buffered pre-content parts, then the rest of the stream.
    const combined = new ReadableStream<TextStreamPart<ToolSet>>({
      start(controller) {
        for (const part of buffered) controller.enqueue(part);
        controller.enqueue(firstContent);
      },
      async pull(controller) {
        const { done, value } = await reader.read();
        if (done) {
          traceAttemptTotal("ok");
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
          traceAttemptTotal("error");
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
