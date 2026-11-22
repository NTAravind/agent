#!/usr/bin/env node
/**
 * End-to-end setup verification.
 *
 *   node scripts/verify-setup.mjs            # uses apps/api/.env.local
 *   node scripts/verify-setup.mjs --remote   # also checks the deployed API
 *
 * Reads only gitignored local env files. Never prints secret values.
 */
import { readFileSync, existsSync } from "node:fs";
import { join } from "node:path";

const root = new URL("..", import.meta.url).pathname;
const remote = process.argv.includes("--remote");

function readEnvFile(path) {
  if (!existsSync(path)) return {};
  const out = {};
  for (const line of readFileSync(path, "utf8").split("\n")) {
    const match = /^\s*([A-Z0-9_]+)\s*=\s*(.*)\s*$/.exec(line);
    if (!match) continue;
    out[match[1]] = match[2].replace(/^["']|["']$/g, "");
  }
  return out;
}

const env = { ...readEnvFile(join(root, "apps/api/.env.local")) };
const mobile = readEnvFile(join(root, "apps/mobile/.env"));
Object.assign(env, mobile);

const results = [];
const ok = (name, detail = "") => results.push({ pass: true, name, detail });
const fail = (name, detail = "") => results.push({ pass: false, name, detail });

const placeholder = (v) =>
  !v || v.includes("YOUR_") || v.includes("your-") || v.includes("00000000-0000-0000-0000-000000000000");

// 1. Env vars present
const required = [
  "SUPABASE_URL",
  "SUPABASE_ANON_KEY",
  "SUPABASE_SERVICE_ROLE_KEY",
  "INNGEST_EVENT_KEY",
  "INNGEST_SIGNING_KEY",
  "EXPO_PUBLIC_API_BASE_URL",
];
const missing = required.filter((name) => placeholder(env[name]));
if (missing.length === 0) ok("Env vars", "all required values present");
else fail("Env vars", `missing/placeholder: ${missing.join(", ")}`);

// 2. Supabase reachable + anon key valid
if (!placeholder(env.SUPABASE_URL) && !placeholder(env.SUPABASE_ANON_KEY)) {
  try {
    const res = await fetch(`${env.SUPABASE_URL}/auth/v1/health`, {
      headers: { apikey: env.SUPABASE_ANON_KEY },
    });
    if (res.ok) ok("Supabase", `auth health ${res.status}`);
    else fail("Supabase", `auth health returned ${res.status}`);
  } catch (err) {
    fail("Supabase", String(err));
  }
}

// 3. Service role key works + exactly one account exists
if (!placeholder(env.SUPABASE_SERVICE_ROLE_KEY) && !placeholder(env.SUPABASE_URL)) {
  try {
    const perPage = 100;
    const users = [];
    let page = 1;
    let listingError = null;
    while (true) {
      const res = await fetch(
        `${env.SUPABASE_URL}/auth/v1/admin/users?per_page=${perPage}&page=${page}`,
        {
          headers: {
            apikey: env.SUPABASE_SERVICE_ROLE_KEY,
            Authorization: `Bearer ${env.SUPABASE_SERVICE_ROLE_KEY}`,
          },
        },
      );
      const body = await res.json().catch(() => null);
      if (!res.ok) {
        listingError = `admin/users returned ${res.status}`;
        break;
      }
      const batch = Array.isArray(body?.users) ? body.users : [];
      users.push(...batch);
      if (batch.length < perPage) break;
      page += 1;
    }

    if (listingError) {
      fail("Service role key", listingError);
    } else if (users.length === 0) {
      fail("Single account", "no users in Supabase yet — create the first account through the app");
    } else if (users.length > 1) {
      fail("Single account", `expected one Supabase user, found ${users.length}`);
    } else {
      ok("Single account", "exactly one Supabase Auth user exists");
    }
  } catch (err) {
    fail("Service role key", String(err));
  }
}

// 4. Deployed API reachable and protected
if (remote && env.EXPO_PUBLIC_API_BASE_URL && !placeholder(env.EXPO_PUBLIC_API_BASE_URL)) {
  const base = env.EXPO_PUBLIC_API_BASE_URL.replace(/\/$/, "");
  try {
    const res = await fetch(`${base}/api/health`);
    if (res.status === 401) ok("Deployed API", "401 without token — protected as expected");
    else if (res.ok) fail("Deployed API", "200 without a token — route is NOT protected");
    else fail("Deployed API", `unexpected status ${res.status}`);
  } catch (err) {
    fail("Deployed API", String(err));
  }
}

// 5. Inngest endpoint reachable
if (remote && env.EXPO_PUBLIC_API_BASE_URL && !placeholder(env.EXPO_PUBLIC_API_BASE_URL)) {
  const base = env.EXPO_PUBLIC_API_BASE_URL.replace(/\/$/, "");
  try {
    const res = await fetch(`${base}/api/inngest`, {
      method: "PUT",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ eventName: "monitor/tick", eventData: { userId: "probe" } }),
    });
    if ([200, 400, 401, 403].includes(res.status)) {
      ok("Inngest endpoint", `responded ${res.status} (expected without a valid signature)`);
    } else {
      fail("Inngest endpoint", `unexpected status ${res.status}`);
    }
  } catch (err) {
    fail("Inngest endpoint", String(err));
  }
}

const width = Math.max(...results.map((r) => r.name.length));
for (const r of results) {
  console.log(`${r.pass ? "PASS" : "FAIL"}  ${r.name.padEnd(width)}  ${r.detail}`);
}
const failed = results.filter((r) => !r.pass).length;
console.log(`\n${results.length - failed}/${results.length} checks passed.`);
process.exit(failed > 0 ? 1 : 0);
