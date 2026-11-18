import { step } from "inngest";

import { resumeAgentRun } from "@/lib/agent/graph";
import { executeRun } from "@/lib/agent/execute";
import { failRun } from "@/lib/agent/runs";
import { inngest } from "@/lib/inngest/client";
import { agentRunRequested, approvalDecided, canvasRefreshRequested, chatCompleted, vaultChanged } from "@/lib/inngest/events";
import { extractMemories } from "@/lib/memory/extract";
import { supabaseAdmin } from "@/lib/supabase/server";
import { syncVault } from "@/lib/vault/sync";
import { refreshCanvas } from "@/lib/canvases";

/**
 * Optional belt-and-braces keepalive. The primary Supabase keepalive is the
 * GitHub Actions cron in .github/workflows/keepalive.yml (free, does not
 * consume Inngest quota). This one also verifies the service-role key.
 */
export const keepalive = inngest.createFunction(
  {
    id: "system-keepalive",
    retries: 2,
    triggers: { cron: "0 6 * * *" },
  },
  async () => {
    const { error } = await supabaseAdmin().from("threads").select("id").limit(1);
    if (error) {
      throw new Error(`Supabase keepalive failed: ${error.message}`);
    }
    return { ok: true, at: new Date().toISOString() };
  },
);

/**
 * Runs after a conversation finishes: extracts durable memories.
 */
export const chatCompletedFunction = inngest.createFunction(
  {
    id: "chat-completed-memory",
    retries: 2,
    triggers: { event: chatCompleted },
  },
  async ({ event }) => {
    const { userId, threadId } = event.data;

    return await step.run("extract-memories", () => extractMemories(userId, threadId));
  },
);

/**
 * Re-indexes the GitHub vault after a push.
 */
export const vaultChangedFunction = inngest.createFunction(
  {
    id: "vault-changed-sync",
    retries: 2,
    // One vault sync at a time (the whole index is rebuilt in one pass).
    concurrency: { limit: 1, key: "'vault-sync'" },
    triggers: { event: vaultChanged },
  },
  async ({ event }) => {
    const { userId } = event.data;

    return await step.run("sync-vault", () => syncVault(userId));
  },
);

/**
 * Executes an agent run in durable steps. The graph itself is checkpointed to
 * Postgres after every node, so if the serverless invocation dies mid-run the
 * Inngest retry resumes from the last checkpoint instead of restarting.
 */
export const agentRunFunction = inngest.createFunction(
  {
    id: "agent-run",
    retries: 3,
    triggers: { event: agentRunRequested },
    onFailure: async ({ event, error }) => {
      const data = (event as { data?: { runId?: string } }).data;
      if (data?.runId) {
        await failRun(data.runId, error instanceof Error ? error.message : String(error));
      }
    },
  },
  async ({ event }) => {
    const { runId, userId, goal, preferredModel } = event.data;

    return await step.run("execute-agent-graph", () => executeRun({ runId, userId, goal, preferredModel }));
  },
);

/**
 * Resumes a run parked on an approval decision (LangGraph interrupt →
 * Command({ resume })). The graph continues from the tool gate.
 */
export const approvalResumeFunction = inngest.createFunction(
  {
    id: "approval-resume",
    retries: 3,
    triggers: { event: approvalDecided },
    onFailure: async ({ event, error }) => {
      const data = (event as { data?: { runId?: string } }).data;
      if (data?.runId) {
        await failRun(data.runId, error instanceof Error ? error.message : String(error));
      }
    },
  },
  async ({ event }) => {
    const { runId, userId } = event.data;

    return await step.run("resume-agent-graph", () => resumeAgentRun({ runId, userId }));
  },
);

/**
 * Re-runs the data sources of every data-bound canvas (no LLM) so the
 * dashboards stay current. Daily cron per API_SPEC.md section 7.
 */
export const canvasRefreshFunction = inngest.createFunction(
  {
    id: "canvas-refresh",
    retries: 2,
    triggers: { cron: "10 6 * * *" },
  },
  async () => {
    const { data, error } = await supabaseAdmin()
      .from("canvases")
      .select("id, user_id, title, spec, data_sources, version, created_by_run, created_at, updated_at")
      .not("data_sources", "eq", "[]")
      .limit(200);

    if (error || !data) {
      return { refreshed: 0, failed: 0 };
    }

    let refreshed = 0;
    let failed = 0;
    for (const canvas of data) {
      try {
        await step.run(`refresh-canvas-${canvas.id}`, async () =>
          refreshCanvas(canvas.user_id, canvas as Parameters<typeof refreshCanvas>[1]),
        );
        refreshed += 1;
      } catch {
        failed += 1;
      }
    }

    return { refreshed, failed };
  },
);

/**
 * Daily MCP marketplace sync: health-checks every connected integration,
 * re-runs the handshake (which also lazily refreshes expiring OAuth tokens
 * via getFreshAccessToken → auth()), and re-discovers tools so schema drift
 * is picked up. Batched at 25 connections per run (single-user product).
 *
 * Approval resume for MCP tools needs NO separate function: they reuse the
 * shared `approvals` table + approval/decided → approval-resume path.
 */
export const mcpSyncFunction = inngest.createFunction(
  {
    id: "mcp-sync",
    retries: 2,
    triggers: { cron: "30 4 * * *" },
    // Never overlap syncs (they write the same tool catalog rows).
    concurrency: { limit: 1 },
  },
  async () => {
    const { data: connections, error } = await supabaseAdmin()
      .from("user_mcp_connections")
      .select("id, user_id, mcp_server_id, status, metadata")
      .eq("status", "connected")
      .limit(25);

    if (error || !connections?.length) {
      return { checked: 0, ok: 0, failed: 0 };
    }

    let ok = 0;
    let failed = 0;

    for (const connection of connections) {
      try {
        await step.run(`mcp-sync-${connection.id}`, async () => {
          const { refreshProvider } = await import("@/lib/mcp/providers");
          await refreshProvider({
            userId: connection.user_id as string,
            connectionId: connection.id as string,
          });
        });
        ok += 1;
      } catch (syncError) {
        failed += 1;
        const { redactSecrets } = await import("@/lib/mcp/security/redact-secrets");
        const message = redactSecrets(
          syncError instanceof Error ? syncError.message : String(syncError),
        );
        const needsReconnect = /\b(401|403|unauthorized|invalid_grant|expired|reconnect)\b/i.test(
          message,
        );
        await supabaseAdmin()
          .from("user_mcp_connections")
          .update({
            status: needsReconnect ? "expired" : "error",
            last_checked_at: new Date().toISOString(),
            metadata: {
              ...((connection.metadata as Record<string, unknown>) ?? {}),
              lastError: message.slice(0, 300),
              lastErrorAt: new Date().toISOString(),
            },
          })
          .eq("id", connection.id);
      }
    }

    return { checked: connections.length, ok, failed };
  },
);

export const functions = [
  keepalive,
  chatCompletedFunction,
  vaultChangedFunction,
  agentRunFunction,
  approvalResumeFunction,
  canvasRefreshFunction,
  mcpSyncFunction,
];
