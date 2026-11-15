#!/usr/bin/env node
/**
 * End-to-end check of POST /api/chat against the local dev server.
 *
 *   node scripts/check-chat-route.mjs [baseUrl]
 *
 * Mints a Supabase session for the allow-listed user, posts a chat request and
 * prints the server-sent events. Requires the db/migrations to be applied.
 */
import { readFileSync } from "node:fs";

const base = process.argv[2] ?? "http://localhost:3000";

function readEnv(path) {
  const env = {};
  for (const line of readFileSync(path, "utf8").split("\n")) {
    const match = /^\s*([A-Z0-9_]+)\s*=\s*(.*)\s*$/.exec(line);
    if (match) env[match[1]] = match[2];
  }
  return env;
}

const env = readEnv("apps/api/.env.local");
const email = process.env.ALLOWED_USER_EMAIL ?? "ntaravindnarayanan7@gmail.com";

async function mintToken() {
  const link = await fetch(`${env.SUPABASE_URL}/auth/v1/admin/generate_link`, {
    method: "POST",
    headers: {
      apikey: env.SUPABASE_SERVICE_ROLE_KEY,
      Authorization: `Bearer ${env.SUPABASE_SERVICE_ROLE_KEY}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({ type: "magiclink", email }),
  });
  const linkBody = await link.json();
  const tokenHash = linkBody.hashed_token ?? linkBody.properties?.hashed_token;

  const verify = await fetch(`${env.SUPABASE_URL}/auth/v1/verify`, {
    method: "POST",
    headers: { apikey: env.SUPABASE_ANON_KEY, "Content-Type": "application/json" },
    body: JSON.stringify({ type: "magiclink", token_hash: tokenHash }),
  });
  const session = await verify.json();
  if (!session.access_token) throw new Error(`Could not mint a session: ${JSON.stringify(session)}`);
  return session.access_token;
}

const token = await mintToken();
const threadId = crypto.randomUUID();

console.log(`POST ${base}/api/chat  (thread ${threadId})`);

const response = await fetch(`${base}/api/chat`, {
  method: "POST",
  headers: {
    Authorization: `Bearer ${token}`,
    "Content-Type": "application/json",
  },
  body: JSON.stringify({
    threadId,
    model: process.env.CHAT_MODEL ?? "google:gemini-3.6-flash",
    messages: [
      {
        id: "m1",
        role: "user",
        parts: [{ type: "text", text: process.env.CHAT_PROMPT ?? "Reply with exactly: ok" }],
      },
    ],
  }),
});

console.log("status:", response.status, response.headers.get("content-type"));

if (!response.ok) {
  console.log(await response.text());
  process.exit(1);
}

const reader = response.body.getReader();
const decoder = new TextDecoder();
let buffer = "";

while (true) {
  const { done, value } = await reader.read();
  if (done) break;
  buffer += decoder.decode(value, { stream: true });

  let index;
  while ((index = buffer.indexOf("\n\n")) !== -1) {
    const block = buffer.slice(0, index);
    buffer = buffer.slice(index + 2);
    for (const line of block.split("\n")) {
      if (!line.startsWith("data:")) continue;
      const data = line.slice(5).trim();
      if (!data || data === "[DONE]") continue;
      try {
        const chunk = JSON.parse(data);
        const label =
          chunk.type === "text-delta"
            ? `text-delta: ${chunk.delta ?? ""}`
            : chunk.type === "error"
              ? `error: ${chunk.errorText ?? ""}`
              : chunk.type;
        console.log(`  ${label}`);
      } catch {
        console.log(`  ${data.slice(0, 80)}`);
      }
    }
  }
}
