import { createHash } from "node:crypto";

import { supabaseAdmin } from "@/lib/supabase/server";

/**
 * Ordinary-chat approval grants.
 *
 * The AI SDK signs each inline approval request with an HMAC over
 * (approvalId, toolCallId, toolName, canonicalized input). The signature
 * proves the request was issued by this server and that the tool call and its
 * input were not changed — but it says nothing about *where* the approval may
 * be used or how often.
 *
 * A grant closes that gap. It is written when the approval is issued (the
 * approval policy runs before the signed request reaches the client) and
 * consumed atomically by the tool's execute callback, which the AI SDK only
 * reaches after it has verified the signature and found an approved decision.
 *
 * The grant is keyed by the tool call id, which the HMAC already binds, so a
 * client cannot swap in a different call.
 */
export type ApprovalGrantContext = {
  userId: string;
  threadId: string;
  agentId: string | null;
  connectionId: string | null;
  toolName: string;
};

/** One grant operation (record or consume). */
export type ApprovalGrantOperation = {
  toolCallId: string;
  input: unknown;
  context: ApprovalGrantContext;
};

/**
 * Storage for approval grants.
 *
 * The production implementation is the Supabase-backed store below. Tests use
 * an in-memory implementation, so the approval gate can be exercised without a
 * database.
 */
export type ApprovalGrantStore = {
  /** Records the grant for an approval that is about to be issued. */
  record(input: ApprovalGrantOperation): Promise<void>;
  /** Consumes the grant exactly once. Throws when it may not be used. */
  consume(input: ApprovalGrantOperation): Promise<void>;
  /** Marks a pending grant as denied. */
  deny(input: { toolCallId: string }): Promise<void>;
};

/** How long an issued approval stays usable. */
const GRANT_TTL_MS = 24 * 60 * 60 * 1000;

/**
 * Canonical JSON: object keys are sorted recursively so two structurally equal
 * inputs always produce the same digest regardless of key order.
 */
function canonicalize(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(canonicalize);
  if (value && typeof value === "object") {
    const source = value as Record<string, unknown>;
    const out: Record<string, unknown> = {};
    for (const key of Object.keys(source).sort()) {
      out[key] = canonicalize(source[key]);
    }
    return out;
  }
  return value;
}

/** Stable digest of a tool input. */
export function approvalInputDigest(input: unknown): string {
  let serialized: string;
  try {
    serialized = JSON.stringify(canonicalize(input ?? {})) ?? "{}";
  } catch {
    serialized = String(input);
  }
  return createHash("sha256").update(serialized).digest("hex");
}

/** The state of one grant, independent of how it is stored. */
export type ApprovalGrantState = {
  status: string;
  /** Expiry as epoch milliseconds. */
  expiresAt: number;
  userId: string;
  threadId: string;
  agentId: string | null;
  connectionId: string | null;
  toolName: string;
  inputDigest: string;
};

/** True when a grant may still be used for this context. */
function grantMatches(
  grant: ApprovalGrantState,
  input: ApprovalGrantOperation,
): boolean {
  return (
    grant.userId === input.context.userId &&
    grant.threadId === input.context.threadId &&
    (grant.agentId ?? null) === (input.context.agentId ?? null) &&
    (grant.connectionId ?? null) === (input.context.connectionId ?? null) &&
    grant.toolName === input.context.toolName &&
    grant.inputDigest === approvalInputDigest(input.input)
  );
}

/**
 * Throws when the grant may not be used for this operation.
 *
 * The rules live here (not in the storage) so every store — production and
 * test — enforces exactly the same policy: one use, one conversation, one
 * agent, one connection, one tool, one input, until it expires.
 */
export function assertGrantUsable(
  grant: ApprovalGrantState,
  input: ApprovalGrantOperation,
  now: number = Date.now(),
): void {
  if (grant.status !== "pending") {
    throw new Error(`This approval has already been used (${grant.status}).`);
  }
  if (grant.expiresAt <= now) {
    throw new Error("This approval has expired.");
  }
  if (!grantMatches(grant, input)) {
    throw new Error("This approval does not belong to this conversation.");
  }
}

/**
 * Records the grant for an approval that is about to be issued.
 *
 * Idempotent: the AI SDK resolves the approval policy again when the
 * continuation arrives, so the same tool call may be recorded twice. The
 * first write wins; a later one never resets a consumed grant and never
 * re-points it at another conversation.
 */
async function recordGrant(input: ApprovalGrantOperation): Promise<void> {
  const { data: existing } = await supabaseAdmin()
    .from("chat_approval_grants")
    .select("id")
    .eq("tool_call_id", input.toolCallId)
    .maybeSingle();

  if (existing) return;

  const { error } = await supabaseAdmin().from("chat_approval_grants").insert({
    tool_call_id: input.toolCallId,
    user_id: input.context.userId,
    thread_id: input.context.threadId,
    agent_id: input.context.agentId,
    connection_id: input.context.connectionId,
    tool_name: input.context.toolName,
    input_digest: approvalInputDigest(input.input),
    status: "pending",
    expires_at: new Date(Date.now() + GRANT_TTL_MS).toISOString(),
  });

  if (error && error.code !== "23505") {
    // A failed grant means the approval cannot be enforced later, so the
    // request must not continue as if it could.
    throw new Error(`Could not record the approval grant: ${error.message}`);
  }
}

/**
 * Atomically consumes the grant for an approved tool call.
 *
 * Throws when the grant is missing, already consumed, expired, denied, or
 * belongs to a different user, thread, agent, connection, tool or input. The
 * AI SDK calls this only after verifying the signed approval, so reaching this
 * point means the decision was genuine — the grant decides *where* and *how
 * often* it may be used.
 */
async function consumeGrant(input: ApprovalGrantOperation): Promise<void> {
  const admin = supabaseAdmin();
  const { data: grant, error: findError } = await admin
    .from("chat_approval_grants")
    .select(
      "id, status, expires_at, user_id, thread_id, agent_id, connection_id, tool_name, input_digest",
    )
    .eq("tool_call_id", input.toolCallId)
    .maybeSingle();

  if (findError) {
    throw new Error(`Could not read the approval grant: ${findError.message}`);
  }
  if (!grant) {
    throw new Error("This approval was not issued by the server.");
  }

  const row = grant as {
    id: string;
    status: string;
    expires_at: string;
    user_id: string;
    thread_id: string;
    agent_id: string | null;
    connection_id: string | null;
    tool_name: string;
    input_digest: string;
  };

  const state: ApprovalGrantState = {
    status: row.status,
    expiresAt: new Date(row.expires_at).getTime(),
    userId: row.user_id,
    threadId: row.thread_id,
    agentId: row.agent_id,
    connectionId: row.connection_id,
    toolName: row.tool_name,
    inputDigest: row.input_digest,
  };

  try {
    assertGrantUsable(state, input);
  } catch (error) {
    // An expired grant is closed on the way out so it cannot be used later.
    if (state.status === "pending" && state.expiresAt <= Date.now()) {
      await admin
        .from("chat_approval_grants")
        .update({ status: "expired" })
        .eq("id", row.id);
    }
    throw error;
  }

  // Atomically flip pending → consumed. A replay finds no pending row and
  // is rejected above.
  const { data: consumed, error: consumeError } = await admin
    .from("chat_approval_grants")
    .update({ status: "consumed", consumed_at: new Date().toISOString() })
    .eq("id", row.id)
    .eq("status", "pending")
    .select("id")
    .maybeSingle();

  if (consumeError) {
    throw new Error(`Could not consume the approval grant: ${consumeError.message}`);
  }
  if (!consumed) {
    throw new Error("This approval has already been used.");
  }
}

/** Marks a pending grant as denied. Best-effort: a denial is not a side effect. */
async function denyGrant(input: { toolCallId: string }): Promise<void> {
  const { error } = await supabaseAdmin()
    .from("chat_approval_grants")
    .update({ status: "denied", decided_at: new Date().toISOString() })
    .eq("tool_call_id", input.toolCallId)
    .eq("status", "pending");

  if (error) {
    console.warn("[chat] could not mark the approval grant denied:", error.message);
  }
}

/** The production grant store (Supabase). */
export const supabaseApprovalGrantStore: ApprovalGrantStore = {
  record: recordGrant,
  consume: consumeGrant,
  deny: denyGrant,
};

/**
 * Marks an issued approval as denied.
 *
 * A denial is not a side effect, so a failed write is only logged: the tool
 * does not run either way.
 */
export async function denyApprovalGrant(toolCallId: string): Promise<void> {
  await supabaseApprovalGrantStore.deny({ toolCallId });
}

/**
 * Expires grants that were issued but never used. Best-effort maintenance —
 * a failure here never blocks a chat.
 */
export async function expireStaleApprovalGrants(): Promise<number> {
  const now = new Date().toISOString();
  const { data, error } = await supabaseAdmin()
    .from("chat_approval_grants")
    .update({ status: "expired" })
    .eq("status", "pending")
    .lt("expires_at", now)
    .select("id");
  if (error) {
    console.warn("[chat] could not expire approval grants:", error.message);
    return 0;
  }
  return data?.length ?? 0;
}
