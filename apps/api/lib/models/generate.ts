import { generateText, type ToolSet } from "ai";
import type { RequiredCapabilities } from "@agent/shared";

import { withFallback, type FallbackAttempt } from "./fallback";
import { DEFAULT_FALLBACK_ORDER, DEFAULT_MODEL_ID } from "./registry";

export type GenerateWithFallbackOptions = {
  prompt: string;
  system?: string;
  /** Registry ids to try, in order. Defaults to the default model + fallbacks. */
  modelIds?: string[];
  required?: RequiredCapabilities;
  userId?: string;
  runId?: string | null;
  temperature?: number;
  maxOutputTokens?: number;
  tools?: ToolSet;
  abortSignal?: AbortSignal;
  retriesPerModel?: number;
  /** Retries inside the AI SDK per call. Default 1 (the chain adds its own). */
  maxRetries?: number;
};

/** The AI SDK result type, resolved from the function's own generics. */
export type GenerateTextOutput = Awaited<ReturnType<typeof generateText>>;

export type GenerateWithFallbackResult = {
  text: string;
  modelId: string;
  attempts: FallbackAttempt[];
  result: GenerateTextOutput;
};

/**
 * Convenience wrapper: runs a text generation through the fallback chain and
 * records usage. Every LLM call in the app should go through this or through
 * `withFallback` directly — never straight to a provider package.
 */
export async function generateTextWithFallback(
  options: GenerateWithFallbackOptions,
): Promise<GenerateWithFallbackResult> {
  const modelIds = options.modelIds ?? [DEFAULT_MODEL_ID, ...DEFAULT_FALLBACK_ORDER];

  const { result, modelId, attempts } = await withFallback(
    modelIds,
    (model) =>
      generateText({
        model,
        prompt: options.prompt,
        ...(options.system ? { system: options.system } : {}),
        ...(options.temperature !== undefined ? { temperature: options.temperature } : {}),
        ...(options.maxOutputTokens !== undefined ? { maxOutputTokens: options.maxOutputTokens } : {}),
        ...(options.tools ? { tools: options.tools } : {}),
        ...(options.abortSignal ? { abortSignal: options.abortSignal } : {}),
        maxRetries: options.maxRetries ?? 1,
      }),
    {
      required: options.required,
      userId: options.userId,
      runId: options.runId,
      retriesPerModel: options.retriesPerModel,
    },
  );

  return { text: result.text, modelId, attempts, result };
}
