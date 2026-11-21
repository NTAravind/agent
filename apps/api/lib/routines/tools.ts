import { tool } from "ai";
import { z } from "zod";
import type { RoutineSchedule } from "@agent/shared";

import {
  activateRoutine,
  createRoutine,
  deleteRoutine,
  getRoutine,
  listRoutines,
  updateRoutine,
  withPreview,
} from "@/lib/routines/store";
import { computeNextRuns, DEFAULT_TIMEZONE, describeSchedule } from "@/lib/routines/schedule";

/**
 * Routine tools (Phase 10).
 *
 * The model describes *when* in a structured way ("every Monday at 09:00");
 * the server turns that into concrete instants in the user's timezone.
 * `userId`, `agentId` and `threadId` always come from the request/run
 * context — never from the model's arguments.
 */

export type RoutineToolContext = {
  userId: string;
  threadId?: string | null;
  agentId?: string | null;
  /** The user's timezone (the wall clock "09:00" refers to). */
  timeZone?: string;
};

const WEEKDAYS = ["MO", "TU", "WE", "TH", "FR", "SA", "SU"] as const;

/**
 * The schedule the model emits. `time` is the user's wall clock; for a
 * one-shot routine `run_at` (an absolute instant) may replace it.
 */
export const RoutineScheduleInputSchema = z
  .object({
    frequency: z.enum(["once", "daily", "weekly", "monthly"]),
    days_of_week: z.array(z.enum(WEEKDAYS)).max(7).optional(),
    day_of_month: z.number().int().min(1).max(28).optional(),
    time: z
      .string()
      .regex(/^([01]\d|2[0-3]):[0-5]\d$/, "time must be HH:mm")
      .optional(),
    run_at: z.string().datetime({ offset: true }).optional(),
  })
  .refine(
    (schedule) =>
      schedule.frequency === "once"
        ? Boolean(schedule.run_at ?? schedule.time)
        : Boolean(schedule.time),
    { message: "A recurring schedule needs a time (HH:mm); a one-shot needs run_at." },
  );

/**
 * Normalises the model's schedule into the stored shape: `time` is always
 * present (for a one-shot it is derived from `run_at`).
 */
export function normalizeSchedule(
  input: z.infer<typeof RoutineScheduleInputSchema>,
  timeZone: string,
): RoutineSchedule {
  if (input.frequency === "once") {
    const runAt = input.run_at;
    const time = input.time ?? (runAt ? timeOfDay(runAt, timeZone) : "09:00");
    return { frequency: "once", time, ...(runAt ? { run_at: runAt } : {}) };
  }
  return {
    frequency: input.frequency,
    time: input.time ?? "09:00",
    ...(input.days_of_week ? { days_of_week: input.days_of_week } : {}),
    ...(input.day_of_month ? { day_of_month: input.day_of_month } : {}),
  };
}

/** The "HH:mm" wall clock of an instant in a timezone. */
function timeOfDay(instant: string, timeZone: string): string {
  const parts = new Intl.DateTimeFormat("en-GB", {
    timeZone,
    hourCycle: "h23",
    hour: "2-digit",
    minute: "2-digit",
  }).formatToParts(new Date(instant));
  const get = (type: string) => parts.find((part) => part.type === type)?.value ?? "09";
  return `${get("hour")}:${get("minute")}`;
}

/* -------------------------------------------------------------------------- */
/* Tool implementations (shared by the chat route and the agent graph)         */
/* -------------------------------------------------------------------------- */

export const ROUTINE_TOOL_DESCRIPTIONS = {
  create_routine:
    "Propose a recurring task for the user. Describe WHEN in structured terms (never a cron string): frequency (once|daily|weekly|monthly), days_of_week for weekly, day_of_month for monthly, and time as the user's local HH:mm. The user confirms the proposal before anything is scheduled — do not claim it is already running.",
  list_routines: "List the user's routines with their schedule and next run.",
  update_routine:
    "Update one of the user's routines (name, prompt or schedule). Pass the full schedule when you change the timing.",
  pause_routine: "Pause a routine so it stops firing. It can be resumed later.",
  resume_routine: "Resume a paused routine.",
  delete_routine: "Delete a routine permanently.",
} as const;

export async function runRoutineTool(
  name: string,
  args: Record<string, unknown>,
  context: RoutineToolContext,
): Promise<unknown> {
  const timeZone = context.timeZone ?? DEFAULT_TIMEZONE;

  switch (name) {
    case "create_routine": {
      const parsed = z
        .object({
          name: z.string().min(1).max(120),
          prompt: z.string().min(1).max(4000),
          schedule: RoutineScheduleInputSchema,
          source_text: z.string().max(2000).optional(),
          approval_mode: z.enum(["queue", "deny"]).optional(),
        })
        .parse(args);

      if (!context.threadId) {
        return { failed: true, error: "This conversation has no thread to post to." };
      }

      const schedule = normalizeSchedule(parsed.schedule, timeZone);
      const routine = await createRoutine({
        userId: context.userId,
        agentId: context.agentId ?? null,
        threadId: context.threadId,
        name: parsed.name,
        prompt: parsed.prompt,
        schedule,
        tz: timeZone,
        sourceText: parsed.source_text ?? null,
        ...(parsed.approval_mode ? { approvalMode: parsed.approval_mode } : {}),
      });

      const preview = withPreview(routine);
      return {
        routineId: routine.id,
        status: routine.status,
        name: routine.name,
        prompt: routine.prompt,
        schedule: routine.schedule,
        scheduleLabel: preview.scheduleLabel,
        nextRuns: preview.nextRuns,
        tz: routine.tz,
        message:
          "Proposed. The user must confirm it in the app before the first run — do not tell them it is already scheduled.",
      };
    }

    case "list_routines": {
      const routines = await listRoutines(context.userId);
      return {
        routines: routines.slice(0, 50).map((routine) => {
          const preview = withPreview(routine);
          return {
            id: routine.id,
            name: routine.name,
            prompt: routine.prompt,
            status: routine.status,
            scheduleLabel: preview.scheduleLabel,
            nextRuns: preview.nextRuns,
          };
        }),
      };
    }

    case "update_routine": {
      const parsed = z
        .object({
          id: z.string().uuid(),
          name: z.string().min(1).max(120).optional(),
          prompt: z.string().min(1).max(4000).optional(),
          schedule: RoutineScheduleInputSchema.optional(),
        })
        .parse(args);

      const schedule = parsed.schedule
        ? normalizeSchedule(parsed.schedule, timeZone)
        : undefined;
      const updated = await updateRoutine(context.userId, parsed.id, {
        ...(parsed.name ? { name: parsed.name } : {}),
        ...(parsed.prompt ? { prompt: parsed.prompt } : {}),
        ...(schedule ? { schedule } : {}),
      });
      if (!updated) return { failed: true, error: "No such routine." };
      const preview = withPreview(updated);
      return {
        routineId: updated.id,
        name: updated.name,
        status: updated.status,
        scheduleLabel: preview.scheduleLabel,
        nextRuns: preview.nextRuns,
      };
    }

    case "pause_routine": {
      const parsed = z.object({ id: z.string().uuid() }).parse(args);
      const updated = await updateRoutine(context.userId, parsed.id, { status: "paused" });
      if (!updated) return { failed: true, error: "No such routine." };
      return { routineId: updated.id, status: updated.status };
    }

    case "resume_routine": {
      const parsed = z.object({ id: z.string().uuid() }).parse(args);
      const existing = await getRoutine(context.userId, parsed.id);
      if (!existing) return { failed: true, error: "No such routine." };
      const updated = await activateRoutine(context.userId, parsed.id);
      if (!updated) return { failed: true, error: "No such routine." };
      const preview = withPreview(updated);
      return {
        routineId: updated.id,
        status: updated.status,
        scheduleLabel: preview.scheduleLabel,
        nextRuns: preview.nextRuns,
      };
    }

    case "delete_routine": {
      const parsed = z.object({ id: z.string().uuid() }).parse(args);
      const deleted = await deleteRoutine(context.userId, parsed.id);
      if (!deleted) return { failed: true, error: "No such routine." };
      return { routineId: parsed.id, deleted: true };
    }

    default:
      throw new Error(`Unknown routine tool: ${name}`);
  }
}

/* -------------------------------------------------------------------------- */
/* Chat flavour: AI SDK tools with an execute function                        */
/* -------------------------------------------------------------------------- */

export function buildRoutineTools(context: RoutineToolContext) {
  const timeZone = context.timeZone ?? DEFAULT_TIMEZONE;

  const run = (name: string, args: Record<string, unknown>) =>
    runRoutineTool(name, args, context);

  return {
    create_routine: tool({
      description: ROUTINE_TOOL_DESCRIPTIONS.create_routine,
      inputSchema: z.object({
        name: z.string().min(1).max(120).describe("Short name, e.g. 'Monday task summary'."),
        prompt: z
          .string()
          .min(1)
          .max(4000)
          .describe("The instruction the agent follows on every run."),
        schedule: RoutineScheduleInputSchema.describe(
          "When to run, in the user's local time. Never a cron string.",
        ),
        source_text: z
          .string()
          .max(2000)
          .optional()
          .describe("The user's original wording, when the user phrased it as a sentence."),
        approval_mode: z
          .enum(["queue", "deny"])
          .optional()
          .describe("'queue' parks sensitive tool calls for approval; 'deny' auto-denies them."),
      }),
      execute: async (args) => run("create_routine", args as Record<string, unknown>),
    }),

    list_routines: tool({
      description: ROUTINE_TOOL_DESCRIPTIONS.list_routines,
      inputSchema: z.object({}),
      execute: async (args) => run("list_routines", args as Record<string, unknown>),
    }),

    update_routine: tool({
      description: ROUTINE_TOOL_DESCRIPTIONS.update_routine,
      inputSchema: z.object({
        id: z.string().uuid().describe("Routine id from list_routines."),
        name: z.string().min(1).max(120).optional(),
        prompt: z.string().min(1).max(4000).optional(),
        schedule: RoutineScheduleInputSchema.optional(),
      }),
      execute: async (args) => run("update_routine", args as Record<string, unknown>),
    }),

    pause_routine: tool({
      description: ROUTINE_TOOL_DESCRIPTIONS.pause_routine,
      inputSchema: z.object({ id: z.string().uuid().describe("Routine id.") }),
      execute: async (args) => run("pause_routine", args as Record<string, unknown>),
    }),

    resume_routine: tool({
      description: ROUTINE_TOOL_DESCRIPTIONS.resume_routine,
      inputSchema: z.object({ id: z.string().uuid().describe("Routine id.") }),
      execute: async (args) => run("resume_routine", args as Record<string, unknown>),
    }),

    delete_routine: tool({
      description: ROUTINE_TOOL_DESCRIPTIONS.delete_routine,
      inputSchema: z.object({ id: z.string().uuid().describe("Routine id.") }),
      execute: async (args) => run("delete_routine", args as Record<string, unknown>),
    }),
  };
}

/** The proposal payload the app renders as a card (also a UI data part). */
export function routineProposalPayload(routineId: string, output: unknown) {
  const payload = output as {
    routineId?: string;
    name?: string;
    prompt?: string;
    scheduleLabel?: string;
    nextRuns?: string[];
    tz?: string;
  };
  return {
    routineId: payload.routineId ?? routineId,
    name: payload.name ?? "Routine",
    prompt: payload.prompt ?? "",
    scheduleLabel: payload.scheduleLabel ?? "",
    nextRuns: payload.nextRuns ?? [],
    tz: payload.tz ?? DEFAULT_TIMEZONE,
    status: "draft",
  };
}

/** Exposed for the API routes: the next occurrences of a schedule. */
export function previewRuns(schedule: RoutineSchedule, timeZone: string, count = 3): string[] {
  return computeNextRuns(schedule, timeZone, new Date(), count);
}

/** Exposed for the API routes: the human-readable schedule. */
export function scheduleLabel(schedule: RoutineSchedule, timeZone: string): string {
  return describeSchedule(schedule, timeZone);
}
