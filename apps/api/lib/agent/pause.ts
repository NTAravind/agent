import { supabaseAdmin } from "@/lib/supabase/server";

/**
 * Pause/cancel checkpoints for the agent graphs.
 *
 * `POST /api/runs/:id/pause` (or an agent sleep) only flips the run's status
 * row — the graph notices at the next node boundary, because every node in
 * both graphs is wrapped with `assertRunActive`. Throwing here leaves the
 * LangGraph checkpoint before the node, so `run/resumed` continues from exactly
 * where the run stopped (`invoke(null)` re-runs the node that threw).
 *
 * These errors are control flow, not failures: `runAgent`/`runSupervisor`
 * catch them and return the status without touching `failed`/`finished_at`,
 * so the Inngest function succeeds and `onFailure` never fires.
 */

export class RunPausedError extends Error {
  constructor() {
    super("run paused");
    this.name = "RunPausedError";
  }
}

export class RunCancelledError extends Error {
  constructor() {
    super("run cancelled");
    this.name = "RunCancelledError";
  }
}

/** Throws when the run was paused or cancelled since the last node boundary. */
export async function assertRunActive(runId: string): Promise<void> {
  let status: string | undefined;
  try {
    const { data } = await supabaseAdmin()
      .from("agent_runs")
      .select("status")
      .eq("id", runId)
      .maybeSingle();
    status = (data as { status?: string } | null)?.status;
  } catch (error) {
    // A transient DB error must not kill the run — the graph keeps going and
    // the next node boundary retries the check.
    console.warn("[agent/pause] status check failed (continuing):", error);
    return;
  }
  if (status === "cancelled") throw new RunCancelledError();
  if (status === "paused") throw new RunPausedError();
}

/**
 * Ensures a run is `running` right before its graph is re-invoked: flips
 * paused → running, or accepts an already-running row (a concurrent resume
 * path got there first — e.g. the supervisor fallback re-enters runAgent).
 * Returns false when the run is no longer resumable (cancelled or finished
 * meanwhile) — the caller must not resurrect it.
 */
export async function beginResume(runId: string): Promise<boolean> {
  const { data } = await supabaseAdmin()
    .from("agent_runs")
    .update({ status: "running" })
    .eq("id", runId)
    .eq("status", "paused")
    .select("id");
  if (data?.length) return true;

  const { data: current } = await supabaseAdmin()
    .from("agent_runs")
    .select("status")
    .eq("id", runId)
    .maybeSingle();
  return (current as { status?: string } | null)?.status === "running";
}

/** True for the "thread has no checkpoint yet" error from `invoke(null)`. */
export function isEmptyThreadError(error: unknown): boolean {
  if (!(error instanceof Error)) return false;
  return (
    error.name === "EmptyInputError" || error.message.includes("Received no input writes")
  );
}
