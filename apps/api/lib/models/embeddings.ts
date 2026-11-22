import { createGoogle } from "@ai-sdk/google";
import { embedMany, type EmbeddingModel } from "ai";

import { optionalEnv } from "../env";
import { measurePerf } from "@/lib/perf";
import { ModelRegistryError } from "./errors";

/**
 * Embeddings are pinned to one model and one dimension, independently of the
 * chat model, so that all vectors stay comparable.
 *
 * WARNING: changing the model or the dimension means re-embedding every note
 * chunk and memory. Do not change it casually.
 */
export const EMBEDDING_MODEL_ID = "gemini-embedding-001";
export const EMBEDDING_DIMENSIONS = 768;

let embeddingModel: EmbeddingModel | undefined;

export function getEmbeddingModel(): EmbeddingModel {
  if (!embeddingModel) {
    const apiKey = optionalEnv("GOOGLE_GENERATIVE_AI_API_KEY");
    if (!apiKey) {
      throw new ModelRegistryError(
        "provider_not_configured",
        "Missing GOOGLE_GENERATIVE_AI_API_KEY; embeddings are unavailable.",
        { provider: "google" },
      );
    }
    embeddingModel = createGoogle({ apiKey }).embedding(EMBEDDING_MODEL_ID);
  }
  return embeddingModel;
}

/** Embeds a batch of texts into 768-dimension vectors. */
export async function embedTexts(values: string[]): Promise<number[][]> {
  if (values.length === 0) return [];

  const { embeddings } = await measurePerf(
    "embedding",
    EMBEDDING_MODEL_ID,
    () =>
      embedMany({
        model: getEmbeddingModel(),
        values,
        providerOptions: {
          google: { outputDimensionality: EMBEDDING_DIMENSIONS },
        },
      }),
    {
      provider: "google",
      model: EMBEDDING_MODEL_ID,
      metadata: { batch_size: values.length, dimensions: EMBEDDING_DIMENSIONS },
    },
  );

  return embeddings;
}
