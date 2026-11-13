import type { Provider, ProviderUsage } from "@agent/shared";

import { supabaseAdmin } from "../supabase/server";

export type UsageStatus = "ok" | "rate_limited" | "error" | "skipped";

export type UsageRecord = {
  userId: string;
  provider: Provider;
  /** Registry id that was attempted. */
  model: string;
  runId?: string | null;
  status: UsageStatus;
  inputTokens?: number | null;
  outputTokens?: number | null;
  latencyMs?: number | null;
};

/**
 * Writes one row to provider_usage. Never throws: usage tracking must not
 * break a chat. If the migration has not been applied yet, the insert fails
 * silently (logged) until it is.
 */
export async function recordUsage(record: UsageRecord): Promise<void> {
  try {
    const { error } = await supabaseAdmin().from("provider_usage").insert({
      user_id: record.userId,
      provider: record.provider,
      model: record.model,
      run_id: record.runId ?? null,
      status: record.status,
      input_tokens: record.inputTokens ?? null,
      output_tokens: record.outputTokens ?? null,
      latency_ms: record.latencyMs ?? null,
    });
    if (error) {
      console.warn("[models/usage] could not record usage:", error.message);
    }
  } catch (error) {
    console.warn("[models/usage] could not record usage:", error);
  }
}

/** Usage for the current day, grouped by provider and model. */
export async function usageToday(userId: string): Promise<ProviderUsage[]> {
  const startOfDay = new Date();
  startOfDay.setUTCHours(0, 0, 0, 0);

  const { data, error } = await supabaseAdmin()
    .from("provider_usage")
    .select("provider, model, status, input_tokens, output_tokens")
    .eq("user_id", userId)
    .gte("created_at", startOfDay.toISOString())
    .limit(5000);

  if (error || !data) {
    if (error) console.warn("[models/usage] could not read usage:", error.message);
    return [];
  }

  const byKey = new Map<string, ProviderUsage>();
  for (const row of data as Array<{
    provider: Provider;
    model: string;
    status: UsageStatus;
    input_tokens: number | null;
    output_tokens: number | null;
  }>) {
    const key = `${row.provider}:${row.model}`;
    const current =
      byKey.get(key) ??
      {
        provider: row.provider,
        model: row.model,
        calls: 0,
        inputTokens: 0,
        outputTokens: 0,
        errors: 0,
      };

    current.calls += 1;
    current.inputTokens += row.input_tokens ?? 0;
    current.outputTokens += row.output_tokens ?? 0;
    if (row.status === "error" || row.status === "rate_limited") current.errors += 1;

    byKey.set(key, current);
  }

  return [...byKey.values()];
}
