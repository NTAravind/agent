/**
 * The provider layer. This is the only module in the app that may import a
 * provider package. Routes, graph nodes and Inngest functions must go through
 * these functions.
 */
export {
  MODEL_REGISTRY,
  DEFAULT_MODEL_ID,
  DEFAULT_FALLBACK_ORDER,
  FAST_MODEL_ID,
  findRegistryEntry,
  listRegistry,
} from "./registry";

export {
  getModel,
  resolveModel,
  isProviderConfigured,
  providersWithKeys,
  PROVIDER_ENV_KEYS,
  __setModelFactoryForTests,
  __resetProviderInstancesForTests,
} from "./resolver";

export {
  assertCapabilities,
  filterByCapabilities,
  missingCapabilities,
  supportsCapabilities,
} from "./capability";

export {
  withFallback,
  classifyError,
  type FallbackAttempt,
  type FallbackOptions,
  type FallbackResult,
  type TokenUsage,
} from "./fallback";

export { generateTextWithFallback, type GenerateWithFallbackOptions } from "./generate";

export { recordUsage, usageToday, type UsageRecord, type UsageStatus } from "./usage";

export {
  EMBEDDING_DIMENSIONS,
  EMBEDDING_MODEL_ID,
  embedTexts,
  getEmbeddingModel,
} from "./embeddings";

export {
  CapabilityError,
  ModelLayerError,
  ModelRegistryError,
  type ModelLayerErrorCode,
} from "./errors";
