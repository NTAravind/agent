import { createGoogle } from "@ai-sdk/google";
import { createGroq } from "@ai-sdk/groq";
import { createMistral } from "@ai-sdk/mistral";
import { createDeepSeek } from "@ai-sdk/deepseek";
import { createHuggingFace } from "@ai-sdk/huggingface";
import { createCohere } from "@ai-sdk/cohere";
import { createOpenRouter } from "@openrouter/ai-sdk-provider";
import type { LanguageModel } from "ai";
import type { ModelRegistryEntry, Provider } from "@agent/shared";

import { optionalEnv } from "../env";
import { ModelRegistryError } from "./errors";
import { findRegistryEntry } from "./registry";

/** Env var that holds each provider's API key. */
export const PROVIDER_ENV_KEYS: Record<Provider, string> = {
  google: "GOOGLE_GENERATIVE_AI_API_KEY",
  groq: "GROQ_API_KEY",
  openrouter: "OPENROUTER_API_KEY",
  mistral: "MISTRAL_API_KEY",
  deepseek: "DEEPSEEK_API_KEY",
  huggingface: "HUGGINGFACE_API_KEY",
  cohere: "COHERE_API_KEY",
};

export function isProviderConfigured(provider: Provider): boolean {
  return Boolean(optionalEnv(PROVIDER_ENV_KEYS[provider]));
}

export function providersWithKeys(): Provider[] {
  return (Object.keys(PROVIDER_ENV_KEYS) as Provider[]).filter(isProviderConfigured);
}

type ProviderInstance = {
  google?: ReturnType<typeof createGoogle>;
  groq?: ReturnType<typeof createGroq>;
  openrouter?: ReturnType<typeof createOpenRouter>;
  mistral?: ReturnType<typeof createMistral>;
  deepseek?: ReturnType<typeof createDeepSeek>;
  huggingface?: ReturnType<typeof createHuggingFace>;
  cohere?: ReturnType<typeof createCohere>;
};

let instances: ProviderInstance = {};

function providerInstances(): ProviderInstance {
  if (Object.keys(instances).length > 0) return instances;

  const googleKey = optionalEnv(PROVIDER_ENV_KEYS.google);
  const groqKey = optionalEnv(PROVIDER_ENV_KEYS.groq);
  const openRouterKey = optionalEnv(PROVIDER_ENV_KEYS.openrouter);
  const mistralKey = optionalEnv(PROVIDER_ENV_KEYS.mistral);
  const deepSeekKey = optionalEnv(PROVIDER_ENV_KEYS.deepseek);
  const huggingFaceKey = optionalEnv(PROVIDER_ENV_KEYS.huggingface);
  const cohereKey = optionalEnv(PROVIDER_ENV_KEYS.cohere);

  instances = {
    ...(googleKey ? { google: createGoogle({ apiKey: googleKey }) } : {}),
    ...(groqKey ? { groq: createGroq({ apiKey: groqKey }) } : {}),
    ...(openRouterKey ? { openrouter: createOpenRouter({ apiKey: openRouterKey }) } : {}),
    ...(mistralKey ? { mistral: createMistral({ apiKey: mistralKey }) } : {}),
    ...(deepSeekKey ? { deepseek: createDeepSeek({ apiKey: deepSeekKey }) } : {}),
    ...(huggingFaceKey ? { huggingface: createHuggingFace({ apiKey: huggingFaceKey }) } : {}),
    ...(cohereKey ? { cohere: createCohere({ apiKey: cohereKey }) } : {}),
  };

  return instances;
}

/** Returns the provider SDK instance, or raises the typed "no key" error. */
function requireProvider<K extends keyof ProviderInstance>(
  entry: ModelRegistryEntry,
  instance: ProviderInstance[K],
): NonNullable<ProviderInstance[K]> {
  if (!instance) {
    throw new ModelRegistryError(
      "provider_not_configured",
      `Missing ${PROVIDER_ENV_KEYS[entry.provider]}; model ${entry.id} is unavailable.`,
      { modelId: entry.id, provider: entry.provider },
    );
  }
  return instance;
}

/** Builds the provider SDK model for a registry entry. */
function buildModel(entry: ModelRegistryEntry): LanguageModel {
  const providers = providerInstances();

  switch (entry.provider) {
    case "google":
      return requireProvider<"google">(entry, providers.google)(entry.providerModelId);
    case "groq":
      return requireProvider<"groq">(entry, providers.groq)(entry.providerModelId);
    case "openrouter":
      return requireProvider<"openrouter">(entry, providers.openrouter).chat(entry.providerModelId);
    case "mistral":
      return requireProvider<"mistral">(entry, providers.mistral)(entry.providerModelId);
    case "deepseek":
      return requireProvider<"deepseek">(entry, providers.deepseek)(entry.providerModelId);
    case "huggingface":
      return requireProvider<"huggingface">(entry, providers.huggingface)(entry.providerModelId);
    case "cohere":
      return requireProvider<"cohere">(entry, providers.cohere)(entry.providerModelId);
  }
}

type ModelFactory = (entry: ModelRegistryEntry) => LanguageModel;

let modelFactory: ModelFactory = buildModel;

/**
 * Resolves a registry id ("provider:model-id") to an AI SDK language model.
 * Unknown ids and unconfigured providers raise typed errors — never a silent
 * fallback to some other model.
 */
export function getModel(id: string): LanguageModel {
  const entry = findRegistryEntry(id);
  if (!entry) {
    throw new ModelRegistryError("unknown_model", `Unknown model id: ${id}`, { modelId: id });
  }
  return modelFactory(entry);
}

/** Same as getModel, but also returns the registry entry. */
export function resolveModel(id: string): { entry: ModelRegistryEntry; model: LanguageModel } {
  const entry = findRegistryEntry(id);
  if (!entry) {
    throw new ModelRegistryError("unknown_model", `Unknown model id: ${id}`, { modelId: id });
  }
  return { entry, model: modelFactory(entry) };
}

/** Test hook: swap the model factory. Returns a restore function. */
export function __setModelFactoryForTests(factory: ModelFactory | null): () => void {
  const previous = modelFactory;
  if (factory) modelFactory = factory;
  else modelFactory = buildModel;
  return () => {
    modelFactory = previous;
  };
}

/** Test hook: forget cached provider instances (used after changing env). */
export function __resetProviderInstancesForTests(): void {
  instances = {};
}
