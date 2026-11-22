export type PerfRunRow = {
  id: string;
  created_at: Date | string;
  tokens_used: number | null;
};

export type PerfUsageRow = {
  id: number | string;
  run_id: string | null;
  provider: string;
  model: string;
  status: string | null;
  input_tokens: number | null;
  output_tokens: number | null;
  latency_ms: number | null;
  created_at: Date | string;
};

export type PerfEventRow = {
  id: number | string;
  run_id: string;
  type: string;
  payload: Record<string, unknown> | null;
  created_at: Date | string;
};

export type NodeLatencySummary = {
  node: string;
  samples: number;
  p50Ms: number | null;
  p95Ms: number | null;
};

export type ProviderLatencySummary = {
  provider: string;
  model: string;
  calls: number;
  skipped: number;
  p50Ms: number | null;
  p95Ms: number | null;
  errorRatePct: number | null;
  rateLimitedRatePct: number | null;
  tokens: number;
};

export type PerfReport = {
  runs: number;
  usageRows: number;
  eventRows: number;
  nodeLatency: NodeLatencySummary[];
  providerLatency: ProviderLatencySummary[];
  averageLlmCallsPerRun: number | null;
  averageSuccessfulLlmCallsPerRun: number | null;
  averageProviderTokensPerRun: number | null;
  averageProviderTokensPerRunWithUsage: number | null;
  averagePersistedTokensPerRun: number | null;
  averageInngestStepsPerRun: number | null;
  runsWithInngestStepSamples: number;
};

/** Linear-interpolated percentile, rounded to one decimal place. */
export function percentile(values: number[], quantile: number): number | null {
  if (values.length === 0) return null;
  const sorted = [...values].sort((left, right) => left - right);
  const position = (sorted.length - 1) * Math.min(1, Math.max(0, quantile));
  const lower = Math.floor(position);
  const upper = Math.ceil(position);
  if (lower === upper) return roundOne(sorted[lower]);
  const weight = position - lower;
  return roundOne(sorted[lower] * (1 - weight) + sorted[upper] * weight);
}

export function buildPerfReport(input: {
  runs: PerfRunRow[];
  usage: PerfUsageRow[];
  events: PerfEventRow[];
}): PerfReport {
  const nodeDurations = collectNodeDurations(input.events);
  const providerLatency = collectProviderLatency(input.usage);
  const runMetrics = collectRunMetrics(input.runs, input.usage, input.events);

  return {
    runs: input.runs.length,
    usageRows: input.usage.length,
    eventRows: input.events.length,
    nodeLatency: [...nodeDurations.entries()]
      .map(([node, durations]) => ({
        node,
        samples: durations.length,
        p50Ms: percentile(durations, 0.5),
        p95Ms: percentile(durations, 0.95),
      }))
      .sort((left, right) => left.node.localeCompare(right.node)),
    providerLatency: [...providerLatency.values()].sort((left, right) =>
      `${left.provider}:${left.model}`.localeCompare(`${right.provider}:${right.model}`),
    ),
    ...runMetrics,
  };
}

function collectNodeDurations(events: PerfEventRow[]): Map<string, number[]> {
  const durations = new Map<string, number[]>();
  const perfSampleKeys = new Set<string>();
  const ordered = [...events].sort((left, right) => eventTime(left) - eventTime(right));

  // New trace rows carry exact monotonic durations.
  for (const event of ordered) {
    if (event.type !== "perf") continue;
    const payload = event.payload ?? {};
    if (payload.kind !== "node") continue;
    const node = stringValue(payload.name);
    const duration = numberValue(payload.duration_ms);
    if (!node || duration === null || duration < 0) continue;
    addDuration(durations, node, duration);
    perfSampleKeys.add(`${event.run_id}::${node}`);
  }

  // Existing timelines can still be paired to produce a pre-instrumentation
  // baseline. Runs with exact perf rows are not counted twice.
  const starts = new Map<string, Map<string, number[]>>();
  for (const event of ordered) {
    if (event.type !== "node_start" && event.type !== "node_end") continue;
    const payload = event.payload ?? {};
    const node = stringValue(payload.node);
    if (!node) continue;

    const runStarts = starts.get(event.run_id) ?? new Map<string, number[]>();
    starts.set(event.run_id, runStarts);
    const nodeStarts = runStarts.get(node) ?? [];

    if (event.type === "node_start") {
      nodeStarts.push(eventTime(event));
      runStarts.set(node, nodeStarts);
      continue;
    }

    if (perfSampleKeys.has(`${event.run_id}::${node}`)) continue;
    const startedAt = nodeStarts.pop();
    runStarts.set(node, nodeStarts);
    if (startedAt === undefined) continue;
    const duration = eventTime(event) - startedAt;
    if (duration >= 0) addDuration(durations, node, duration);
  }

  return durations;
}

function collectProviderLatency(usage: PerfUsageRow[]): Map<string, ProviderLatencySummary> {
  const summaries = new Map<
    string,
    {
      provider: string;
      model: string;
      calls: number;
      skipped: number;
      errors: number;
      rateLimited: number;
      tokens: number;
      latencies: number[];
    }
  >();

  for (const row of usage) {
    const key = `${row.provider}:${row.model}`;
    const summary = summaries.get(key) ?? {
      provider: row.provider,
      model: row.model,
      calls: 0,
      skipped: 0,
      errors: 0,
      rateLimited: 0,
      tokens: 0,
      latencies: [],
    };

    if (row.status === "skipped") {
      summary.skipped += 1;
    } else {
      summary.calls += 1;
      if (row.status === "error") summary.errors += 1;
      if (row.status === "rate_limited") summary.rateLimited += 1;
      if (row.latency_ms !== null && row.latency_ms >= 0) {
        summary.latencies.push(row.latency_ms);
      }
    }

    summary.tokens += Math.max(0, row.input_tokens ?? 0) + Math.max(0, row.output_tokens ?? 0);
    summaries.set(key, summary);
  }

  return new Map(
    [...summaries.entries()].map(([key, summary]) => [
      key,
      {
        provider: summary.provider,
        model: summary.model,
        calls: summary.calls,
        skipped: summary.skipped,
        p50Ms: percentile(summary.latencies, 0.5),
        p95Ms: percentile(summary.latencies, 0.95),
        errorRatePct: percentage(summary.errors, summary.calls),
        rateLimitedRatePct: percentage(summary.rateLimited, summary.calls),
        tokens: summary.tokens,
      },
    ]),
  );
}

function collectRunMetrics(
  runs: PerfRunRow[],
  usage: PerfUsageRow[],
  events: PerfEventRow[],
): Pick<
  PerfReport,
  | "averageLlmCallsPerRun"
  | "averageSuccessfulLlmCallsPerRun"
  | "averageProviderTokensPerRun"
  | "averageProviderTokensPerRunWithUsage"
  | "averagePersistedTokensPerRun"
  | "averageInngestStepsPerRun"
  | "runsWithInngestStepSamples"
> {
  const attemptsByRun = new Map<string, number>();
  const successfulByRun = new Map<string, number>();
  const tokensByRun = new Map<string, number>();

  for (const row of usage) {
    if (!row.run_id || row.status === "skipped") continue;
    attemptsByRun.set(row.run_id, (attemptsByRun.get(row.run_id) ?? 0) + 1);
    if (row.status === "ok") {
      successfulByRun.set(row.run_id, (successfulByRun.get(row.run_id) ?? 0) + 1);
    }
    const tokens = Math.max(0, row.input_tokens ?? 0) + Math.max(0, row.output_tokens ?? 0);
    tokensByRun.set(row.run_id, (tokensByRun.get(row.run_id) ?? 0) + tokens);
  }

  const stepsByRun = new Map<string, number>();
  for (const event of events) {
    if (event.type !== "perf") continue;
    const payload = event.payload ?? {};
    if (payload.kind !== "inngest_step") continue;
    stepsByRun.set(event.run_id, (stepsByRun.get(event.run_id) ?? 0) + 1);
  }

  const runCount = runs.length;
  const totalAttempts = sum([...attemptsByRun.values()]);
  const totalSuccessful = sum([...successfulByRun.values()]);
  const totalProviderTokens = sum([...tokensByRun.values()]);
  const runsWithUsage = tokensByRun.size;
  const totalPersistedTokens = sum(runs.map((run) => Math.max(0, run.tokens_used ?? 0)));
  const totalSteps = sum([...stepsByRun.values()]);

  return {
    averageLlmCallsPerRun: runCount > 0 ? roundOne(totalAttempts / runCount) : null,
    averageSuccessfulLlmCallsPerRun: runCount > 0 ? roundOne(totalSuccessful / runCount) : null,
    averageProviderTokensPerRun: runCount > 0 ? roundOne(totalProviderTokens / runCount) : null,
    averageProviderTokensPerRunWithUsage:
      runsWithUsage > 0 ? roundOne(totalProviderTokens / runsWithUsage) : null,
    averagePersistedTokensPerRun:
      runCount > 0 ? roundOne(totalPersistedTokens / runCount) : null,
    averageInngestStepsPerRun:
      stepsByRun.size > 0 ? roundOne(totalSteps / stepsByRun.size) : null,
    runsWithInngestStepSamples: stepsByRun.size,
  };
}

function addDuration(durations: Map<string, number[]>, node: string, duration: number): void {
  const values = durations.get(node) ?? [];
  values.push(duration);
  durations.set(node, values);
}

function eventTime(event: PerfEventRow): number {
  const value = event.created_at instanceof Date ? event.created_at.getTime() : Date.parse(event.created_at);
  return Number.isFinite(value) ? value : 0;
}

function stringValue(value: unknown): string | null {
  return typeof value === "string" && value.length > 0 ? value : null;
}

function numberValue(value: unknown): number | null {
  return typeof value === "number" && Number.isFinite(value) ? value : null;
}

function percentage(count: number | null, total: number): number | null {
  if (count === null || total === 0) return null;
  return roundOne((count / total) * 100);
}

function sum(values: number[]): number {
  return values.reduce((total, value) => total + value, 0);
}

function roundOne(value: number): number {
  return Math.round(value * 10) / 10;
}
