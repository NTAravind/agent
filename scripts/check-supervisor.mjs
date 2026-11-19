#!/usr/bin/env node
/**
 * End-to-end check of Phase 7 slice C (supervisor graph) against a running API.
 *
 *   node scripts/check-supervisor.mjs [baseUrl]
 *
 * Creates 2 specialists + 1 supervisor, runs a real supervisor task inline
 * (delegate → parallel child runs → cross-provider verify → merge) and
 * verifies: ≥2 children on distinct agents, the four supervisor nodes in the
 * timeline, a cross-provider verifier, a merged answer, and that children
 * nest (present in run detail, absent from the top-level list). Cleans up
 * after itself (agents + runs).
 */
import { readFileSync } from "node:fs";
import http from "node:http";
import https from "node:https";

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
const keyedProviders = [
  env.GOOGLE_GENERATIVE_AI_API_KEY,
  env.GROQ_API_KEY,
  env.OPENROUTER_API_KEY,
  env.MISTRAL_API_KEY,
  env.DEEPSEEK_API_KEY,
  env.HUGGINGFACE_API_KEY,
  env.COHERE_API_KEY,
].filter(Boolean).length;

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

async function call(path, init = {}) {
  const res = await fetch(`${base}${path}`, { ...init, headers });
  const text = await res.text();
  let body;
  try {
    body = JSON.parse(text);
  } catch {
    body = text;
  }
  return { status: res.status, body };
}

/**
 * Same as `call`, but over raw node:http with no timeout — an inline
 * supervisor run takes minutes, past undici's 300s headers timeout.
 */
function callLong(path, init = {}) {
  const url = new URL(`${base}${path}`);
  const lib = url.protocol === "https:" ? https : http;
  const bodyText = init.body ? JSON.stringify(init.body) : null;
  return new Promise((resolve, reject) => {
    const req = lib.request(
      {
        hostname: url.hostname,
        port: url.port || (url.protocol === "https:" ? 443 : 80),
        path: `${url.pathname}${url.search}`,
        method: init.method ?? "GET",
        headers: {
          ...headers,
          ...(bodyText
            ? { "Content-Type": "application/json", "Content-Length": Buffer.byteLength(bodyText) }
            : {}),
        },
      },
      (res) => {
        let text = "";
        res.on("data", (chunk) => (text += chunk));
        res.on("end", () => {
          let body;
          try {
            body = JSON.parse(text);
          } catch {
            body = text;
          }
          resolve({ status: res.statusCode, body });
        });
      },
    );
    req.on("error", reject);
    if (bodyText) req.write(bodyText);
    req.end();
  });
}

const checks = [];
const check = (name, pass, detail = "") => {
  checks.push(pass);
  console.log(`${pass ? "PASS" : "FAIL"}  ${name}${detail ? `  (${detail})` : ""}`);
};

const stamp = Date.now();
const createdAgents = [];
const createdRuns = [];
const GOAL = "List 3 popular programming languages and one interesting fact each.";

async function createAgent(input) {
  const created = await call("/api/agents", {
    method: "POST",
    body: JSON.stringify(input),
  });
  if (created.status !== 201 || !created.body?.agent?.id) {
    throw new Error(`Could not create agent ${input.name}: ${JSON.stringify(created.body)}`);
  }
  createdAgents.push(created.body.agent.id);
  return created.body.agent;
}

try {
  // 1. The cast: two specialists with distinct angles + one supervisor.
  //    Specialists run on the fast model so child runs stay quick.
  const researcher = await createAgent({
    name: `Fact Finder ${stamp}`,
    role: "Finds facts with sources",
    isSupervisor: false,
    model: "google:gemini-3.5-flash-lite",
  });
  const critic = await createAgent({
    name: `Gap Checker ${stamp}`,
    role: "Checks claims and finds gaps",
    isSupervisor: false,
    model: "google:gemini-3.5-flash-lite",
  });
  const supervisor = await createAgent({
    name: `Lead ${stamp}`,
    role: "Coordinates the team",
    isSupervisor: true,
  });
  check("created 2 specialists + 1 supervisor", Boolean(researcher.id && critic.id && supervisor.id));

  // 2. Run the supervisor inline (delegate → fan_out → verify → merge).
  console.log(`running supervisor task inline (goal: "${GOAL}")…`);
  const startedAt = Date.now();
  const runRes = await callLong("/api/agents/run", {
    method: "POST",
    body: { goal: GOAL, agentId: supervisor.id, inline: true },
  });
  const elapsed = Math.round((Date.now() - startedAt) / 1000);
  check(
    "POST /api/agents/run (inline) completed",
    runRes.status === 200 && Boolean(runRes.body?.runId),
    `status=${runRes.status} run=${runRes.body?.runId ?? "none"} took=${elapsed}s`,
  );
  const runId = runRes.body?.runId;
  if (!runId) throw new Error("no run id");
  createdRuns.push(runId);

  // 3. The run detail: status, nested children, supervisor timeline.
  const detail = await call(`/api/runs/${runId}`);
  const children = detail.body?.children ?? [];
  const succeededChildren = children.filter((child) => child.status === "succeeded");
  const distinctAgents = new Set(children.map((child) => child.agent_id).filter(Boolean));
  check(
    "run succeeded",
    detail.body?.run?.status === "succeeded",
    `status=${detail.body?.run?.status ?? "?"}`,
  );
  check(
    "delegated to ≥2 specialists on distinct agents",
    children.length >= 2 && distinctAgents.size >= 2,
    `children=${children.length} distinctAgents=${distinctAgents.size}`,
  );
  check(
    "children succeeded (cross-check had material to work with)",
    succeededChildren.length >= 2,
    `succeeded=${succeededChildren.length}/${children.length}`,
  );
  check(
    "children carry agent name + avatar",
    children.length > 0 &&
      children.every((child) => child.agent?.name && child.agent?.avatar?.type),
    `withAgent=${children.filter((c) => c.agent?.name).length}/${children.length}`,
  );

  const nodeStarts = new Set(
    (detail.body?.events ?? [])
      .filter((event) => event.type === "node_start")
      .map((event) => event.payload?.node),
  );
  const supervisorNodes = ["delegate", "fan_out", "verify", "merge"];
  check(
    "timeline shows all four supervisor nodes",
    supervisorNodes.every((node) => nodeStarts.has(node)),
    `nodes=${[...nodeStarts].join(",")}`,
  );

  const verifyEvent = (detail.body?.events ?? []).find(
    (event) => event.type === "node_end" && event.payload?.node === "verify",
  );
  check(
    "verifier ran with a model",
    Boolean(verifyEvent) && typeof verifyEvent.payload?.model === "string",
    `model=${verifyEvent?.payload?.model ?? "none"}`,
  );
  if (keyedProviders >= 2) {
    check(
      "verifier ran on a different provider than the workers",
      verifyEvent?.payload?.crossProvider === true,
      `providers=${keyedProviders} crossProvider=${verifyEvent?.payload?.crossProvider}`,
    );
  } else {
    checks.push(true);
    console.log("SKIP  cross-provider verifier (only one provider key configured)");
  }

  const answer =
    typeof detail.body?.run?.result?.answer === "string"
      ? detail.body.run.result.answer
      : "";
  check("merged a final answer", answer.trim().length > 0, `answer=${answer.length} chars`);

  // 4. Children nest: in the detail, out of the top-level list.
  const list = await call("/api/runs");
  const listedIds = new Set((list.body?.runs ?? []).map((row) => row.id));
  check(
    "parent is listed; children are not",
    listedIds.has(runId) && children.every((child) => !listedIds.has(child.id)),
    `listed=${listedIds.size} children=${children.length}`,
  );
} catch (error) {
  check("supervisor E2E ran to completion", false, error instanceof Error ? error.message : String(error));
} finally {
  // Cleanup: children first (parent_run_id FK), then parent; then the agents.
  for (const runId of createdRuns) {
    const detail = await call(`/api/runs/${runId}`).catch(() => null);
    const childIds = (detail?.body?.children ?? []).map((child) => child.id);
    if (childIds.length > 0) {
      await fetch(
        `${env.SUPABASE_URL}/rest/v1/agent_runs?id=in.(${childIds.join(",")})`,
        {
          method: "DELETE",
          headers: {
            apikey: env.SUPABASE_SERVICE_ROLE_KEY,
            Authorization: `Bearer ${env.SUPABASE_SERVICE_ROLE_KEY}`,
          },
        },
      ).catch(() => {});
    }
    await fetch(`${env.SUPABASE_URL}/rest/v1/agent_runs?id=eq.${runId}`, {
      method: "DELETE",
      headers: {
        apikey: env.SUPABASE_SERVICE_ROLE_KEY,
        Authorization: `Bearer ${env.SUPABASE_SERVICE_ROLE_KEY}`,
      },
    }).catch(() => {});
  }
  for (const agentId of createdAgents) {
    await call(`/api/agents/${agentId}`, { method: "DELETE" }).catch(() => {});
  }
}

const passed = checks.filter(Boolean).length;
console.log(`\n${passed}/${checks.length} checks passed`);
process.exit(passed === checks.length ? 0 : 1);
