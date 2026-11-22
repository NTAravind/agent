import { AsyncLocalStorage } from "node:async_hooks";

/**
 * Lightweight performance tracing for Phase 0.
 *
 * Tracing is completely inert unless PERF_TRACE=1. Events contain timings and
 * operational metadata only — never prompts, notes, memories, tool arguments,
 * URLs with query strings, tokens, or error messages.
 */
export type PerfTraceKind =
  | "node"
  | "model_attempt"
  | "inngest_step"
  | "db_call"
  | "embedding"
  | "web_tool"
  | "retrieval"
  | "chat_stage";

export type PerfTraceStatus = "ok" | "error";

export type PerfMetadataValue = string | number | boolean | null;

export type PerfTraceEvent = {
  kind: PerfTraceKind;
  name: string;
  duration_ms?: number;
  status?: PerfTraceStatus;
  run_id?: string | null;
  provider?: string | null;
  model?: string | null;
  attempt_id?: string | null;
  try_number?: number | null;
  outcome?: string | null;
  ttft_ms?: number | null;
  metadata?: Record<string, PerfMetadataValue>;
};

export type PerfScope = {
  kind: "chat" | "agent" | "inngest_step" | "background";
  runId?: string | null;
  step?: string | null;
};

export type PerfMeasureOptions = {
  runId?: string | null;
  provider?: string | null;
  model?: string | null;
  attemptId?: string | null;
  tryNumber?: number | null;
  outcome?: string | null;
  ttftMs?: number | null;
  metadata?: Record<string, PerfMetadataValue>;
  /** Optional persistence hook. Errors from the hook never affect the operation. */
  onComplete?: (event: PerfTraceEvent) => void | Promise<void>;
};

const scopeStorage = new AsyncLocalStorage<PerfScope>();

export function perfTraceEnabled(): boolean {
  return process.env.PERF_TRACE === "1";
}

/** Runs a callback with request/run context inherited by nested database calls. */
export function withPerfScope<T>(scope: PerfScope, callback: () => T): T {
  return scopeStorage.run(scope, callback);
}

export function currentPerfScope(): PerfScope | undefined {
  return scopeStorage.getStore();
}

/** Emits one structured JSON line. No output is produced while tracing is off. */
export function tracePerf(event: PerfTraceEvent): void {
  if (!perfTraceEnabled()) return;

  const scope = currentPerfScope();
  try {
    console.log(
      JSON.stringify({
        type: "perf_trace",
        timestamp: new Date().toISOString(),
        ...event,
        run_id: event.run_id === undefined ? (scope?.runId ?? null) : event.run_id,
      }),
    );
  } catch {
    // Telemetry must never affect product behavior.
  }
}

/**
 * Times an async operation and emits one trace event.
 *
 * The operation's return value and thrown errors are preserved exactly. Trace
 * persistence is best-effort and can never turn a successful operation into a
 * failure.
 */
export async function measurePerf<T>(
  kind: PerfTraceKind,
  name: string,
  operation: () => Promise<T> | T,
  options: PerfMeasureOptions = {},
): Promise<T> {
  if (!perfTraceEnabled()) return await operation();

  const startedAt = performance.now();
  try {
    const result = await operation();
    await completePerfTrace({
      kind,
      name,
      duration_ms: elapsedMs(startedAt),
      status: "ok",
      run_id: options.runId ?? currentPerfScope()?.runId ?? null,
      provider: options.provider ?? null,
      model: options.model ?? null,
      attempt_id: options.attemptId ?? null,
      try_number: options.tryNumber ?? null,
      outcome: options.outcome ?? "ok",
      ttft_ms: options.ttftMs ?? null,
      metadata: options.metadata,
    }, options.onComplete);
    return result;
  } catch (error) {
    await completePerfTrace({
      kind,
      name,
      duration_ms: elapsedMs(startedAt),
      status: "error",
      run_id: options.runId ?? currentPerfScope()?.runId ?? null,
      provider: options.provider ?? null,
      model: options.model ?? null,
      attempt_id: options.attemptId ?? null,
      try_number: options.tryNumber ?? null,
      outcome: options.outcome ?? "error",
      ttft_ms: options.ttftMs ?? null,
      metadata: {
        ...options.metadata,
        error_type: error instanceof Error ? error.name : "unknown_error",
      },
    }, options.onComplete);
    throw error;
  }
}

export function elapsedMs(startedAt: number): number {
  return Math.max(0, Math.round(performance.now() - startedAt));
}

async function completePerfTrace(
  event: PerfTraceEvent,
  onComplete: PerfMeasureOptions["onComplete"],
): Promise<void> {
  tracePerf(event);
  if (!onComplete) return;
  try {
    await onComplete(event);
  } catch {
    // Performance telemetry must never affect product behavior.
  }
}
