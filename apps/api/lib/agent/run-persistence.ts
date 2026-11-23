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
 */
export async function persistOrdinaryRunResult(
  runId: string,
  answer: string,
  model: string | null,
): Promise<void> {
  try {
    const { data } = await supabaseAdmin()
      .from("agent_runs")
      .select(
        "user_id, thread_id, agent_id, group_id, parent_run_id, routine_id",
      )
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
  } catch (error) {
    // The run itself has already succeeded. A transcript write failure must
    // not turn that completed run into a failed one.
    console.warn("[agent] could not persist the final task message:", error);
  }
}
