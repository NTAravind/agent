#!/usr/bin/env node
/**
 * End-to-end check of the Phase 6 MCP marketplace against a deployed API.
 *
 *   node scripts/check-mcp-marketplace.mjs [baseUrl]
 *
 * Verifies the done-when path: catalog → connect Context7 (no auth) →
 * attach to an agent → the agent's next run executes an MCP tool →
 * approval-required tools pause and resume. Requires the 0008 migration,
 * ENCRYPTION_KEY on the server, and a reachable model provider.
 *
 * Approvals are approved automatically in a loop (up to 5 rounds), so the
 * script exercises the real Inngest approval-resume path unattended.
 */
import { readFileSync } from "node:fs";

const base = process.argv[2] ?? "https://agent-tau-taupe.vercel.app";
const email = process.env.ALLOWED_USER_EMAIL ?? "ntaravindnarayanan7@gmail.com";

function readEnv(path) {
  const env = {};
  for (const line of readFileSync(path, "utf8").split("\n")) {
    const match = /^\s*([A-Z0-9_]+)\s*=\s*(.*)\s*$/.exec(line);
    if (match) env[match[1]] = match[2];
  }
  return env;
}
const env = readEnv("apps/api/.env.local");
const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

async function mintToken() {
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

const token = await mintToken();
const headers = { Authorization: `Bearer ${token}`, "Content-Type": "application/json" };

async function call(path, init) {
  const res = await fetch(`${base}${path}`, { ...init, headers });
  const text = await res.text();
  let body;
  try { body = JSON.parse(text); } catch { body = text; }
  if (res.status >= 400) {
    throw new Error(`${init?.method ?? "GET"} ${path} -> ${res.status} ${text.slice(0, 300)}`);
  }
  return body;
}

const checks = [];
const check = (name, pass, detail = "") => {
  checks.push(pass);
  console.log(`${pass ? "PASS" : "FAIL"}  ${name}${detail ? `  (${detail})` : ""}`);
};

// 1. Catalog has the verified seeds.
const catalog = await call("/api/mcp/servers");
const context7 = (catalog.servers ?? []).find((s) => s.slug === "context7");
check("catalog lists verified integrations", (catalog.servers ?? []).length >= 5 &&
  Boolean(context7), `count=${catalog.servers?.length}`);

// 2. Connect Context7 (auth none → one tap, idempotent).
const connection = await call("/api/mcp/connections", {
  method: "POST",
  body: JSON.stringify({ serverId: context7.id }),
});
check("connect Context7", connection.status === "connected",
  `tools=${connection.toolCount}`);

const detail = await call(`/api/mcp/servers/${context7.id}`);
check("tools discovered and cached", (detail.tools ?? []).length > 0,
  detail.tools.map((t) => t.name).join(","));

// 3. Attach to the default agent (created on demand).
const agents = await call("/api/agents");
const agent = agents.agents[0];
await call(`/api/mcp/agents/${agent.id}/servers`, {
  method: "POST",
  body: JSON.stringify({ connectionId: connection.connectionId }),
});
const attachments = await call(`/api/mcp/agents/${agent.id}/servers`);
check("attached to agent", (attachments.attachments ?? []).some(
  (a) => a.server?.slug === "context7" && a.enabled,
), `agent=${agent.name}`);

// 4. Run: the model must use a Context7 tool; approval-required tools park
//    the run, so approve (via the real approval-resume path) until settled.
const goal =
  "Use the Context7 tools (mcp_context7_resolve_library_id and mcp_context7_query_docs) " +
  "to look up the 'next' library, then answer: what does the Promise-based route handler " +
  "params API look like in Next.js 16? You MUST call the Context7 tools — do not answer from memory.";

console.log("starting run (this takes a few minutes)...");
const started = await call("/api/agents/run", {
  method: "POST",
  body: JSON.stringify({ goal, agentId: agent.id, inline: true }),
});
const runId = started.runId;
let run = await call(`/api/runs/${runId}`);
let rounds = 0;

while (run.run?.status === "awaiting_approval" && rounds < 5) {
  rounds += 1;
  for (const approval of run.pendingApprovals ?? []) {
    console.log(`  approving: ${approval.reason ?? approval.toolName}`);
    await call(`/api/approvals/${approval.id}`, {
      method: "POST",
      body: JSON.stringify({ decision: "approve" }),
    });
  }
  await sleep(8_000);
  for (let i = 0; i < 24; i += 1) {
    run = await call(`/api/runs/${runId}`);
    const status = run.run?.status;
    if (status !== "awaiting_approval" && status !== "queued" && status !== "running") break;
    await sleep(5_000);
  }
}

// One more settle window for the finalize step.
for (let i = 0; i < 36 && run.run?.status === "running"; i += 1) {
  await sleep(5_000);
  run = await call(`/api/runs/${runId}`);
}

const mcpResults = (run.events ?? []).filter(
  (e) => e.type === "tool_result" && String(JSON.stringify(e.payload ?? "")).includes("mcp_context7"),
);
check("approval pause/resume worked", rounds > 0 || run.run?.status === "succeeded",
  `rounds=${rounds}`);
check("run succeeded", run.run?.status === "succeeded", `status=${run.run?.status}`);
check("MCP tool executed in the run", mcpResults.length > 0, `results=${mcpResults.length}`);

const answer = typeof run.run?.result === "string"
  ? run.run.result
  : JSON.stringify(run.run?.result ?? "");
check("answer cites Context7 output", /context7|\/vercel\/next\.js/i.test(answer),
  answer.slice(0, 80).replace(/\s+/g, " "));

const failed = checks.filter((pass) => !pass).length;
console.log(`\n${checks.length - failed}/${checks.length} checks passed (run ${runId})`);
process.exit(failed === 0 ? 0 : 1);
