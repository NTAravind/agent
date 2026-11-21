import type { CalendarEvent, Task, TaskList } from "@agent/shared";

/**
 * Row ↔ API mapping for tasks, lists and events.
 *
 * The database uses snake_case columns; the API (and the shared zod
 * schemas) use camelCase. Every read/write goes through these mappers so
 * the two can never drift.
 */

export type TaskListRow = {
  id: string;
  user_id: string;
  name: string;
  sort: number;
  created_at: string;
};

export type TaskRow = {
  id: string;
  user_id: string;
  list_id: string;
  parent_id: string | null;
  title: string;
  notes: string | null;
  status: string;
  priority: number;
  due_at: string | null;
  due_all_day: boolean;
  remind_at: string | null;
  rrule: string | null;
  completed_at: string | null;
  created_by: string;
  source_run_id: string | null;
  deleted_at: string | null;
  reminded_at?: string | null;
  created_at: string;
  updated_at: string;
};

export type EventRow = {
  id: string;
  user_id: string;
  title: string;
  description: string | null;
  starts_at: string;
  ends_at: string;
  all_day: boolean;
  tz: string;
  location: string | null;
  rrule: string | null;
  exdates: string[];
  reminders: unknown;
  created_by: string;
  source_run_id: string | null;
  ical_uid: string | null;
  deleted_at: string | null;
  created_at: string;
  updated_at: string;
};

export function rowToTaskList(row: TaskListRow): TaskList {
  return {
    id: row.id,
    userId: row.user_id,
    name: row.name,
    sort: row.sort,
    createdAt: row.created_at,
  };
}

export function rowToTask(row: TaskRow): Task {
  return {
    id: row.id,
    userId: row.user_id,
    listId: row.list_id,
    parentId: row.parent_id,
    title: row.title,
    notes: row.notes,
    status: row.status as Task["status"],
    priority: row.priority,
    dueAt: row.due_at,
    dueAllDay: row.due_all_day,
    remindAt: row.remind_at,
    rrule: row.rrule,
    completedAt: row.completed_at,
    createdBy: row.created_by as Task["createdBy"],
    sourceRunId: row.source_run_id,
    deletedAt: row.deleted_at,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
}

export function rowToEvent(row: EventRow): CalendarEvent {
  return {
    id: row.id,
    userId: row.user_id,
    title: row.title,
    description: row.description,
    startsAt: row.starts_at,
    endsAt: row.ends_at,
    allDay: row.all_day,
    tz: row.tz,
    location: row.location,
    rrule: row.rrule,
    exdates: row.exdates ?? [],
    reminders: (row.reminders ?? []) as CalendarEvent["reminders"],
    createdBy: row.created_by as CalendarEvent["createdBy"],
    sourceRunId: row.source_run_id,
    icalUid: row.ical_uid,
    deletedAt: row.deleted_at,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
}

/** Insert payload for a new task (DB column names). */
export function taskInsert(input: {
  userId: string;
  listId: string;
  parentId?: string | null;
  title: string;
  notes?: string | null;
  status?: string;
  priority?: number;
  dueAt?: string | null;
  dueAllDay?: boolean;
  remindAt?: string | null;
  rrule?: string | null;
  createdBy?: string;
  sourceRunId?: string | null;
}): Record<string, unknown> {
  return {
    user_id: input.userId,
    list_id: input.listId,
    parent_id: input.parentId ?? null,
    title: input.title,
    notes: input.notes ?? null,
    status: input.status ?? "open",
    priority: input.priority ?? 0,
    due_at: input.dueAt ?? null,
    due_all_day: input.dueAllDay ?? false,
    remind_at: input.remindAt ?? null,
    rrule: input.rrule ?? null,
    created_by: input.createdBy ?? "user",
    source_run_id: input.sourceRunId ?? null,
  };
}

/** Update payload for a task (DB column names), omitting undefined fields. */
export function taskUpdate(input: {
  listId?: string;
  parentId?: string | null;
  title?: string;
  notes?: string | null;
  status?: string;
  priority?: number;
  dueAt?: string | null;
  dueAllDay?: boolean;
  remindAt?: string | null;
  rrule?: string | null;
}): Record<string, unknown> {
  const patch: Record<string, unknown> = {};
  if (input.listId !== undefined) patch.list_id = input.listId;
  if (input.parentId !== undefined) patch.parent_id = input.parentId;
  if (input.title !== undefined) patch.title = input.title;
  if (input.notes !== undefined) patch.notes = input.notes;
  if (input.status !== undefined) patch.status = input.status;
  if (input.priority !== undefined) patch.priority = input.priority;
  if (input.dueAt !== undefined) patch.due_at = input.dueAt;
  if (input.dueAllDay !== undefined) patch.due_all_day = input.dueAllDay;
  if (input.remindAt !== undefined) patch.remind_at = input.remindAt;
  if (input.rrule !== undefined) patch.rrule = input.rrule;
  return patch;
}

/** Insert payload for a new calendar event (DB column names). */
export function eventInsert(input: {
  userId: string;
  title: string;
  description?: string | null;
  startsAt: string;
  endsAt: string;
  allDay?: boolean;
  tz?: string;
  location?: string | null;
  rrule?: string | null;
  exdates?: string[];
  reminders?: unknown;
  createdBy?: string;
  sourceRunId?: string | null;
  icalUid?: string | null;
}): Record<string, unknown> {
  return {
    user_id: input.userId,
    title: input.title,
    description: input.description ?? null,
    starts_at: input.startsAt,
    ends_at: input.endsAt,
    all_day: input.allDay ?? false,
    tz: input.tz ?? "Asia/Kolkata",
    location: input.location ?? null,
    rrule: input.rrule ?? null,
    exdates: input.exdates ?? [],
    reminders: input.reminders ?? [],
    created_by: input.createdBy ?? "user",
    source_run_id: input.sourceRunId ?? null,
    ical_uid: input.icalUid ?? null,
  };
}

/** Update payload for a calendar event (DB column names). */
export function eventUpdate(input: {
  title?: string;
  description?: string | null;
  startsAt?: string;
  endsAt?: string;
  allDay?: boolean;
  tz?: string;
  location?: string | null;
  rrule?: string | null;
  exdates?: string[];
  reminders?: unknown;
}): Record<string, unknown> {
  const patch: Record<string, unknown> = {};
  if (input.title !== undefined) patch.title = input.title;
  if (input.description !== undefined) patch.description = input.description;
  if (input.startsAt !== undefined) patch.starts_at = input.startsAt;
  if (input.endsAt !== undefined) patch.ends_at = input.endsAt;
  if (input.allDay !== undefined) patch.all_day = input.allDay;
  if (input.tz !== undefined) patch.tz = input.tz;
  if (input.location !== undefined) patch.location = input.location;
  if (input.rrule !== undefined) patch.rrule = input.rrule;
  if (input.exdates !== undefined) patch.exdates = input.exdates;
  if (input.reminders !== undefined) patch.reminders = input.reminders;
  return patch;
}
