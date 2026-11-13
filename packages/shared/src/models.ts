import { z } from "zod";

/** Providers that may appear in a registry model id ("provider:modelId"). */
export const PROVIDERS = ["google", "groq", "openrouter"] as const;
export type Provider = (typeof PROVIDERS)[number];

/**
 * Registry ids look like "google:gemini-3.8-flash". The provider part is the
 * prefix before the first colon; the rest is the provider-specific model id.
 */
export const ModelIdSchema = z
  .string()
  .min(3)
  .regex(/^[a-z]+:[a-zA-Z0-9._\-/]+$/, "Model id must look like 'provider:model-id'");

export type ModelId = string;

/** Capabilities a request can need from a model. */
export const MODEL_CAPABILITIES = [
  "tools",
  "vision",
  "structuredOutput",
  "reasoning",
  "pdf",
] as const;

export type ModelCapability = (typeof MODEL_CAPABILITIES)[number];

export const ModelCapabilitiesSchema = z.object({
  tools: z.boolean(),
  vision: z.boolean(),
  structuredOutput: z.boolean(),
  reasoning: z.boolean(),
  pdf: z.boolean(),
});

export type ModelCapabilities = z.infer<typeof ModelCapabilitiesSchema>;

/** What a single request needs. Only `true` entries are requirements. */
export const RequiredCapabilitiesSchema = z.object({
  tools: z.boolean().optional(),
  vision: z.boolean().optional(),
  structuredOutput: z.boolean().optional(),
  reasoning: z.boolean().optional(),
  pdf: z.boolean().optional(),
});

export type RequiredCapabilities = z.infer<typeof RequiredCapabilitiesSchema>;

/** A registry entry, before the server decides whether its provider is usable. */
export const ModelRegistryEntrySchema = z.object({
  id: ModelIdSchema,
  provider: z.enum(PROVIDERS),
  providerModelId: z.string(),
  label: z.string(),
  capabilities: ModelCapabilitiesSchema,
  contextWindow: z.number().int().positive(),
  /** Safe to receive note- or memory-derived context. */
  privateOk: z.boolean(),
  tier: z.enum(["free", "paid"]),
});

export type ModelRegistryEntry = z.infer<typeof ModelRegistryEntrySchema>;

/** A registry entry plus the server-side availability of its provider. */
export const ModelInfoSchema = ModelRegistryEntrySchema.extend({
  /** Whether an API key for this provider is configured on the server. */
  available: z.boolean(),
});

export type ModelInfo = z.infer<typeof ModelInfoSchema>;

export const ProviderUsageSchema = z.object({
  provider: z.enum(PROVIDERS),
  model: z.string(),
  calls: z.number().int().nonnegative(),
  inputTokens: z.number().int().nonnegative(),
  outputTokens: z.number().int().nonnegative(),
  errors: z.number().int().nonnegative(),
});

export type ProviderUsage = z.infer<typeof ProviderUsageSchema>;

export const ModelsResponseSchema = z.object({
  models: z.array(ModelInfoSchema),
  /** Providers whose API key is present on the server. */
  providersWithKeys: z.array(z.enum(PROVIDERS)),
  defaultModel: ModelIdSchema,
  fallbackOrder: z.array(ModelIdSchema),
  usageToday: z.array(ProviderUsageSchema),
});

export type ModelsResponse = z.infer<typeof ModelsResponseSchema>;

export function providerOf(modelId: string): Provider | null {
  const prefix = modelId.split(":")[0];
  return (PROVIDERS as readonly string[]).includes(prefix) ? (prefix as Provider) : null;
}
