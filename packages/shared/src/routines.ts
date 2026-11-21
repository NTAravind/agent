import { z } from "zod";

/**
 * Routines (Phase 10): a scheduled prompt bound to an agent and a thread.
 *
 * The model never supplies dates. It supplies a *structured* schedule, and
 * the server converts it to an RRULE in the user's timezone and computes the
 * next occurrences. `time` is always the user's wall-clock time ("09:00").
 */

export const WeekdaySchema = z.enum(["MO", "TU", "WE", "TH", "FR", "SA", "SU"]);
export type Weekday = z.infer<typeof WeekdaySchema>;

export const RoutineFrequencySchema = z.enum(["once", "daily", "weekly", "monthly"]);
export type RoutineFrequency = z.infer<typeof RoutineFrequencySchema>;

export const RoutineStatusSchema = z.enum(["draft", "active", "paused", "completed"]);
export type RoutineStatus = z.infer<typeof RoutineStatusSchema>;

/** "queue" parks the run on an approval card; "deny" auto-denies sensitive calls. */
export const RoutineApprovalModeSchema = z.enum(["queue", "deny"]);
export type RoutineApprovalMode = z.infer<typeof RoutineApprovalModeSchema>;

export const RoutineScheduleSchema = z.object({
  frequency: RoutineFrequencySchema,
  /** Weekly only. Defaults to the current day when omitted. */
  days_of_week: z.array(WeekdaySchema).max(7).optional(),
  /** Monthly only (1-28, so every month has that day). */
  day_of_month: z.number().int().min(1).max(28).optional(),
  /** User-local wall clock, "HH:mm" (24h). */
  time: z.string().regex(/^([01]\d|2[0-3]):[0-5]\d$/, "time must be HH:mm"),
  /** "once" only — ISO 8601 instant the routine should fire at. */
  run_at: z.string().datetime({ offset: true }).optional(),
});
export type RoutineSchedule = z.infer<typeof RoutineScheduleSchema>;

export const RoutineSchema = z.object({
  id: z.string().uuid(),
  userId: z.string().uuid(),
  agentId: z.string().uuid().nullable(),
  threadId: z.string().uuid(),
  name: z.string().min(1).max(120),
  prompt: z.string().min(1).max(4000),
  schedule: RoutineScheduleSchema,
  /** RRULE for recurring routines (null for one-shot). */
  rrule: z.string().nullable(),
  tz: z.string().default("Asia/Kolkata"),
  sourceText: z.string().nullable(),
  status: RoutineStatusSchema,
  approvalMode: RoutineApprovalModeSchema,
  nextRunAt: z.string().nullable(),
  lastRunAt: z.string().nullable(),
  consecutiveFailures: z.number().int().default(0),
  createdAt: z.string(),
  updatedAt: z.string(),
});
export type Routine = z.infer<typeof RoutineSchema>;

/** A routine plus the computed preview the UI shows (next 3 runs). */
export const RoutineWithPreviewSchema = RoutineSchema.extend({
  /** Human-readable schedule, e.g. "Every Monday at 09:00". */
  scheduleLabel: z.string(),
  /** The next occurrences (ISO 8601, UTC), up to 3. */
  nextRuns: z.array(z.string()),
});
export type RoutineWithPreview = z.infer<typeof RoutineWithPreviewSchema>;

export const RoutineCreateSchema = z.object({
  agentId: z.string().uuid().optional(),
  threadId: z.string().uuid().optional(),
  name: z.string().min(1).max(120),
  prompt: z.string().min(1).max(4000),
  schedule: RoutineScheduleSchema,
  tz: z.string().optional(),
  sourceText: z.string().max(2000).optional(),
  approvalMode: RoutineApprovalModeSchema.optional(),
});
export type RoutineCreate = z.infer<typeof RoutineCreateSchema>;

export const RoutinePatchSchema = z.object({
  name: z.string().min(1).max(120).optional(),
  prompt: z.string().min(1).max(4000).optional(),
  schedule: RoutineScheduleSchema.optional(),
  tz: z.string().optional(),
  approvalMode: RoutineApprovalModeSchema.optional(),
  status: RoutineStatusSchema.optional(),
});
export type RoutinePatch = z.infer<typeof RoutinePatchSchema>;

/** A run triggered by a routine. */
export const RoutineRunSchema = z.object({
  id: z.string().uuid(),
  routineId: z.string().uuid().nullable(),
  goal: z.string(),
  status: z.string(),
  model: z.string().nullable(),
  tokensUsed: z.number().int().default(0),
  scheduledFor: z.string().nullable(),
  createdAt: z.string(),
  finishedAt: z.string().nullable(),
});
export type RoutineRun = z.infer<typeof RoutineRunSchema>;
