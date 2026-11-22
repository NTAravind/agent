#!/usr/bin/env node
/**
 * Reports which env vars are still missing.
 * Checks the shell env first, then apps/api/.env.local and apps/mobile/.env.
 * Never fails: a missing key is a setup step, not a broken checkout.
 */
import { readFileSync, existsSync } from "node:fs";
import { join } from "node:path";

const root = new URL("..", import.meta.url).pathname;

/** Server secrets — apps/api/.env.local + Vercel. */
const serverVars = [
  ["SUPABASE_URL", "apps/api"],
  ["SUPABASE_ANON_KEY", "apps/api"],
  ["SUPABASE_SERVICE_ROLE_KEY", "apps/api"],
  ["INNGEST_EVENT_KEY", "apps/api"],
  ["INNGEST_SIGNING_KEY", "apps/api"],
  ["GOOGLE_GENERATIVE_AI_API_KEY", "apps/api"],
  ["GROQ_API_KEY", "apps/api"],
  ["OPENROUTER_API_KEY", "apps/api"],
  ["MISTRAL_API_KEY", "apps/api"],
  ["DEEPSEEK_API_KEY", "apps/api"],
  ["HUGGINGFACE_API_KEY", "apps/api"],
  ["COHERE_API_KEY", "apps/api"],
];

/** Public client values — apps/mobile/.env. */
const clientVars = [
  ["EXPO_PUBLIC_API_BASE_URL", "apps/mobile"],
  ["EXPO_PUBLIC_SUPABASE_URL", "apps/mobile"],
  ["EXPO_PUBLIC_SUPABASE_ANON_KEY", "apps/mobile"],
];

function readEnvFile(path) {
  if (!existsSync(path)) return {};
  const out = {};
  for (const line of readFileSync(path, "utf8").split("\n")) {
    const match = /^\s*([A-Z0-9_]+)\s*=\s*(.*)\s*$/.exec(line);
    if (!match) continue;
    const [, key, value] = match;
    const isPlaceholder =
      value.includes("YOUR_") ||
      value.includes("your-") ||
      value.includes("00000000-0000-0000-0000-000000000000");
    if (value && !isPlaceholder) {
      out[key] = value;
    }
  }
  return out;
}

const files = {
  "apps/api": readEnvFile(join(root, "apps/api/.env.local")),
  "apps/mobile": readEnvFile(join(root, "apps/mobile/.env")),
};

function status(name, scope) {
  if (process.env[name]) return "shell";
  if (files[scope]?.[name]) return scope;
  return null;
}

const all = [
  ...serverVars.map(([name, scope]) => ({ name, scope, kind: "server" })),
  ...clientVars.map(([name, scope]) => ({ name, scope, kind: "client" })),
];

const missing = all.filter((v) => !status(v.name, v.scope));

if (missing.length === 0) {
  console.log("[check-env] All required env vars are set.");
  process.exit(0);
}

console.warn("\n[check-env] Missing env vars:");
for (const { name, scope, kind } of missing) {
  console.warn(`  - ${name.padEnd(28)} ${kind} → ${scope}/${scope === "apps/api" ? ".env.local" : ".env"}`);
}
console.warn("\n  Server values also belong in Vercel → Environment Variables.");
console.warn("  See docs/runbook-phase-0.md for where to get each one.\n");
