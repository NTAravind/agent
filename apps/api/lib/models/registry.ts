import type { ModelRegistryEntry } from "@agent/shared";

/**
 * The model registry. One entry per model the app may call.
 *
 * Ids are stable app-level ids ("provider:model-id"); `providerModelId` is the
 * id the provider itself expects. Model lineups change often, so this file is
 * the single place to update when a model is renamed or retired.
 *
 * `privateOk` decides whether note- or memory-derived context may be sent to
 * the model. It is true for Google only: the other providers' free tiers (or
 * free grants) permit logging/training of prompts (see ARCHITECTURE.md
 * section 4).
 */
export const MODEL_REGISTRY: readonly ModelRegistryEntry[] = [
  {
    id: "google:gemini-3.8-flash",
    provider: "google",
    providerModelId: "gemini-3.8-flash",
    label: "Gemini 3.8 Flash",
    capabilities: {
      tools: true,
      vision: true,
      structuredOutput: true,
      reasoning: true,
      pdf: true,
    },
    contextWindow: 1_048_576,
    privateOk: true,
    tier: "free",
  },
  {
    id: "google:gemini-3.6-flash",
    provider: "google",
    providerModelId: "gemini-3.6-flash",
    label: "Gemini 3.6 Flash",
    capabilities: {
      tools: true,
      vision: true,
      structuredOutput: true,
      reasoning: true,
      pdf: true,
    },
    contextWindow: 1_048_576,
    privateOk: true,
    tier: "free",
  },
  {
    id: "google:gemini-3.5-flash-lite",
    provider: "google",
    providerModelId: "gemini-3.5-flash-lite",
    label: "Gemini 3.5 Flash Lite",
    capabilities: {
      tools: true,
      vision: true,
      structuredOutput: true,
      reasoning: false,
      pdf: true,
    },
    contextWindow: 1_048_576,
    privateOk: true,
    tier: "free",
  },
  {
    id: "google:gemini-4-argon",
    provider: "google",
    providerModelId: "gemini-4-argon",
    label: "Gemini 4 Argon (paid)",
    capabilities: {
      tools: true,
      vision: true,
      structuredOutput: true,
      reasoning: true,
      pdf: true,
    },
    contextWindow: 1_048_576,
    privateOk: true,
    tier: "paid",
  },
  {
    id: "groq:gpt-oss-120b",
    provider: "groq",
    providerModelId: "openai/gpt-oss-120b",
    label: "GPT-OSS 120B (Groq)",
    capabilities: {
      tools: true,
      vision: false,
      structuredOutput: true,
      reasoning: true,
      pdf: false,
    },
    contextWindow: 131_072,
    privateOk: false,
    tier: "free",
  },
  {
    id: "groq:gpt-oss-20b",
    provider: "groq",
    providerModelId: "openai/gpt-oss-20b",
    label: "GPT-OSS 20B (Groq)",
    capabilities: {
      tools: true,
      vision: false,
      structuredOutput: true,
      reasoning: true,
      pdf: false,
    },
    contextWindow: 131_072,
    privateOk: false,
    tier: "free",
  },
  {
    id: "groq:qwen3.8-27b",
    provider: "groq",
    providerModelId: "qwen/qwen3.8-27b",
    label: "Qwen 3.8 27B (Groq)",
    capabilities: {
      tools: true,
      vision: true,
      structuredOutput: true,
      reasoning: true,
      pdf: false,
    },
    contextWindow: 131_042,
    privateOk: false,
    tier: "free",
  },
  {
    id: "openrouter:gemini-3.8-flash",
    provider: "openrouter",
    providerModelId: "google/gemini-3.8-flash",
    label: "Gemini 3.8 Flash (OpenRouter)",
    capabilities: {
      tools: true,
      vision: true,
      structuredOutput: true,
      reasoning: true,
      pdf: true,
    },
    contextWindow: 1_048_576,
    privateOk: false,
    tier: "free",
  },
  {
    id: "openrouter:qwen3.8-27b",
    provider: "openrouter",
    providerModelId: "qwen/qwen3.8-27b:free",
    label: "Qwen 3.8 27B free (OpenRouter)",
    capabilities: {
      tools: true,
      vision: true,
      structuredOutput: true,
      reasoning: true,
      pdf: false,
    },
    contextWindow: 131_042,
    privateOk: false,
    tier: "free",
  },
  {
    id: "mistral:mistral-large-latest",
    provider: "mistral",
    providerModelId: "mistral-large-latest",
    label: "Mistral Large",
    capabilities: {
      tools: true,
      vision: false,
      structuredOutput: true,
      reasoning: false,
      pdf: false,
    },
    contextWindow: 131_072,
    privateOk: false,
    tier: "paid",
  },
  {
    id: "mistral:mistral-small-latest",
    provider: "mistral",
    providerModelId: "mistral-small-latest",
    label: "Mistral Small",
    capabilities: {
      tools: true,
      vision: false,
      structuredOutput: true,
      reasoning: false,
      pdf: false,
    },
    contextWindow: 131_072,
    privateOk: false,
    tier: "paid",
  },
  {
    id: "mistral:open-mistral-nemo",
    provider: "mistral",
    providerModelId: "open-mistral-nemo",
    label: "Mistral Nemo",
    capabilities: {
      tools: true,
      vision: false,
      structuredOutput: true,
      reasoning: false,
      pdf: false,
    },
    contextWindow: 131_072,
    privateOk: false,
    tier: "paid",
  },
  {
    // Pay-as-you-go after the one-time free grant.
    id: "deepseek:deepseek-chat",
    provider: "deepseek",
    providerModelId: "deepseek-chat",
    label: "DeepSeek Chat",
    capabilities: {
      tools: true,
      vision: false,
      structuredOutput: true,
      reasoning: false,
      pdf: false,
    },
    contextWindow: 131_072,
    privateOk: false,
    tier: "paid",
  },
  {
    // No tool calling / JSON mode on the reasoner; thinking model.
    id: "deepseek:deepseek-reasoner",
    provider: "deepseek",
    providerModelId: "deepseek-reasoner",
    label: "DeepSeek Reasoner",
    capabilities: {
      tools: false,
      vision: false,
      structuredOutput: false,
      reasoning: true,
      pdf: false,
    },
    contextWindow: 65_536,
    privateOk: false,
    tier: "paid",
  },
  {
    // Free trial keys are for non-commercial use only (see TECH_STACK.md).
    id: "cohere:command-a-03-2025",
    provider: "cohere",
    providerModelId: "command-a-03-2025",
    label: "Command A",
    capabilities: {
      tools: true,
      vision: false,
      structuredOutput: true,
      reasoning: false,
      pdf: false,
    },
    contextWindow: 256_000,
    privateOk: false,
    tier: "free",
  },
  {
    id: "cohere:command-r-plus",
    provider: "cohere",
    providerModelId: "command-r-plus",
    label: "Command R+",
    capabilities: {
      tools: true,
      vision: false,
      structuredOutput: true,
      reasoning: false,
      pdf: false,
    },
    contextWindow: 131_072,
    privateOk: false,
    tier: "free",
  },
  {
    // Routed through router.huggingface.co; billing follows the chosen
    // upstream provider (tiny monthly free allowance on new accounts).
    id: "huggingface:meta-llama/Llama-3.3-70B-Instruct",
    provider: "huggingface",
    providerModelId: "meta-llama/Llama-3.3-70B-Instruct",
    label: "Llama 3.3 70B (Hugging Face)",
    capabilities: {
      tools: true,
      vision: false,
      structuredOutput: true,
      reasoning: false,
      pdf: false,
    },
    contextWindow: 131_072,
    privateOk: false,
    tier: "paid",
  },
  {
    id: "huggingface:Qwen/Qwen3.8-27B",
    provider: "huggingface",
    providerModelId: "Qwen/Qwen3.8-27B",
    label: "Qwen 3.8 27B (Hugging Face)",
    capabilities: {
      tools: true,
      vision: true,
      structuredOutput: true,
      reasoning: false,
      pdf: false,
    },
    contextWindow: 262_144,
    privateOk: false,
    tier: "paid",
  },
] as const;

/**
 * Chat/agent default.
 *
 * Note (2026-11-13): gemini-3.8-flash answers "503 high demand" on the free
 * tier right now, so the default is gemini-3.6-flash and 3.8-flash sits in the
 * fallback chain until Google's capacity recovers. Flip this back once 3.8 is
 * reliable.
 */
export const DEFAULT_MODEL_ID = "google:gemini-3.6-flash";

/**
 * Used when the default model fails (429 / 5xx / timeout).
 * Groq comes first because it answers in under a second; gemini-3.8-flash is
 * next while Google is capacity-limited; OpenRouter is the last resort.
 */
export const DEFAULT_FALLBACK_ORDER: readonly string[] = [
  "groq:gpt-oss-120b",
  "google:gemini-3.8-flash",
  "openrouter:gemini-3.8-flash",
];

/** Cheap-and-fast model for routing, summaries and other short steps. */
export const FAST_MODEL_ID = "google:gemini-3.5-flash-lite";

const BY_ID = new Map(MODEL_REGISTRY.map((entry) => [entry.id, entry]));

/** Dynamic provider models are primed from the persisted catalog per request. */
export function registerRuntimeModel(entry: ModelRegistryEntry): void {
  BY_ID.set(entry.id, entry);
}

export function findRegistryEntry(id: string): ModelRegistryEntry | undefined {
  return BY_ID.get(id);
}

export function listRegistry(): ModelRegistryEntry[] {
  return [...MODEL_REGISTRY];
}
