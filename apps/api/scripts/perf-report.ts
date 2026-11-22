#!/usr/bin/env node
/**
 * Phase 0 performance report.
 *
 * Reads only persisted run telemetry and provider usage. It never calls a
 * model, embedding, web-search, Tavily, Inngest, or other external service.
 *
 * Example:
 *   node --import tsx --env-file=.env.local scripts/perf-report.ts \
 *     --user-id <uuid> --since 30d
 */
import { Pool } from "pg";

import {
  buildPerfReport,
  type PerfEventRow,
  type PerfRunRow,
  type PerfUsageRow,
} from "../lib/perf-report";

type Options = {
  userId: string;
  since: Date;
  limit: number;
  json: boolean;
};

async function main(): Promise<void> {
  const options = parseOptions(process.argv.slice(2));
  const databaseUrl = process.env.DATABASE_URL;
  if (!databaseUrl) {
    throw new Error("DATABASE_URL is required. Load apps/api/.env.local before running this report.");
  }

  const pool = new Pool({ connectionString: databaseUrl });
  const client = await pool.connect();

  try {
    await client.query("set statement_timeout = '30s'");

    const runsResult = await client.query<PerfRunRow>(
      `select id, created_at, tokens_used
         from agent_runs
        where user_id = $1
          and created_at >= $2
        order by created_at desc
        limit $3`,
      [options.userId, options.since, options.limit],
    );

    const usageResult = await client.query<PerfUsageRow>(
      `select id, run_id, provider, model, status,
              input_tokens, output_tokens, latency_ms, created_at
         from provider_usage
        where user_id = $1
          and created_at >= $2
        order by created_at desc
        limit $3`,
      [options.userId, options.since, options.limit],
    );

    const eventsResult = await client.query<PerfEventRow>(
      `select re.id, re.run_id, re.type, re.payload, re.created_at
         from run_events re
         join agent_runs ar on ar.id = re.run_id
        where ar.user_id = $1
          and ar.created_at >= $2
          and re.created_at >= $2
        order by re.id asc
        limit $3`,
      [options.userId, options.since, options.limit],
    );

    const report = buildPerfReport({
      runs: runsResult.rows,
      usage: usageResult.rows,
      events: eventsResult.rows,
    });

    if (options.json) {
      console.log(
        JSON.stringify(
          {
            generatedAt: new Date().toISOString(),
            since: options.since.toISOString(),
            scope: "single-user",
            report,
          },
          null,
          2,
        ),
      );
      return;
    }

    printReport(report, options.since);
  } finally {
    client.release();
    await pool.end();
  }
}

function parseOptions(args: string[]): Options {
  let userId: string | undefined;
  let sinceValue = "30d";
  let limit = 100_000;
  let json = false;

  for (let index = 0; index < args.length; index += 1) {
    const arg = args[index];
    if (arg === "--user-id") userId = args[++index];
    else if (arg === "--since") sinceValue = args[++index];
    else if (arg === "--limit") limit = Number(args[++index]);
    else if (arg === "--json") json = true;
    else if (arg === "--help" || arg === "-h") {
      printHelp();
      process.exit(0);
    } else {
      throw new Error(`Unknown argument: ${arg}`);
    }
  }

  if (!userId) throw new Error("--user-id is required so every query remains user-scoped.");
  if (!/^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(userId)) {
    throw new Error("--user-id must be a UUID.");
  }
  if (!Number.isInteger(limit) || limit < 1 || limit > 1_000_000) {
    throw new Error("--limit must be an integer between 1 and 1000000.");
  }

  return { userId, since: parseSince(sinceValue), limit, json };
}

function parseSince(value: string): Date {
  const duration = /^(\d+)([dhm])$/.exec(value);
  if (duration) {
    const amount = Number(duration[1]);
    const unitMs = duration[2] === "d" ? 86_400_000 : duration[2] === "h" ? 3_600_000 : 60_000;
    return new Date(Date.now() - amount * unitMs);
  }

  const parsed = new Date(value);
  if (Number.isNaN(parsed.getTime())) {
    throw new Error("--since must be an ISO timestamp or a duration such as 30d, 12h, or 90m.");
  }
  return parsed;
}

function printReport(
  report: ReturnType<typeof buildPerfReport>,
  since: Date,
): void {
  console.log("Phase 0 performance report");
  console.log(`Window start: ${since.toISOString()}`);
  console.log(`Scope: one configured user (id omitted)`);
  console.log(
    `Rows: ${report.runs} runs, ${report.usageRows} usage, ${report.eventRows} events`,
  );

  console.log("\nNode latency (inclusive milliseconds)");
  console.log("node | samples | p50 ms | p95 ms");
  for (const row of report.nodeLatency) {
    console.log(`${row.node} | ${row.samples} | ${format(row.p50Ms)} | ${format(row.p95Ms)}`);
  }
  if (report.nodeLatency.length === 0) console.log("(no samples)");

  console.log("\nProvider/model latency");
  console.log("provider | model | calls | skipped | p50 ms | p95 ms | error % | 429 % | tokens");
  for (const row of report.providerLatency) {
    console.log(
      `${row.provider} | ${row.model} | ${row.calls} | ${row.skipped} | ${format(row.p50Ms)} | ${format(row.p95Ms)} | ${format(row.errorRatePct)} | ${format(row.rateLimitedRatePct)} | ${row.tokens}`,
    );
  }
  if (report.providerLatency.length === 0) console.log("(no samples)");

  console.log("\nPer-run metrics");
  console.log(`average LLM calls per run: ${format(report.averageLlmCallsPerRun)}`);
  console.log(`average successful LLM calls per run: ${format(report.averageSuccessfulLlmCallsPerRun)}`);
  console.log(`average provider tokens per run: ${format(report.averageProviderTokensPerRun)}`);
  console.log(
    `average provider tokens per run with usage: ${format(report.averageProviderTokensPerRunWithUsage)}`,
  );
  console.log(`average persisted tokens per run: ${format(report.averagePersistedTokensPerRun)}`);
  console.log(
    `average Inngest steps per traced run: ${format(report.averageInngestStepsPerRun)} (${report.runsWithInngestStepSamples} sampled runs)`,
  );
}

function format(value: number | null): string {
  return value === null ? "n/a" : String(value);
}

function printHelp(): void {
  console.log(`Usage: perf-report.ts --user-id <uuid> [--since 30d] [--limit 100000] [--json]`);
}

main().catch((error: unknown) => {
  console.error(error instanceof Error ? error.message : String(error));
  process.exitCode = 1;
});
