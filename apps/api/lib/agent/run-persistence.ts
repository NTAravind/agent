import { upsertOwnedMessage } from "@/lib/chat/persist";
import { supabaseAdmin } from "@/lib/supabase/server";

export type OrdinaryRunMessageRow = {
  user_id?: string | null;
  thread_id?: string | null;
  agent_id?: string | null;
  group_id?: string | null;
  parent_run_id?: string | null;
  routine_id?: string | null;
};

/** Only a root ordinary run owns its visible final transcript message. */
export function shouldPersistOrdinaryRunResult(
  row: OrdinaryRunMessageRow | null,
): boolean {
  return Boolean(
    row?.user_id &&
      row.thread_id &&
      !row.group_id &&
      !row.parent_run_id &&
      !row.routine_id,
  );
}

/**
 * Posts a durable Task Mode result into its ordinary conversation.
 *
 * The run id doubles as the deterministic message id, making an Inngest retry
 * idempotent instead of duplicating the answer. Group runs, child runs and
 * routine runs are excluded because those paths own their visible transcript
 * messages.
 *
 * A failed write throws. The caller (an Inngest step) retries it; the answer
 * itself is already stored on the run row, so nothing is lost.
 */
export async function persistOrdinaryRunResult(
  runId: string,
  answer: string,
  model: string | null,
): Promise<void> {
  const { data } = await supabaseAdmin()
    .from("agent_runs")
    .select("user_id, thread_id, agent_id, group_id, parent_run_id, routine_id")
    .eq("id", runId)
    .maybeSingle();

  const row = data as OrdinaryRunMessageRow | null;

  if (!shouldPersistOrdinaryRunResult(row)) {
    return;
  }
  if (!row?.user_id || !row.thread_id) {
    return;
  }

  await upsertOwnedMessage({
    userId: row.user_id,
    threadId: row.thread_id,
    messageId: runId,
    role: "assistant",
    parts: [{ type: "text", text: answer }],
    model,
    fromAgentId: row.agent_id ?? null,
    runId,
  });
}

/**
 * Persists the finished answer of a run from its own row.
 *
 * The run row is the source of truth for the answer, so this step is safe to
 * retry: the transcript message id is the run id, which makes the write
 * idempotent. Runs that do not own a visible ordinary transcript (group runs,
 * child runs, routine runs, unfinished runs) are a no-op.
 *
 * Throws when the write fails so the caller's Inngest step can retry instead
 * of acknowledging a run whose answer never reached the conversation.
 */
export async function persistRunTranscript(runId: string): Promise<void> {
  const { data, error } = await supabaseAdmin()
    .from("agent_runs")
    .select(
      "user_id, thread_id, agent_id, group_id, parent_run_id, routine_id, status, model, result",
    )
    .eq("id", runId)
    .maybeSingle();

  if (error) {
    throw new Error(`Could not read the run for transcript persistence: ${error.message}`);
  }
  if (!data) return;

  const row = data as OrdinaryRunMessageRow & {
    status?: string | null;
    model?: string | null;
    result?: unknown;
  };

  if (row.status !== "succeeded") return;

  const answer =
    row.result && typeof row.result === "object"
      ? (row.result as { answer?: unknown }).answer
      : undefined;
  if (typeof answer !== "string" || answer.length === 0) return;

  await persistOrdinaryRunResult(runId, answer, row.model ?? null);
}
