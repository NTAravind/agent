/**
 * Live provider check (Phase 0.5 acceptance).
 *
 *   npm run check:providers --workspace api
 *
 * 1. Runs the same prompt on Google, Groq and OpenRouter.
 * 2. Forces a 429 on the primary and checks the chain falls through.
 * 3. Prints the registry as the API exposes it.
 *
 * Consumes a few free-tier tokens.
 */
import { APICallError } from "ai";

import {
  DEFAULT_FALLBACK_ORDER,
  DEFAULT_MODEL_ID,
  MODEL_REGISTRY,
  __setModelFactoryForTests,
  generateTextWithFallback,
  getModel,
  listRegistry,
  providersWithKeys,
} from "../lib/models";

const PROMPT = "Reply with exactly: ok";

const CANDIDATES: Array<{ label: string; modelId: string }> = [
  { label: "Google", modelId: "google:gemini-3.8-flash" },
  { label: "Groq", modelId: "groq:gpt-oss-120b" },
  { label: "OpenRouter", modelId: "openrouter:gemini-3.8-flash" },
];

async function main() {
  console.log("Providers with keys:", providersWithKeys().join(", ") || "(none)");
  console.log("Registry:", listRegistry().length, "models\n");

  // 1. Same prompt, three providers.
  for (const candidate of CANDIDATES) {
    const started = Date.now();
    try {
      const { text, modelId, attempts } = await generateTextWithFallback({
        prompt: PROMPT,
        modelIds: [candidate.modelId],
        userId: process.env.ALLOWED_USER_ID,
        retriesPerModel: 0,
      });
      console.log(
        `✔ ${candidate.label.padEnd(11)} ${modelId.padEnd(28)} ${Date.now() - started}ms  reply=${JSON.stringify(text.slice(0, 40))}  attempts=${attempts.length}`,
      );
    } catch (error) {
      console.log(`✖ ${candidate.label.padEnd(11)} ${candidate.modelId}  ${String(error).slice(0, 140)}`);
    }
  }

  // 2. Forced 429 on the primary: the chain must fall through.
  console.log("\nForced 429 on the primary model:");

  // Capture the real fallback models before the factory is swapped out.
  const realFallbacks = new Map<string, unknown>();
  for (const id of DEFAULT_FALLBACK_ORDER) {
    try {
      realFallbacks.set(id, getModel(id));
    } catch {
      // provider not configured — the chain will report it as skipped
    }
  }

  const forced429 = {
    specificationVersion: "v4",
    provider: "test",
    modelId: "forced-429",
    supportedUrls: {},
    doGenerate: async () => {
      throw new APICallError({
        message: "simulated rate limit",
        url: "https://example.invalid/v1/models",
        requestBodyValues: {},
        statusCode: 429,
        responseHeaders: {},
        responseBody: JSON.stringify({ error: { message: "simulated rate limit" } }),
        isRetryable: true,
      });
    },
    doStream: async () => {
      throw new Error("forced 429");
    },
  };

  const restore = __setModelFactoryForTests((entry) => {
    if (entry.id === DEFAULT_MODEL_ID) return forced429 as never;
    return (realFallbacks.get(entry.id) ?? { modelId: entry.id }) as never;
  });

  try {
    const { text, modelId, attempts } = await generateTextWithFallback({
      prompt: PROMPT,
      modelIds: [DEFAULT_MODEL_ID, ...DEFAULT_FALLBACK_ORDER],
      userId: process.env.ALLOWED_USER_ID,
      retriesPerModel: 0,
    });
    console.log(
      `✔ fell through to ${modelId} (${attempts.map((a) => `${a.modelId}:${a.outcome}`).join(" -> ")})`,
    );
    console.log(`  reply=${JSON.stringify(text.slice(0, 40))}`);
  } catch (error) {
    console.log(`✖ fallback failed: ${String(error).slice(0, 200)}`);
  } finally {
    restore();
  }

  console.log("\nRegistry:");
  for (const entry of MODEL_REGISTRY) {
    console.log(
      `  ${entry.id.padEnd(30)} ${entry.provider.padEnd(11)} tier=${entry.tier.padEnd(5)} privateOk=${String(entry.privateOk).padEnd(5)} ctx=${entry.contextWindow}`,
    );
  }
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
