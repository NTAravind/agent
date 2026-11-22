import { Pool } from "pg";

import { optionalEnv } from "@/lib/env";
import { currentPerfScope, perfTraceEnabled, tracePerf } from "@/lib/perf";

import { PostgresSaver } from "@langchain/langgraph-checkpoint-postgres";

/**
 * Postgres checkpointer for the agent graph (LangGraph state persistence).
 *
 * Uses the direct Postgres connection (DATABASE_URL — the Supabase pooler
 * URI). The pool and the saver are singletons per serverless instance; the
 * schema is created once with `setup()`.
 */

type CheckpointerHolder = {
  saver?: PostgresSaver;
  setupPromise?: Promise<PostgresSaver>;
};

// Survives hot reloads in dev and reuse across invocations on Vercel.
const globalForCheckpointer = globalThis as unknown as { __agentCheckpointer?: CheckpointerHolder };

const holder: CheckpointerHolder = (globalForCheckpointer.__agentCheckpointer ??= {});

export function isCheckpointerConfigured(): boolean {
  return Boolean(optionalEnv("DATABASE_URL"));
}

async function init(): Promise<PostgresSaver> {
  const url = optionalEnv("DATABASE_URL");
  if (!url) {
    throw new Error(
      "DATABASE_URL is not set — the agent checkpointer needs a direct Postgres connection (Supabase → Settings → Database → Connection string).",
    );
  }

  const pool = new Pool({
    connectionString: url,
    // The pooler URI already carries sslmode; this covers direct connections.
    ssl: url.includes("sslmode=") ? undefined : { rejectUnauthorized: false },
    max: 2,
  });
  if (perfTraceEnabled()) installCheckpointQueryTracing(pool);

  const saver = new PostgresSaver(pool);
  await saver.setup();
  return saver;
}

export async function getCheckpointer(): Promise<PostgresSaver | null> {
  if (!isCheckpointerConfigured()) return null;

  holder.setupPromise ??= init().catch((error) => {
    holder.setupPromise = undefined; // allow a later retry
    throw error;
  });

  return await holder.setupPromise;
}

/**
 * Times direct Postgres checkpoint queries. SQL text and bind values are never
 * logged; only a coarse operation label and timing are emitted.
 */
function installCheckpointQueryTracing(pool: Pool): void {
  pool.on("connect", (client) => {
    const originalQuery = client.query.bind(client) as (...args: unknown[]) => unknown;
    client.query = ((...args: unknown[]) => {
      const startedAt = performance.now();
      const operation = classifyCheckpointQuery(args[0]);
      const scope = currentPerfScope();
      let result: unknown;

      const callbackIndex = findCallbackIndex(args);
      if (callbackIndex >= 0) {
        const callback = args[callbackIndex] as (error: unknown, ...rest: unknown[]) => unknown;
        const tracedArgs = [...args];
        tracedArgs[callbackIndex] = (error: unknown, ...rest: unknown[]) => {
          traceCheckpointQuery(operation, startedAt, scope, error ?? undefined);
          return callback(error, ...rest);
        };
        try {
          return originalQuery(...tracedArgs);
        } catch (error) {
          traceCheckpointQuery(operation, startedAt, scope, error);
          throw error;
        }
      }

      try {
        result = originalQuery(...args);
      } catch (error) {
        traceCheckpointQuery(operation, startedAt, scope, error);
        throw error;
      }

      if (!isPromiseLike(result)) return result;
      return result.then(
        (value) => {
          traceCheckpointQuery(operation, startedAt, scope);
          return value;
        },
        (error: unknown) => {
          traceCheckpointQuery(operation, startedAt, scope, error);
          throw error;
        },
      );
    }) as unknown as typeof client.query;
  });
}

function traceCheckpointQuery(
  operation: string,
  startedAt: number,
  scope: ReturnType<typeof currentPerfScope>,
  error?: unknown,
): void {
  tracePerf({
    kind: "db_call",
    name: `checkpoint:${operation}`,
    duration_ms: Math.max(0, Math.round(performance.now() - startedAt)),
    status: error ? "error" : "ok",
    run_id: scope?.runId ?? null,
    metadata: {
      method: "SQL",
      scope: scope?.kind ?? "global",
      step: scope?.step ?? null,
      ...(error
        ? { error_type: error instanceof Error ? error.name : "unknown_error" }
        : {}),
    },
  });
}

function classifyCheckpointQuery(query: unknown): string {
  const text =
    typeof query === "string"
      ? query
      : query && typeof query === "object" && "text" in query
        ? String((query as { text?: unknown }).text ?? "")
        : "";
  const normalized = text.trim().toLowerCase();

  if (normalized.includes("checkpoint_blobs")) return "blobs";
  if (normalized.includes("checkpoint_writes")) return "writes";
  if (normalized.includes("checkpoints")) return "checkpoints";
  if (normalized.includes("checkpoint_migrations")) return "migrations";
  if (normalized.startsWith("select")) return "select";
  if (normalized.startsWith("insert")) return "insert";
  if (normalized.startsWith("update")) return "update";
  if (normalized.startsWith("delete")) return "delete";
  return "other";
}

function findCallbackIndex(args: unknown[]): number {
  for (let index = args.length - 1; index >= 0; index -= 1) {
    if (typeof args[index] === "function") return index;
  }
  return -1;
}

function isPromiseLike(value: unknown): value is PromiseLike<unknown> {
  return Boolean(
    value &&
      typeof value === "object" &&
      "then" in value &&
      typeof (value as { then?: unknown }).then === "function",
  );
}
