#!/usr/bin/env node
/**
 * End-to-end check of the dashboard listing CRUD addendum against a deployed API.
 *
 *   node scripts/check-listing-crud.mjs [baseUrl]
 *
 * Verifies: `?all=1` admin view (incl. disabled), create with `instructions`
 * (+ slug normalization), duplicate-slug 409, update, enable/disable filtering,
 * delete + 404, zod 400 on invalid bodies, and the camelCase public row shape
 * (`authType` / `isVerified` / `isFreeTier`) the mobile chips read.
 * Cleans up its own listing even if a check fails.
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
  return { status: res.status, body };
}

const checks = [];
const check = (name, pass, detail = "") => {
  checks.push(pass);
  console.log(`${pass ? "PASS" : "FAIL"}  ${name}${detail ? `  (${detail})` : ""}`);
};

const slug = `e2e-crud-${Date.now().toString(36)}`;
const expectedSlug = `e2e-crud-${slug}`; // normalizeListingSlug(" E2E CRUD! <slug> ")
const instructions = "1. Get an API key at example.com\n2. Paste it in Settings → Integrations";
const extras = []; // any listing accidentally created beyond the main one
let createdId = null;

try {
  // Self-heal: remove leftovers from a previous failed run.
  const stale = await call("/api/mcp/servers?all=1");
  for (const row of stale.body?.servers ?? []) {
    if (row.name === "E2E CRUD Listing") {
      await call(`/api/mcp/servers/${row.id}`, { method: "DELETE" });
      console.log(`cleaned up leftover listing "${row.slug}"`);
    }
  }

  // 1. Deploy is live when rows carry `instructions`.
  const list = await call("/api/mcp/servers?all=1");
  const rows = list.body?.servers ?? [];
  check(
    "admin ?all=1 returns 200 with instructions on rows",
    list.status === 200 && rows.length > 0 && rows.every((r) => "instructions" in r),
    `status=${list.status} rows=${rows.length}`,
  );

  // 2. Create with a messy slug (normalizes) + instructions.
  const created = await call("/api/mcp/servers", {
    method: "POST",
    body: JSON.stringify({
      slug: `  E2E CRUD! ${slug}  `,
      name: "E2E CRUD Listing",
      description: "Temporary listing created by check-listing-crud.mjs",
      instructions,
      authType: "api_key",
      category: "test",
    }),
  });
  const server = created.body?.server;
  createdId = server?.id ?? null;
  check(
    "create returns 201 with normalized slug + instructions",
    created.status === 201 && server?.slug === expectedSlug && server?.instructions === instructions,
    `status=${created.status} slug=${server?.slug}`,
  );

  // 3. Detail round-trip.
  if (createdId) {
    const detail = await call(`/api/mcp/servers/${createdId}`);
    check(
      "GET /:id returns the listing with instructions",
      detail.status === 200 && detail.body?.server?.instructions === instructions,
      `status=${detail.status}`,
    );

    // 4. Duplicate slug → 409.
    const dup = await call("/api/mcp/servers", {
      method: "POST",
      body: JSON.stringify({ slug: expectedSlug, name: "E2E CRUD Listing", authType: "api_key" }),
    });
    if (dup.body?.server?.id) extras.push(dup.body.server.id);
    check("duplicate slug rejected with 409", dup.status === 409, `status=${dup.status}`);
  }

  // 5. Invalid body (missing name) → 400 with a readable message.
  const bad = await call("/api/mcp/servers", {
    method: "POST",
    body: JSON.stringify({ slug: `${slug}-bad`, authType: "api_key" }),
  });
  if (bad.body?.server?.id) extras.push(bad.body.server.id);
  check(
    "zod 400 on missing name",
    bad.status === 400 && typeof bad.body?.error?.message === "string" && bad.body.error.message.length > 0,
    `status=${bad.status} msg=${bad.body?.error?.message}`,
  );

  if (createdId) {
    // 6. Update instructions + disable.
    const updated = await call(`/api/mcp/servers/${createdId}`, {
      method: "PUT",
      body: JSON.stringify({ instructions: `${instructions}\n3. Done`, enabled: false }),
    });
    check(
      "update applies instructions and disables the listing",
      updated.status === 200 &&
        updated.body?.server?.instructions?.endsWith("3. Done") &&
        updated.body?.server?.enabled === false,
      `status=${updated.status}`,
    );

    // 7. Disabled listing shows in ?all=1 but not the public list.
    const all = await call("/api/mcp/servers?all=1");
    const plain = await call("/api/mcp/servers");
    const inAll = (all.body?.servers ?? []).some((r) => r.id === createdId);
    const inPlain = (plain.body?.servers ?? []).some((r) => r.id === createdId);
    check(
      "disabled listing visible with ?all=1, hidden without",
      inAll && !inPlain,
      `all=${inAll} plain=${inPlain}`,
    );

    // 8. Public row shape keeps the camelCase chips the mobile list reads.
    const sample = (plain.body?.servers ?? [])[0];
    check(
      "public rows expose authType/isVerified/isFreeTier (mobile chips)",
      !!sample && "authType" in sample && "isVerified" in sample && "isFreeTier" in sample,
      sample ? `sample keys ok` : "no rows",
    );

    // 9. Delete → 404 on the next read.
    const del = await call(`/api/mcp/servers/${createdId}`, { method: "DELETE" });
    const after = await call(`/api/mcp/servers/${createdId}`);
    check(
      "delete removes the listing (next GET 404s)",
      (del.status === 200 || del.status === 204) && after.status === 404,
      `delete=${del.status} get=${after.status}`,
    );
  }
} finally {
  const ids = [createdId, ...extras].filter(Boolean);
  for (const id of ids) {
    await call(`/api/mcp/servers/${id}`, { method: "DELETE" }).catch(() => {});
  }
}

const passed = checks.filter(Boolean).length;
console.log(`\n${passed}/${checks.length} checks passed`);
process.exit(passed === checks.length ? 0 : 1);
