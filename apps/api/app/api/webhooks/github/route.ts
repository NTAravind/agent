import { createHmac, timingSafeEqual } from "node:crypto";

import { optionalEnv } from "@/lib/env";
import { inngest } from "@/lib/inngest/client";
import { vaultChanged } from "@/lib/inngest/events";

/**
 * POST /api/webhooks/github — a push to the vault repo triggers a re-index.
 *
 * The payload is authenticated with the `x-hub-signature-256` header
 * (HMAC-SHA256 of the raw body, keyed with GITHUB_WEBHOOK_SECRET).
 */
export async function POST(request: Request) {
  const raw = await request.text();
  const secret = optionalEnv("GITHUB_WEBHOOK_SECRET");

  if (!secret) {
    return Response.json(
      { error: { code: "not_configured", message: "GITHUB_WEBHOOK_SECRET is not set." } },
      { status: 503 },
    );
  }

  const signature = request.headers.get("x-hub-signature-256") ?? "";
  const expected = `sha256=${createHmac("sha256", secret).update(raw).digest("hex")}`;

  const a = Buffer.from(signature);
  const b = Buffer.from(expected);
  if (a.length !== b.length || !timingSafeEqual(a, b)) {
    return Response.json(
      { error: { code: "unauthorized", message: "Invalid webhook signature." } },
      { status: 401 },
    );
  }

  let event: string | undefined;
  let payload: { repository?: { full_name?: string } } = {};
  try {
    payload = JSON.parse(raw);
    event = request.headers.get("x-github-event") ?? undefined;
  } catch {
    return Response.json(
      { error: { code: "bad_request", message: "Invalid JSON payload." } },
      { status: 400 },
    );
  }

  // Only pushes to the vault repo matter.
  const configuredRepo = optionalEnv("GITHUB_VAULT_REPO");
  if (event !== "push") {
    return Response.json({ ok: true, ignored: event ?? "unknown" });
  }
  if (configuredRepo && payload.repository?.full_name && payload.repository.full_name !== configuredRepo) {
    return Response.json({ ok: true, ignored: "different repository" });
  }

  const userId = optionalEnv("ALLOWED_USER_ID");
  if (!userId) {
    return Response.json(
      { error: { code: "not_configured", message: "ALLOWED_USER_ID is not set." } },
      { status: 503 },
    );
  }

  await inngest.send(vaultChanged.create({ userId, ref: payload.repository?.full_name }));

  return Response.json({ ok: true, queued: true });
}
