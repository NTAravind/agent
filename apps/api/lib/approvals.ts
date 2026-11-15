import type { Approval, ApprovalStatus } from "@agent/shared";

import { supabaseAdmin } from "@/lib/supabase/server";

/**
 * Approvals for sensitive tools (ARCHITECTURE.md section 4): nothing sensitive
 * runs without an explicit decision. Created by the agent's tool-gate node,
 * decided by the user from the approval card, resumed via `approval/decided`.
 *
 * Approvals expire (default 24h): an expired approval is treated as a denial,
 * so a forgotten card can never act silently.
 */

/** Tools that require approval before execution. */
export const SENSITIVE_TOOLS = new Set(["write_note"]);

export const APPROVAL_TTL_MS = 24 * 60 * 60 * 1000;

export async function createApproval(input: {
  userId: string;
  runId: string;
  toolName: string;
  args: unknown;
  reason?: string;
  ttlMs?: number;
}): Promise<Approval> {
  const expiresAt = new Date(Date.now() + (input.ttlMs ?? APPROVAL_TTL_MS)).toISOString();

  const { data, error } = await supabaseAdmin()
    .from("approvals")
    .insert({
      user_id: input.userId,
      run_id: input.runId,
      tool_name: input.toolName,
      args: input.args ?? null,
      reason: input.reason ?? null,
      status: "pending",
      expires_at: expiresAt,
    })
    .select("id, run_id, tool_name, args, reason, status, created_at, expires_at")
    .single();

  if (error || !data) {
    throw new Error(`Could not create the approval: ${error?.message ?? "insert failed"}`);
  }

  return data as Approval;
}

export async function getApproval(id: string): Promise<(Approval & { user_id: string }) | null> {
  const { data } = await supabaseAdmin()
    .from("approvals")
    .select("id, user_id, run_id, tool_name, args, reason, status, created_at, expires_at")
    .eq("id", id)
    .maybeSingle();

  return (data as Approval & { user_id: string }) ?? null;
}

export async function listApprovals(
  userId: string,
  status: ApprovalStatus = "pending",
  limit = 50,
): Promise<Approval[]> {
  const { data } = await supabaseAdmin()
    .from("approvals")
    .select("id, run_id, tool_name, args, reason, status, created_at, expires_at")
    .eq("user_id", userId)
    .eq("status", status)
    .order("created_at", { ascending: false })
    .limit(limit);

  return (data ?? []) as Approval[];
}

export async function listPendingByRun(runId: string): Promise<Approval[]> {
  const { data } = await supabaseAdmin()
    .from("approvals")
    .select("id, run_id, tool_name, args, reason, status, created_at, expires_at")
    .eq("run_id", runId)
    .eq("status", "pending")
    .order("created_at", { ascending: true });

  return (data ?? []) as Approval[];
}

/**
 * The most recent approval for (run, tool) of any status.
 *
 * The tool gate uses this to stay idempotent across interrupt resumes: on
 * resume the same row is found and its status decides, instead of creating a
 * second approval.
 */
export async function findLatestApprovalForRunTool(
  runId: string,
  toolName: string,
): Promise<Approval | null> {
  const { data } = await supabaseAdmin()
    .from("approvals")
    .select("id, run_id, tool_name, args, reason, status, created_at, expires_at")
    .eq("run_id", runId)
    .eq("tool_name", toolName)
    .order("created_at", { ascending: false })
    .limit(1);

  return ((data ?? [])[0] as Approval) ?? null;
}

/**
 * Records the user's decision. Expired-at-decision-time approvals are stored
 * as expired (denied). Returns the effective status.
 */
export async function decideApproval(
  userId: string,
  id: string,
  decision: "approve" | "deny",
): Promise<{ status: ApprovalStatus; approval: (Approval & { user_id: string }) | null }> {
  const approval = await getApproval(id);
  if (!approval || approval.user_id !== userId) {
    return { status: "denied", approval: null };
  }

  const expired = approval.expires_at ? new Date(approval.expires_at).getTime() < Date.now() : false;
  const status: ApprovalStatus = expired ? "expired" : decision === "approve" ? "approved" : "denied";

  const { error } = await supabaseAdmin()
    .from("approvals")
    .update({ status, decided_at: new Date().toISOString() })
    .eq("id", id)
    .eq("user_id", userId)
    .eq("status", "pending");

  if (error) {
    console.warn("[approvals] could not record the decision:", error.message);
  }

  return { status, approval: { ...approval, status } };
}

export async function expireStaleApprovals(): Promise<void> {
  await supabaseAdmin()
    .from("approvals")
    .update({ status: "expired", decided_at: new Date().toISOString() })
    .eq("status", "pending")
    .lt("expires_at", new Date().toISOString());
}
