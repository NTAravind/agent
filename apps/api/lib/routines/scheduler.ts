import type { Routine } from "@agent/shared";

import { insertMessage } from "@/lib/chat/persist";
import { inngest } from "@/lib/inngest/client";
import { agentRunRequested, chatCompleted } from "@/lib/inngest/events";
import { sendPush } from "@/lib/push";
import {
  advanceRoutine,
  listDueRoutines,
  recordRoutineFailure,
} from "@/lib/routines/store";
import { computeNextRuns } from "@/lib/routines/schedule";
import { supabaseAdmin } from "@/lib/supabase/server";

/**
 * The routine scheduler (Phase 10).
 *
 * A single `routine/tick` cron (every minute) picks up the routines whose
 * next run is due. For each one it creates the run row (idempotent through
 * the unique `(routine_id, scheduled_for)` index), inserts the trigger
 * message into the bound thread and hands the run to Inngest.
 *
 * Guardrails:
 * - Overlapping runs are skipped (the previous run is still going).
 * - A missed run fires once — the next run is computed from the *scheduled*
 *   instant, so the scheduler never backfills every missed occurrence.
 * - One-shot routines complete after firing.
 * - Three consecutive failures auto-pause the routine, with an explanation
 *   in the thread.
 */

/** Run statuses that mean "still going". */
const LIVE_RUN_STATUSES = ["queued", "running", "awaiting_approval"];

/** How many consecutive failures auto-pause a routine. */
export const MAX_CONSECUTIVE_FAILURES = 3;

export type RoutineTickResult = {
  due: number;
  fired: number;
  skipped: number;
  failed: number;
  errors: string[];
};

/** The trigger message part that marks a routine-fired message. */
export function routineTriggerPart(routine: Routine) {
  return {
    type: "routine-trigger",
    source: "routine",
    routine_id: routine.id,
    routine_name: routine.name,
  };
}

/** True when a message was inserted by a routine (never a human message). */
export function isRoutineTriggerMessage(parts: unknown): boolean {
  if (!Array.isArray(parts)) return false;
  return parts.some(
    (part) =>
      Boolean(part) &&
      typeof part === "object" &&
      (part as { type?: unknown }).type === "routine-trigger",
  );
}

/** The text a routine run posts when it finishes (or fails). */
export function routineResultText(routineName: string, answer: string): string {
  return `**${routineName}**\n\n${answer}`;
}

/**
 * Fires every routine that is due. Safe to call repeatedly: the unique
 * `(routine_id, scheduled_for)` index means an occurrence can only ever
 * create one run.
 */
export async function runRoutineTick(now = new Date()): Promise<RoutineTickResult> {
  const result: RoutineTickResult = {
    due: 0,
    fired: 0,
    skipped: 0,
    failed: 0,
    errors: [],
  };

  let due: Routine[];
  try {
    due = await listDueRoutines(now);
  } catch (error) {
    result.errors.push(error instanceof Error ? error.message : String(error));
    return result;
  }

  result.due = due.length;

  for (const routine of due) {
    try {
      const outcome = await fireRoutine(routine, now);
      if (outcome === "fired") result.fired += 1;
      else result.skipped += 1;
    } catch (error) {
      result.failed += 1;
      result.errors.push(
        `${routine.name}: ${error instanceof Error ? error.message : String(error)}`,
      );
    }
  }

  return result;
}

/**
 * Fires one routine: creates the run, posts the trigger message and queues
 * the run with Inngest.
 */
async function fireRoutine(
  routine: Routine,
  now: Date,
  options: { advance?: boolean; scheduledFor?: string; allowOverlap?: boolean } = {},
): Promise<"fired" | "skipped"> {
  const scheduledFor = options.scheduledFor ?? routine.nextRunAt ?? now.toISOString();
  const advance = options.advance !== false;

  // Overlap: the previous run is still going — skip this occurrence and say
  // so in the thread.
  if (!options.allowOverlap && (await hasLiveRun(routine.id))) {
    await insertMessage(
      routine.userId,
      routine.threadId,
      "assistant",
      [
        {
          type: "text",
          text: `Skipped the ${routine.name} run — the previous one is still going.`,
        },
        routineTriggerPart(routine),
      ],
      null,
    );
    if (advance) {
      await advanceRoutine(routine.id, {
        nextRunAt: nextOccurrence(routine, scheduledFor),
        lastRunAt: scheduledFor,
      });
    }
    return "skipped";
  }

  // The run row is the idempotency anchor: the unique (routine_id,
  // scheduled_for) index rejects a duplicate occurrence.
  const { data: run, error } = await supabaseAdmin()
    .from("agent_runs")
    .insert({
      user_id: routine.userId,
      goal: routine.prompt,
      thread_id: routine.threadId,
      agent_id: routine.agentId,
      routine_id: routine.id,
      scheduled_for: scheduledFor,
      status: "queued",
      model: null,
      tz: routine.tz,
    })
    .select("id")
    .single();

  if (error || !run) {
    // 23505 = unique violation → this occurrence already has a run.
    if (error && error.code === "23505") return "skipped";
    throw new Error(error?.message ?? "could not create the routine run");
  }

  // The trigger message: a user-role message marked as routine-sourced, so
  // the app renders a chip instead of a normal bubble.
  await insertMessage(
    routine.userId,
    routine.threadId,
    "user",
    [{ type: "text", text: routine.prompt }, routineTriggerPart(routine)],
    null,
  );

  // Advance the schedule from the *scheduled* instant — a missed occurrence
  // fires once and is never backfilled.
  const isOneShot = routine.schedule.frequency === "once";
  if (advance) {
    await advanceRoutine(routine.id, {
      nextRunAt: isOneShot ? null : nextOccurrence(routine, scheduledFor),
      lastRunAt: scheduledFor,
      ...(isOneShot ? { status: "completed" as const } : {}),
    });
  }

  try {
    await inngest.send(
      agentRunRequested.create({
        runId: run.id as string,
        userId: routine.userId,
        goal: routine.prompt,
        threadId: routine.threadId,
        ...(routine.agentId ? { agentId: routine.agentId } : {}),
        tz: routine.tz,
        routineId: routine.id,
        // A routine can opt out of the approval gate entirely: "deny"
        // auto-denies sensitive tool calls instead of parking the run.
        approvalMode: routine.approvalMode === "deny" ? "deny" : "gate",
      }),
    );
  } catch (error) {
    // The run could not be dispatched (Inngest unreachable). The occurrence
    // is consumed, so book it as a failure — the streak auto-pauses the
    // routine after three tries instead of silently retrying forever.
    console.warn("[routines] could not queue the routine run:", error);
    await handleRoutineOutcome(run.id as string, "failed");
  }

  return "fired";
}

/**
 * Runs a routine right now ("Run now" in the routine sheet).
 *
 * A manual run does not shift the schedule: the next regular occurrence
 * stays where it was. It is queued even when a previous run is still going —
 * the user asked for it explicitly.
 */
export async function runRoutineNow(
  routine: Routine,
  now = new Date(),
): Promise<{ runId: string | null; skipped: boolean }> {
  const before = await supabaseAdmin()
    .from("agent_runs")
    .select("id")
    .eq("routine_id", routine.id)
    .order("created_at", { ascending: false })
    .limit(1);

  const outcome = await fireRoutine(routine, now, {
    advance: false,
    scheduledFor: now.toISOString(),
    allowOverlap: true,
  });

  const after = await supabaseAdmin()
    .from("agent_runs")
    .select("id")
    .eq("routine_id", routine.id)
    .order("created_at", { ascending: false })
    .limit(1);

  const runId = ((after.data ?? []) as Array<{ id?: string }>)[0]?.id ?? null;
  const previousId = ((before.data ?? []) as Array<{ id?: string }>)[0]?.id ?? null;

  return { runId: runId && runId !== previousId ? runId : null, skipped: outcome === "skipped" };
}

/** The next occurrence after the one that just fired. */
function nextOccurrence(routine: Routine, scheduledFor: string): string | null {
  return computeNextRuns(routine.schedule, routine.tz, new Date(scheduledFor), 1)[0] ?? null;
}

/** True when a run for this routine is still queued, running or parked. */
async function hasLiveRun(routineId: string): Promise<boolean> {
  const { data } = await supabaseAdmin()
    .from("agent_runs")
    .select("id")
    .eq("routine_id", routineId)
    .in("status", LIVE_RUN_STATUSES)
    .limit(1);
  return Boolean(data?.length);
}

/**
 * Books the outcome of a routine run: resets the failure streak on success,
 * or counts the failure and auto-pauses after three.
 *
 * The user always learns what happened — the outcome is posted in the thread.
 */
export async function handleRoutineOutcome(
  runId: string,
  status: string,
): Promise<void> {
  const { data: run } = await supabaseAdmin()
    .from("agent_runs")
    .select("id, user_id, thread_id, routine_id, result")
    .eq("id", runId)
    .maybeSingle();

  const row = run as {
    user_id: string;
    thread_id: string | null;
    routine_id: string | null;
    result?: { answer?: string } | null;
  } | null;

  if (!row?.routine_id) return;

  const { data: routineRow } = await supabaseAdmin()
    .from("routines")
    .select("id, user_id, name, thread_id, approval_mode")
    .eq("id", row.routine_id)
    .maybeSingle();

  const routine = routineRow as {
    id: string;
    user_id: string;
    name: string;
    thread_id: string;
    approval_mode: string;
  } | null;

  if (!routine) return;
  const threadId = row.thread_id ?? routine.thread_id;

  if (status === "succeeded") {
    await supabaseAdmin()
      .from("routines")
      .update({ consecutive_failures: 0 })
      .eq("id", routine.id);

    const answer = row.result?.answer;
    if (answer) {
      await insertMessage(
        routine.user_id,
        threadId,
        "assistant",
        [{ type: "text", text: routineResultText(routine.name, answer) }],
        null,
      );
    }

    // Memory extraction runs like any other conversation — the trigger
    // message itself is skipped by the extractor.
    try {
      await inngest.send(
        chatCompleted.create({
          threadId,
          userId: routine.user_id,
          messageId: `routine-${routine.id}`,
        }),
      );
    } catch (error) {
      console.warn("[routines] could not queue memory extraction:", error);
    }

    await sendPush(routine.user_id, [
      {
        title: routine.name,
        body: answer ? answer.slice(0, 120) : "The routine finished.",
        data: {
          type: "routine",
          routineId: routine.id,
          threadId,
          url: `/chat?threadId=${threadId}`,
        },
      },
    ]);
    return;
  }

  if (status === "failed") {
    const failures = await recordRoutineFailure(routine.id);
    const paused = failures >= MAX_CONSECUTIVE_FAILURES;

    await insertMessage(
      routine.user_id,
      threadId,
      "assistant",
      [
        {
          type: "text",
          text: paused
            ? `The ${routine.name} routine failed ${failures} times in a row — it has been paused. Fix it from the Routines screen, then resume it.`
            : `The ${routine.name} routine failed (attempt ${failures} of ${MAX_CONSECUTIVE_FAILURES}). It will try again next time.`,
        },
        routineTriggerPart({ id: routine.id, name: routine.name } as Routine),
      ],
      null,
    );

    if (paused) {
      await advanceRoutine(routine.id, {
        nextRunAt: null,
        lastRunAt: new Date().toISOString(),
        status: "paused",
        consecutiveFailures: failures,
      });
    }

    await sendPush(routine.user_id, [
      {
        title: `${routine.name} failed`,
        body: paused ? "The routine has been paused." : "The routine run failed.",
        data: {
          type: "routine",
          routineId: routine.id,
          threadId,
          url: `/chat?threadId=${threadId}`,
        },
      },
    ]);
  }
}
