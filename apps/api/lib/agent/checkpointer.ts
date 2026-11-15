import { Pool } from "pg";

import { optionalEnv } from "@/lib/env";

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
