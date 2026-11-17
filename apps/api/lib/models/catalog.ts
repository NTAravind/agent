import type { ModelCapabilities, Provider } from "@agent/shared";

import { PROVIDER_ENV_KEYS } from "./resolver";
import { optionalEnv } from "../env";
import { supabaseAdmin } from "../supabase/server";
import { DEFAULT_MODEL_ID, listRegistry, registerRuntimeModel } from "./registry";

export type CatalogModel = {
  id: string;
  provider: Provider;
  providerModelId: string;
  label: string;
  capabilities: ModelCapabilities;
  contextWindow: number;
  privateOk: boolean;
  tier: "free" | "paid";
  mobileEnabled: boolean;
  fetchedAt: string | null;
};

const emptyCapabilities: ModelCapabilities = {
  tools: false, vision: false, structuredOutput: false, reasoning: false, pdf: false,
};

function dynamicAppId(provider: Provider, modelId: string) {
  return `${provider}:${modelId.replaceAll(":", "-")}`;
}

type ProviderModelRow = {
  provider: Provider;
  model_id: string;
  app_id: string;
  label: string;
  capabilities: ModelCapabilities;
  context_window: number | null;
  tier: "free" | "paid";
  mobile_enabled: boolean;
  fetched_at: string;
};

function asRecord(value: unknown): Record<string, unknown> {
  return value && typeof value === "object" ? value as Record<string, unknown> : {};
}

async function getProviderJson(url: string, headers: HeadersInit) {
  const response = await fetch(url, { headers, cache: "no-store", signal: AbortSignal.timeout(25_000) });
  if (!response.ok) throw new Error(`Provider model-list request failed (${response.status}).`);
  return asRecord(await response.json());
}

/** Gemini's models.list method is paginated with nextPageToken. */
async function listGoogleModels(apiKey: string) {
  const models: unknown[] = [];
  let pageToken: string | undefined;
  do {
    const url = new URL("https://generativelanguage.googleapis.com/v1beta/models");
    url.searchParams.set("pageSize", "1000");
    if (pageToken) url.searchParams.set("pageToken", pageToken);
    const page = await getProviderJson(url.toString(), { "x-goog-api-key": apiKey });
    if (Array.isArray(page.models)) models.push(...page.models);
    pageToken = typeof page.nextPageToken === "string" && page.nextPageToken ? page.nextPageToken : undefined;
  } while (pageToken);
  return models;
}

/** Groq exposes its catalog through the OpenAI-compatible models.list endpoint. */
async function listGroqModels(apiKey: string) {
  const body = await getProviderJson("https://api.groq.com/openai/v1/models", { authorization: `Bearer ${apiKey}` });
  return Array.isArray(body.data) ? body.data : [];
}

/** OpenRouter's models endpoint returns its current catalog in one response. */
async function listOpenRouterModels(apiKey: string) {
  const body = await getProviderJson("https://openrouter.ai/api/v1/models?output_modalities=text", { authorization: `Bearer ${apiKey}` });
  return Array.isArray(body.data) ? body.data : [];
}

function mapGoogle(data: unknown[]) {
  return data.flatMap((model) => {
    const item = asRecord(model);
    const modelId = String(item.name ?? "").replace(/^models\//, "");
    const supported = Array.isArray(item.supportedGenerationMethods) ? item.supportedGenerationMethods : [];
    if (!modelId || !supported.includes("generateContent")) return [];
    const known = listRegistry().find((entry) => entry.provider === "google" && entry.providerModelId === modelId);
    return [{ provider: "google" as const, modelId, id: known?.id ?? `google:${modelId}`, label: known?.label ?? String(item.displayName || modelId),
      contextWindow: Number(item.inputTokenLimit) || 32_768,
      capabilities: known?.capabilities ?? { ...emptyCapabilities, tools: true, structuredOutput: true },
      tier: "paid" as const, metadata: { description: String(item.description ?? ""), outputTokenLimit: item.outputTokenLimit ?? null } }];
  });
}

function mapGroq(data: unknown[]) {
  return data.flatMap((model) => {
    const item = asRecord(model);
    const modelId = String(item.id ?? "");
    if (!modelId || item.active === false) return [];
    const known = listRegistry().find((entry) => entry.provider === "groq" && entry.providerModelId === modelId);
    return [{ provider: "groq" as const, modelId, id: known?.id ?? `groq:${modelId}`, label: known?.label ?? modelId,
      contextWindow: Number(item.context_window) || known?.contextWindow || 32_768,
      capabilities: known?.capabilities ?? emptyCapabilities,
      tier: "paid" as const, metadata: { ownedBy: item.owned_by ?? null, active: item.active ?? null } }];
  });
}

function mapOpenRouter(data: unknown[]) {
  return data.flatMap((model) => {
    const item = asRecord(model);
    const modelId = String(item.id ?? "");
    const architecture = asRecord(item.architecture);
    const modalities = Array.isArray(architecture.input_modalities) ? architecture.input_modalities.map(String) : [];
    if (!modelId || !modalities.includes("text")) return [];
    const known = listRegistry().find((entry) => entry.provider === "openrouter" && entry.providerModelId === modelId);
    const params = Array.isArray(item.supported_parameters) ? item.supported_parameters.map(String) : [];
    const capabilities = known?.capabilities ?? {
      tools: params.includes("tools") || params.includes("tool_choice"),
      vision: modalities.includes("image"),
      structuredOutput: params.includes("response_format"),
      reasoning: params.includes("include_reasoning") || params.includes("reasoning"),
      pdf: modalities.includes("file"),
    };
    const pricing = asRecord(item.pricing);
    const free = Number(pricing.prompt ?? 1) === 0 && Number(pricing.completion ?? 1) === 0;
    return [{ provider: "openrouter" as const, modelId, id: known?.id ?? dynamicAppId("openrouter", modelId), label: known?.label ?? String(item.name || modelId),
      contextWindow: Number(item.context_length) || 32_768, capabilities,
      tier: free ? "free" as const : "paid" as const,
      metadata: { description: String(item.description ?? "").slice(0, 300), promptPrice: pricing.prompt ?? null, completionPrice: pricing.completion ?? null, modalities } }];
  });
}

export async function refreshProviderCatalog() {
  const keys: Record<Provider, string | undefined> = {
    google: optionalEnv(PROVIDER_ENV_KEYS.google), groq: optionalEnv(PROVIDER_ENV_KEYS.groq), openrouter: optionalEnv(PROVIDER_ENV_KEYS.openrouter),
  };
  const tasks = (Object.entries(keys) as [Provider, string | undefined][]).map(async ([provider, key]) => {
    if (!key) return { provider, count: 0, skipped: true };
    const providerModels = provider === "google" ? await listGoogleModels(key)
      : provider === "groq" ? await listGroqModels(key)
      : await listOpenRouterModels(key);
    const data = provider === "google" ? mapGoogle(providerModels)
      : provider === "groq" ? mapGroq(providerModels)
      : mapOpenRouter(providerModels);
    const now = new Date().toISOString();
    const { error } = await supabaseAdmin().from("provider_models").upsert(data.map((m) => ({
      provider: m.provider, model_id: m.modelId, app_id: m.id, label: m.label, capabilities: m.capabilities,
      context_window: m.contextWindow, tier: m.tier, metadata: m.metadata, fetched_at: now,
    })), { onConflict: "provider,model_id", ignoreDuplicates: false });
    if (error) throw new Error(`Could not save ${provider} model catalog: ${error.message}`);
    return { provider, count: data.length, skipped: false };
  });
  return await Promise.all(tasks);
}

export async function readProviderCatalog(): Promise<CatalogModel[]> {
  const { data, error } = await supabaseAdmin().from("provider_models")
    .select("provider,model_id,app_id,label,capabilities,context_window,tier,mobile_enabled,fetched_at")
    .order("provider").order("label").limit(5000);
  if (error) throw new Error(`Could not read provider catalog: ${error.message}`);
  return (data ?? []).map((row: ProviderModelRow) => ({
    id: row.app_id, provider: row.provider, providerModelId: row.model_id,
    label: row.label, capabilities: row.capabilities as ModelCapabilities,
    contextWindow: row.context_window ?? 32_768, privateOk: row.provider === "google",
    tier: row.tier, mobileEnabled: Boolean(row.mobile_enabled), fetchedAt: row.fetched_at,
  }));
}

export async function enabledModels() {
  const models = await readProviderCatalog();
  return models.filter((model) => model.mobileEnabled);
}

export async function defaultMobileModel(required: Partial<ModelCapabilities> = {}) {
  const candidates = (await enabledModels()).filter((model) => Boolean(optionalEnv(PROVIDER_ENV_KEYS[model.provider])) &&
    Object.entries(required).every(([capability, value]) => value !== true || model.capabilities[capability as keyof ModelCapabilities]));
  return candidates.find((model) => model.id === DEFAULT_MODEL_ID)?.id ?? candidates[0]?.id ?? null;
}

export async function primeMobileModel(id: string) {
  const { data, error } = await supabaseAdmin().from("provider_models")
    .select("provider,model_id,app_id,label,capabilities,context_window,tier,mobile_enabled")
    .eq("app_id", id).eq("mobile_enabled", true).maybeSingle();
  if (error || !data) return false;
  const row = data as Omit<ProviderModelRow, "fetched_at">;
  registerRuntimeModel({ id: row.app_id, provider: row.provider, providerModelId: row.model_id,
    label: row.label, capabilities: row.capabilities, contextWindow: row.context_window ?? 32_768,
    privateOk: row.provider === "google", tier: row.tier });
  return true;
}

export async function setMobileModels(models: Array<{ id: string; enabled: boolean }>) {
  for (const { id, enabled } of models) {
    if (!id.includes(":") || !/^[a-z]+:[a-zA-Z0-9._\-/]+$/.test(id)) throw new Error(`Invalid model id: ${id}`);
    const { data, error } = await supabaseAdmin().from("provider_models")
      .update({ mobile_enabled: enabled }).eq("app_id", id).select("app_id").maybeSingle();
    if (error) throw new Error(`Could not update mobile models: ${error.message}`);
    if (!data) throw new Error(`Model ${id} is not in the provider catalog. Refresh it first.`);
  }
}

export function providerKeyStatus() {
  return Object.fromEntries((Object.keys(PROVIDER_ENV_KEYS) as Provider[]).map((provider) => [provider, Boolean(optionalEnv(PROVIDER_ENV_KEYS[provider]))]));
}

export async function usageRecent(userId: string) {
  const start = new Date(Date.now() - 30 * 24 * 60 * 60 * 1000).toISOString();
  const { data, error } = await supabaseAdmin().from("provider_usage")
    .select("provider,model,status,input_tokens,output_tokens,created_at")
    .eq("user_id", userId).gte("created_at", start).limit(10_000);
  if (error) throw new Error(`Could not read provider usage: ${error.message}`);
  type UsageRow = { provider: Provider; model: string; status: string | null; input_tokens: number | null; output_tokens: number | null };
  const grouped = new Map<string, { provider: Provider; model: string; calls: number; errors: number; inputTokens: number; outputTokens: number }>();
  for (const row of (data ?? []) as UsageRow[]) {
    const key = `${row.provider}:${row.model}`;
    const item = grouped.get(key) ?? { provider: row.provider, model: row.model, calls: 0, errors: 0, inputTokens: 0, outputTokens: 0 };
    item.calls++; item.errors += row.status === "error" || row.status === "rate_limited" ? 1 : 0;
    item.inputTokens += row.input_tokens ?? 0; item.outputTokens += row.output_tokens ?? 0;
    grouped.set(key, item);
  }
  return [...grouped.values()].sort((a, b) => b.calls - a.calls);
}
