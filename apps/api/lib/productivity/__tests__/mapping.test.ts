import assert from "node:assert/strict";
import { test } from "node:test";

import {
  eventInsert,
  eventUpdate,
  rowToEvent,
  rowToTask,
  rowToTaskList,
  taskInsert,
  taskUpdate,
  type EventRow,
  type TaskListRow,
  type TaskRow,
} from "../../productivity";

const TASK_ROW: TaskRow = {
  id: "11111111-1111-4111-8111-111111111111",
  user_id: "22222222-2222-4222-8222-222222222222",
  list_id: "33333333-3333-4333-8333-333333333333",
  parent_id: null,
  title: "Ship Phase 9",
  notes: null,
  status: "open",
  priority: 2,
  due_at: "2026-11-25T03:30:00.000Z",
  due_all_day: false,
  remind_at: null,
  rrule: null,
  completed_at: null,
  created_by: "agent",
  source_run_id: "44444444-4444-4444-8444-444444444444",
  deleted_at: null,
  created_at: "2026-11-21T10:00:00.000Z",
  updated_at: "2026-11-21T10:00:00.000Z",
};

test("a task row maps to the camelCase API shape", () => {
  const task = rowToTask(TASK_ROW);
  assert.equal(task.userId, TASK_ROW.user_id);
  assert.equal(task.listId, TASK_ROW.list_id);
  assert.equal(task.dueAt, TASK_ROW.due_at);
  assert.equal(task.dueAllDay, false);
  assert.equal(task.createdBy, "agent");
  assert.equal(task.sourceRunId, TASK_ROW.source_run_id);
  assert.equal(task.parentId, null);
});

test("a task insert uses database column names", () => {
  const payload = taskInsert({
    userId: "u",
    listId: "l",
    title: "Buy milk",
    dueAt: "2026-11-25T03:30:00.000Z",
    priority: 1,
    createdBy: "agent",
    sourceRunId: "r",
  });
  assert.equal(payload.user_id, "u");
  assert.equal(payload.list_id, "l");
  assert.equal(payload.due_at, "2026-11-25T03:30:00.000Z");
  assert.equal(payload.created_by, "agent");
  assert.equal(payload.source_run_id, "r");
  assert.equal(payload.status, "open");
  // camelCase keys must never leak into the database payload.
  assert.equal("dueAt" in payload, false);
  assert.equal("listId" in payload, false);
});

test("a task update only touches the fields it was given", () => {
  const payload = taskUpdate({ title: "Renamed", status: "done" });
  assert.deepEqual(payload, { title: "Renamed", status: "done" });
  assert.equal("due_at" in payload, false);
});

test("a task update can clear a due date", () => {
  const payload = taskUpdate({ dueAt: null });
  assert.equal("due_at" in payload, true);
  assert.equal(payload.due_at, null);
});

test("a task list row maps to the camelCase API shape", () => {
  const list = rowToTaskList({
    id: "l1",
    user_id: "u1",
    name: "Inbox",
    sort: 0,
    created_at: "2026-11-21T10:00:00.000Z",
  } satisfies TaskListRow);
  assert.equal(list.userId, "u1");
  assert.equal(list.name, "Inbox");
});

test("an event row maps to the camelCase API shape", () => {
  const row: EventRow = {
    id: "e1",
    user_id: "u1",
    title: "Standup",
    description: null,
    starts_at: "2026-11-23T04:30:00.000Z",
    ends_at: "2026-11-23T05:00:00.000Z",
    all_day: false,
    tz: "Asia/Kolkata",
    location: null,
    rrule: "FREQ=WEEKLY;BYDAY=MO",
    exdates: [],
    reminders: [{ minutesBefore: 15, method: "push" }],
    created_by: "user",
    source_run_id: null,
    ical_uid: null,
    deleted_at: null,
    created_at: "2026-11-21T10:00:00.000Z",
    updated_at: "2026-11-21T10:00:00.000Z",
  };
  const event = rowToEvent(row);
  assert.equal(event.startsAt, row.starts_at);
  assert.equal(event.endsAt, row.ends_at);
  assert.equal(event.allDay, false);
  assert.equal(event.tz, "Asia/Kolkata");
  assert.equal(event.rrule, "FREQ=WEEKLY;BYDAY=MO");
  assert.equal(event.reminders[0]?.minutesBefore, 15);
});

test("an event insert defaults to the IST timezone and no recurrence", () => {
  const payload = eventInsert({
    userId: "u",
    title: "Standup",
    startsAt: "2026-11-23T04:30:00.000Z",
    endsAt: "2026-11-23T05:00:00.000Z",
  });
  assert.equal(payload.tz, "Asia/Kolkata");
  assert.equal(payload.rrule, null);
  assert.equal(payload.all_day, false);
  assert.deepEqual(payload.exdates, []);
  assert.equal("startsAt" in payload, false);
});

test("an event update only touches the fields it was given", () => {
  const payload = eventUpdate({ title: "Renamed" });
  assert.deepEqual(payload, { title: "Renamed" });
});
