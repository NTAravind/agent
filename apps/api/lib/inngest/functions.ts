import { step } from "inngest";

import { runAgent, resumeAgentRun } from "@/lib/agent/graph";
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

    return await step.run("execute-agent-graph", () => runAgent({ runId, userId, goal, preferredModel }));
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

export const functions = [
  keepalive,
  chatCompletedFunction,
  vaultChangedFunction,
  agentRunFunction,
  approvalResumeFunction,
  canvasRefreshFunction,
];
