import { createClient, type SupabaseClient } from "@supabase/supabase-js";
import { requiredEnv } from "@/lib/env";
import { currentPerfScope, perfTraceEnabled, tracePerf } from "@/lib/perf";

let client: SupabaseClient | undefined;

/**
 * Service-role client. Bypasses RLS, so every query must filter by
 * `user_id` explicitly.
 */
export function supabaseAdmin(): SupabaseClient {
  if (!client) {
    client = createClient(
      requiredEnv("SUPABASE_URL"),
      requiredEnv("SUPABASE_SERVICE_ROLE_KEY"),
      {
        auth: { persistSession: false, autoRefreshToken: false },
        ...(perfTraceEnabled() ? { fetch: tracedFetch } : {}),
      },
    );
  }
  return client;
}

/**
 * Times the PostgREST request behind every Supabase query. The operation name
 * is only the table/RPC name: filters, row values and request bodies are never
 * logged.
 */
const tracedFetch: typeof fetch = async (input, init) => {
  const startedAt = performance.now();
  const operation = describeSupabaseOperation(input, init?.method);
  const scope = currentPerfScope();

  try {
    const response = await fetch(input, init);
    tracePerf({
      kind: "db_call",
      name: operation.name,
      duration_ms: Math.max(0, Math.round(performance.now() - startedAt)),
      status: response.ok ? "ok" : "error",
      run_id: scope?.runId ?? null,
      metadata: {
        method: operation.method,
        status_code: response.status,
        scope: scope?.kind ?? "global",
        step: scope?.step ?? null,
      },
    });
    return response;
  } catch (error) {
    tracePerf({
      kind: "db_call",
      name: operation.name,
      duration_ms: Math.max(0, Math.round(performance.now() - startedAt)),
      status: "error",
      run_id: scope?.runId ?? null,
      metadata: {
        method: operation.method,
        scope: scope?.kind ?? "global",
        step: scope?.step ?? null,
        error_type: error instanceof Error ? error.name : "unknown_error",
      },
    });
    throw error;
  }
};

function describeSupabaseOperation(
  input: RequestInfo | URL,
  method: string | undefined,
): { name: string; method: string } {
  const rawUrl =
    typeof input === "string"
      ? input
      : input instanceof URL
        ? input.toString()
        : input.url;
  const normalizedMethod = (method ?? "GET").toUpperCase();

  try {
    const url = new URL(rawUrl);
    const restMarker = "/rest/v1/";
    const restIndex = url.pathname.indexOf(restMarker);
    if (restIndex >= 0) {
      const remainder = url.pathname.slice(restIndex + restMarker.length);
      const [rawName = "unknown"] = remainder.split("/");
      const name = rawName === "rpc" ? `rpc:${remainder.split("/")[1] ?? "unknown"}` : rawName;
      return { name, method: normalizedMethod };
    }
    return { name: "supabase", method: normalizedMethod };
  } catch {
    return { name: "supabase", method: normalizedMethod };
  }
}
