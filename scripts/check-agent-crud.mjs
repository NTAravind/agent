#!/usr/bin/env node
/**
 * End-to-end check of Phase 7 slice A (agent CRUD) against a running API.
 *
 *   node scripts/check-agent-crud.mjs [baseUrl]
 *
 * Verifies: list shape (avatar object, toolCount, fallbackModels), create with
 * full fields, patch (including ""-clears and model validation: unknown ids,
 * primary repeated in fallbacks), delete + 404, and that the default agent
 * survives. Requires the 0010 migration (agents.model default dropped).
 */
import { readFileSync } from "node:fs";

const base = process.argv[2] ?? "http://localhost:3000";
const emails = process.env.ALLOWED_USER_EMAIL
  ? [process.env.ALLOWED_USER_EMAIL]
  : ["ntaravindnarayanan7@gmail.com", "ntaravindnarayanan01@gmail.com"];

function readEnv(path) {
  const env = {};
  for (const line of readFileSync(path, "utf8").split("\n")) {
    const match = /^\s*([A-Z0-9_]+)\s*=\s*(.*)\s*$/.exec(line);
    if (match) env[match[1]] = match[2];
  }
  return env;
}
const env = readEnv("apps/api/.env.local");

async function mintToken(email) {
  const link = await fetch(`${env.SUPABASE_URL}/auth/v1/admin/generate_link`, {
    method: "POST",
    headers: {
      apikey: env.SUPABASE_SERVICE_ROLE_KEY,
      Authorization: `Bearer ${env.SUPABASE_SERVICE_ROLE_KEY}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({ type: "magiclink", email }),
  }).then((r) => r.json());
  const session = await fetch(`${env.SUPABASE_URL}/auth/v1/verify`, {
    method: "POST",
    headers: { apikey: env.SUPABASE_ANON_KEY, "Content-Type": "application/json" },
    body: JSON.stringify({
      type: "magiclink",
      token_hash: link.hashed_token ?? link.properties?.hashed_token,
    }),
  }).then((r) => r.json());
  if (!session.access_token) throw new Error(`Could not mint a session: ${JSON.stringify(session)}`);
  return session.access_token;
}

// The single-user allowlist differs between local and deployed environments;
// probe with each known account and use whichever one the API accepts.
async function mintWorkingToken() {
  for (const email of emails) {
    const candidate = await mintToken(email);
    const probe = await fetch(`${base}/api/agents`, {
      headers: { Authorization: `Bearer ${candidate}` },
    });
    if (probe.status === 200) return candidate;
    console.log(`note: ${email} not accepted here (HTTP ${probe.status})`);
  }
  throw new Error(`No allowlisted account accepted by ${base}.`);
}

const token = await mintWorkingToken();
const headers = { Authorization: `Bearer ${token}`, "Content-Type": "application/json" };

async function call(path, init) {
  const res = await fetch(`${base}${path}`, { ...init, headers });
  const text = await res.text();
  let body;
  try { body = JSON.parse(text); } catch { body = text; }
  return { status: res.status, body };
}

const checks = [];
const check = (name, pass, detail = "") => {
  checks.push(pass);
  console.log(`${pass ? "PASS" : "FAIL"}  ${name}${detail ? `  (${detail})` : ""}`);
};

const suffix = Date.now().toString(36);
let createdId = null;

try {
  // 1. List shape.
  const list = await call("/api/agents");
  const agents = list.body?.agents ?? [];
  const first = agents[0];
  check(
    "GET /api/agents returns full agent objects",
    list.status === 200 &&
      agents.length > 0 &&
      !!first &&
      "avatar" in first &&
      typeof first.avatar?.type === "string" &&
      "toolCount" in first &&
      "fallbackModels" in first &&
      "instructions" in first,
    `status=${list.status} agents=${agents.length}`,
  );

  // 2. Create with full fields.
  const created = await call("/api/agents", {
    method: "POST",
    body: JSON.stringify({
      name: `E2E Agent ${suffix}`,
      role: "Verifier",
      instructions: "Cite a source for every claim.",
      model: "groq:gpt-oss-120b",
      fallbackModels: ["google:gemini-3.8-flash"],
      isSupervisor: false,
    }),
  });
  const agent = created.body?.agent;
  createdId = agent?.id ?? null;
  check(
    "POST creates with role/instructions/model/fallbacks",
    created.status === 201 &&
      agent?.role === "Verifier" &&
      agent?.instructions === "Cite a source for every claim." &&
      agent?.model === "groq:gpt-oss-120b" &&
      agent?.fallbackModels?.length === 1 &&
      typeof agent?.avatar?.type === "string",
    `status=${created.status}`,
  );

  if (createdId) {
    // 3. Patch name + instructions + fallbacks.
    const patched = await call(`/api/agents/${createdId}`, {
      method: "PATCH",
      body: JSON.stringify({
        name: `E2E Agent Renamed ${suffix}`,
        instructions: null,
        fallbackModels: ["openrouter:qwen3.8-27b", "google:gemini-3.8-flash"],
      }),
    });
    check(
      "PATCH applies rename, clear, and ordered fallbacks",
      patched.status === 200 &&
        patched.body?.agent?.name === `E2E Agent Renamed ${suffix}` &&
        patched.body?.agent?.instructions === null &&
        patched.body?.agent?.fallbackModels?.[0] === "openrouter:qwen3.8-27b",
      `status=${patched.status}`,
    );

    // 4. Unknown model rejected.
    const unknown = await call(`/api/agents/${createdId}`, {
      method: "PATCH",
      body: JSON.stringify({ model: "google:does-not-exist" }),
    });
    check("PATCH rejects an unknown model id", unknown.status === 400, `status=${unknown.status}`);

    // 5. Primary repeated in fallbacks rejected.
    const dupe = await call(`/api/agents/${createdId}`, {
      method: "PATCH",
      body: JSON.stringify({
        model: "groq:gpt-oss-120b",
        fallbackModels: ["groq:gpt-oss-120b"],
      }),
    });
    check(
      "PATCH rejects primary repeated in fallbacks",
      dupe.status === 400,
      `status=${dupe.status}`,
    );

    // 6. Empty string clears role.
    const cleared = await call(`/api/agents/${createdId}`, {
      method: "PATCH",
      body: JSON.stringify({ role: "" }),
    });
    check(
      "PATCH clears role on empty string",
      cleared.status === 200 && cleared.body?.agent?.role === null,
      `status=${cleared.status}`,
    );

    // 7. Delete, then 404.
    const del = await call(`/api/agents/${createdId}`, { method: "DELETE" });
    const again = await call(`/api/agents/${createdId}`, { method: "DELETE" });
    check(
      "DELETE removes the agent; second DELETE 404s",
      del.status === 200 && again.status === 404,
      `delete=${del.status} again=${again.status}`,
    );
    createdId = null;
  }

  // 8. The default agent still exists (runs need it).
  const after = await call("/api/agents");
  check(
    "default agent still present after CRUD",
    (after.body?.agents ?? []).some((row) => row.name === "Personal"),
    `agents=${(after.body?.agents ?? []).length}`,
  );
} finally {
  if (createdId) {
    await call(`/api/agents/${createdId}`, { method: "DELETE" }).catch(() => {});
  }
}

const passed = checks.filter(Boolean).length;
console.log(`\n${passed}/${checks.length} checks passed`);
process.exit(passed === checks.length ? 0 : 1);
