import { step } from "inngest";

import { inngest } from "@/lib/inngest/client";
import { chatCompleted, vaultChanged } from "@/lib/inngest/events";
import { extractMemories } from "@/lib/memory/extract";
import { supabaseAdmin } from "@/lib/supabase/server";
import { syncVault } from "@/lib/vault/sync";

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

export const functions = [keepalive, chatCompletedFunction, vaultChangedFunction];
