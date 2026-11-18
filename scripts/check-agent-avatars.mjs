#!/usr/bin/env node
/**
 * End-to-end check of Phase 7 slice B (avatars everywhere) against a running API.
 *
 *   node scripts/check-agent-avatars.mjs [baseUrl]
 *
 * Verifies: signed upload URL round-trip (mint → PUT image → PATCH avatar →
 * signed read URL serves bytes), embedded agent summaries in threads and runs
 * (list + detail), and the chat thread→agent association (real chat send with
 * agentId, thread deleted afterwards). Restores the agent's original avatar.
 * Requires migrations 0010 + 0011.
 */
import { readFileSync } from "node:fs";
import { randomUUID } from "node:crypto";

const base = process.argv[2] ?? "http://localhost:3000";
const emails = process.env.ALLOWED_USER_EMAIL
  ? [process.env.ALLOWED_USER_EMAIL]
  : ["ntaravindnarayanan7@gmail.com", "ntaravindnarayanan01@gmail.com"];

// 1×1 red PNG.
const PNG_BYTES = Buffer.from(
  "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==",
  "base64",
);

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

const checks = [];
const check = (name, pass, detail = "") => {
  checks.push(pass);
  console.log(`${pass ? "PASS" : "FAIL"}  ${name}${detail ? `  (${detail})` : ""}`);
};

let agentId = null;
let originalAvatar = null;

try {
  // 1. Target agent (the default "Personal" one) + its original avatar.
  const list = await call("/api/agents");
  const agent = (list.body?.agents ?? [])[0];
  agentId = agent?.id ?? null;
  originalAvatar = agent?.avatar ?? null;
  check("an agent exists to test with", Boolean(agent), `status=${list.status}`);
  if (!agent) throw new Error("no agent");

  // 2. Signed upload URL.
  const signed = await call(`/api/agents/${agentId}/avatar`, {
    method: "POST",
    body: JSON.stringify({ mediaType: "image/png", sizeBytes: PNG_BYTES.length }),
  });
  const minted = signed.body;
  check(
    "POST /api/agents/:id/avatar returns a signed upload triple",
    signed.status === 200 &&
      typeof minted.storagePath === "string" &&
      typeof minted.signedUrl === "string" &&
      typeof minted.token === "string",
    `status=${signed.status}`,
  );

  // 3. Upload bytes to Storage via the signed URL (same as the app does).
  const put = await fetch(minted.signedUrl, {
    method: "PUT",
    headers: { Authorization: `Bearer ${minted.token}`, "Content-Type": "image/png" },
    body: PNG_BYTES,
  });
  check("PUT image to the signed Storage URL", put.status === 200, `status=${put.status}`);

  // 4. Save the avatar as an image avatar.
  const patched = await call(`/api/agents/${agentId}`, {
    method: "PATCH",
    body: JSON.stringify({
      avatar: { type: "image", value: minted.storagePath, color: "#EF4444" },
    }),
  });
  const savedAvatar = patched.body?.agent?.avatar;
  check(
    "PATCH stores the Storage path and returns a signed read url",
    patched.status === 200 &&
      savedAvatar?.value === minted.storagePath &&
      typeof savedAvatar?.url === "string" &&
      savedAvatar.url.startsWith("http"),
    `status=${patched.status}`,
  );

  // 5. The signed read URL actually serves image bytes.
  if (savedAvatar?.url) {
    const img = await fetch(savedAvatar.url);
    const contentType = img.headers.get("content-type") ?? "";
    check(
      "signed read URL serves the image",
      img.status === 200 && contentType.startsWith("image/"),
      `status=${img.status} type=${contentType}`,
    );
  } else {
    check("signed read URL serves the image", false, "no url");
  }

  // 6. The list keeps the raw path (so a later save can't clobber it).
  const listAgain = await call("/api/agents");
  const listed = (listAgain.body?.agents ?? []).find((row) => row.id === agentId);
  check(
    "GET /api/agents keeps value=Storage path + url for images",
    listed?.avatar?.value === minted.storagePath && typeof listed?.avatar?.url === "string",
    `status=${listAgain.status}`,
  );

  // 7. Chat: a new thread created with agentId owns that agent. Runs before
  //    the list check so the account is guaranteed one thread (fresh local
  //    accounts have no history).
  const threadId = randomUUID();
  const chatRes = await fetch(`${base}/api/chat`, {
    method: "POST",
    headers,
    body: JSON.stringify({
      threadId,
      agentId,
      messages: [
        { id: randomUUID(), role: "user", parts: [{ type: "text", text: "Reply with just: ok" }] },
      ],
    }),
  });
  await chatRes.text(); // consume the stream (thread is created before it starts)
  const thread = await call(`/api/threads/${threadId}`);
  check(
    "chat POST with agentId creates a thread owned by that agent",
    thread.status === 200 && thread.body?.thread?.agent_id === agentId &&
      thread.body?.thread?.agent?.name === agent.name,
    `status=${thread.status} chat=${chatRes.status} agent=${thread.body?.thread?.agent?.name ?? "null"}`,
  );

  // 8. Threads embed the thread's agent (the new thread + backfilled ones).
  const threads = await call("/api/threads");
  const rows = threads.body?.threads ?? [];
  const withAgent = rows.filter((row) => row.agent?.name && row.agent?.avatar?.type);
  check(
    "GET /api/threads embeds agent name + avatar",
    threads.status === 200 && rows.length > 0 && withAgent.length > 0,
    `status=${threads.status} threads=${rows.length} withAgent=${withAgent.length}`,
  );
  await call(`/api/threads/${threadId}`, { method: "DELETE" });

  // 9. Runs embed the run's agent (old runs may predate agent_id tracking).
  const runs = await call("/api/runs");
  const runRows = runs.body?.runs ?? [];
  const keyed = runRows.filter((row) => "agent" in row);
  const withRunAgent = runRows.filter((row) => row.agent?.name);
  check(
    "GET /api/runs rows carry an agent field (name+avatar when the run has one)",
    runs.status === 200 && keyed.length === runRows.length,
    `status=${runs.status} runs=${runRows.length} withAgent=${withRunAgent.length}`,
  );

  // 10. Run detail embeds the run's agent when it has one.
  if (runRows.length > 0) {
    const detail = await call(`/api/runs/${runRows[0].id}`);
    const hasAgentId = Boolean(detail.body?.run?.agent_id);
    const detailAgent = detail.body?.agent;
    check(
      "GET /api/runs/:id embeds the run's agent",
      detail.status === 200 && (!hasAgentId || Boolean(detailAgent?.name && detailAgent?.avatar?.type)),
      `status=${detail.status} agentId=${hasAgentId} agent=${detailAgent?.name ?? "null"}`,
    );
  } else {
    checks.push(true);
    console.log("SKIP  GET /api/runs/:id embeds the run's agent  (no runs for this account)");
  }
} finally {
  // Restore the original avatar so the test leaves no visible trace (the
  // response-only signed `url` is stripped — only the persisted fields go back).
  if (agentId && originalAvatar) {
    const restore = {
      type: originalAvatar.type,
      value: originalAvatar.value,
      ...(originalAvatar.color ? { color: originalAvatar.color } : {}),
    };
    await call(`/api/agents/${agentId}`, {
      method: "PATCH",
      body: JSON.stringify({ avatar: restore }),
    }).catch(() => {});
  }
}

const passed = checks.filter(Boolean).length;
console.log(`\n${passed}/${checks.length} checks passed`);
process.exit(passed === checks.length ? 0 : 1);
