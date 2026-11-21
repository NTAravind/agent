import { z } from "zod";

/** Task lists — user-named containers for tasks. */
export const TaskListSchema = z.object({
  id: z.string().uuid(),
  userId: z.string().uuid(),
  name: z.string().min(1).max(80),
  sort: z.number().int().default(0),
  createdAt: z.string(),
});
export type TaskList = z.infer<typeof TaskListSchema>;

export const TaskListCreateSchema = z.object({
  name: z.string().min(1).max(80),
  sort: z.number().int().optional(),
});
export type TaskListCreate = z.infer<typeof TaskListCreateSchema>;

export const TaskListPatchSchema = z.object({
  name: z.string().min(1).max(80).optional(),
  sort: z.number().int().optional(),
});
export type TaskListPatch = z.infer<typeof TaskListPatchSchema>;

/** Tasks — hierarchical, with due/remind/recurrence. */
export const TaskStatusSchema = z.enum(["open", "done", "cancelled"]);
export type TaskStatus = z.infer<typeof TaskStatusSchema>;

export const TaskCreatedBySchema = z.enum(["user", "agent", "suggested"]);
export type TaskCreatedBy = z.infer<typeof TaskCreatedBySchema>;

export const TaskSchema = z.object({
  id: z.string().uuid(),
  userId: z.string().uuid(),
  listId: z.string().uuid(),
  parentId: z.string().uuid().nullable(),
  title: z.string().min(1).max(200),
  notes: z.string().nullable(),
  status: TaskStatusSchema,
  priority: z.number().int().default(0),
  dueAt: z.string().nullable(),
  dueAllDay: z.boolean().default(false),
  remindAt: z.string().nullable(),
  rrule: z.string().nullable(),
  completedAt: z.string().nullable(),
  createdBy: TaskCreatedBySchema,
  sourceRunId: z.string().uuid().nullable(),
  deletedAt: z.string().nullable(),
  createdAt: z.string(),
  updatedAt: z.string(),
});
export type Task = z.infer<typeof TaskSchema>;

export const TaskCreateSchema = z.object({
  listId: z.string().uuid(),
  parentId: z.string().uuid().optional(),
  title: z.string().min(1).max(200),
  notes: z.string().optional(),
  status: TaskStatusSchema.optional(),
  priority: z.number().int().min(0).max(3).optional(),
  dueAt: z.string().datetime({ offset: true }).optional(),
  dueAllDay: z.boolean().optional(),
  remindAt: z.string().datetime({ offset: true }).optional(),
  rrule: z.string().optional(),
  createdBy: TaskCreatedBySchema.optional(),
  sourceRunId: z.string().uuid().optional(),
});
export type TaskCreate = z.infer<typeof TaskCreateSchema>;

export const TaskPatchSchema = z.object({
  listId: z.string().uuid().optional(),
  parentId: z.string().uuid().nullable().optional(),
  title: z.string().min(1).max(200).optional(),
  notes: z.string().nullable().optional(),
  status: TaskStatusSchema.optional(),
  priority: z.number().int().min(0).max(3).optional(),
  dueAt: z.string().datetime({ offset: true }).nullable().optional(),
  dueAllDay: z.boolean().optional(),
  remindAt: z.string().datetime({ offset: true }).nullable().optional(),
  rrule: z.string().nullable().optional(),
});
export type TaskPatch = z.infer<typeof TaskPatchSchema>;

/** Calendar events — with recurrence and reminders. */
export const EventCreatedBySchema = z.enum(["user", "agent", "suggested"]);
export type EventCreatedBy = z.infer<typeof EventCreatedBySchema>;

export const EventReminderSchema = z.object({
  minutesBefore: z.number().int().min(0).max(10080), // up to 1 week
  method: z.enum(["push", "email"]).default("push"),
});
export type EventReminder = z.infer<typeof EventReminderSchema>;

export const CalendarEventSchema = z.object({
  id: z.string().uuid(),
  userId: z.string().uuid(),
  title: z.string().min(1).max(200),
  description: z.string().nullable(),
  startsAt: z.string(),
  endsAt: z.string(),
  allDay: z.boolean().default(false),
  tz: z.string().default("Asia/Kolkata"),
  location: z.string().nullable(),
  rrule: z.string().nullable(),
  exdates: z.array(z.string()).default([]),
  reminders: z.array(EventReminderSchema).default([]),
  createdBy: EventCreatedBySchema,
  sourceRunId: z.string().uuid().nullable(),
  icalUid: z.string().nullable(),
  deletedAt: z.string().nullable(),
  createdAt: z.string(),
  updatedAt: z.string(),
});
export type CalendarEvent = z.infer<typeof CalendarEventSchema>;

export const CalendarEventCreateSchema = z.object({
  title: z.string().min(1).max(200),
  description: z.string().optional(),
  startsAt: z.string().datetime({ offset: true }),
  endsAt: z.string().datetime({ offset: true }),
  allDay: z.boolean().optional(),
  tz: z.string().optional(),
  location: z.string().optional(),
  rrule: z.string().optional(),
  exdates: z.array(z.string()).optional(),
  reminders: z.array(EventReminderSchema).optional(),
  createdBy: EventCreatedBySchema.optional(),
  sourceRunId: z.string().uuid().optional(),
  icalUid: z.string().optional(),
}).refine((data) => new Date(data.startsAt) < new Date(data.endsAt), {
  message: "startsAt must be before endsAt",
  path: ["startsAt"],
});
export type CalendarEventCreate = z.infer<typeof CalendarEventCreateSchema>;

export const CalendarEventPatchSchema = z.object({
  title: z.string().min(1).max(200).optional(),
  description: z.string().nullable().optional(),
  startsAt: z.string().datetime({ offset: true }).optional(),
  endsAt: z.string().datetime({ offset: true }).optional(),
  allDay: z.boolean().optional(),
  tz: z.string().optional(),
  location: z.string().nullable().optional(),
  rrule: z.string().nullable().optional(),
  exdates: z.array(z.string()).optional(),
  reminders: z.array(EventReminderSchema).optional(),
}).refine(
  (data) => {
    if (data.startsAt && data.endsAt) {
      return new Date(data.startsAt) < new Date(data.endsAt);
    }
    return true;
  },
  { message: "startsAt must be before endsAt", path: ["startsAt"] }
);
export type CalendarEventPatch = z.infer<typeof CalendarEventPatchSchema>;

/** Push token registration. */
export const PushTokenSchema = z.object({
  id: z.string().uuid(),
  userId: z.string().uuid(),
  expoToken: z.string(),
  platform: z.enum(["ios", "android"]),
  lastSeen: z.string(),
});
export type PushToken = z.infer<typeof PushTokenSchema>;

export const PushTokenRegisterSchema = z.object({
  expoToken: z.string().min(1),
  platform: z.enum(["ios", "android"]),
});
export type PushTokenRegister = z.infer<typeof PushTokenRegisterSchema>;

/** Query params for expanded event listings. */
export const EventsRangeQuerySchema = z.object({
  from: z.string().datetime({ offset: true }).optional(),
  to: z.string().datetime({ offset: true }).optional(),
  listId: z.string().uuid().optional(),
  status: TaskStatusSchema.optional(),
});
export type EventsRangeQuery = z.infer<typeof EventsRangeQuerySchema>;