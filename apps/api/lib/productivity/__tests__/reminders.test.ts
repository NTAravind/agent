import assert from "node:assert/strict";
import { test } from "node:test";

import { computeDueReminders, type EventRow } from "../../reminders";

const NOW = new Date("2026-11-21T10:00:00.000Z"); // 15:30 IST

function task(overrides: Partial<Parameters<typeof computeDueReminders>[0][number]> = {}) {
  return {
    id: "task-1",
    user_id: "user-1",
    title: "Ship Phase 9",
    notes: null,
    status: "open",
    due_at: "2026-11-21T09:30:00.000Z",
    due_all_day: false,
    remind_at: "2026-11-21T09:00:00.000Z",
    rrule: null,
    reminded_at: null,
    ...overrides,
  };
}

function event(overrides: Partial<EventRow> = {}): EventRow {
  return {
    id: "event-1",
    user_id: "user-1",
    title: "Standup",
    starts_at: "2026-11-21T11:00:00.000Z",
    ends_at: "2026-11-21T11:30:00.000Z",
    all_day: false,
    rrule: null,
    exdates: [],
    reminders: [{ minutesBefore: 15, method: "push" }],
    ...overrides,
  };
}

test("a task reminder fires once its remind_at has passed", () => {
  const due = computeDueReminders([task()], [], NOW);
  assert.equal(due.length, 1);
  assert.equal(due[0]?.itemType, "task");
  assert.equal(due[0]?.title, "Ship Phase 9");
  assert.equal(due[0]?.url, "/");
});

test("a task reminder that is not yet due is not sent", () => {
  const due = computeDueReminders(
    [task({ remind_at: "2026-11-21T10:00:01.000Z" })],
    [],
    NOW,
  );
  assert.equal(due.length, 0);
});

test("an event reminder fires minutesBefore the start", () => {
  // NOW is 10:00 UTC; the event starts at 10:10, so its 15-minute reminder
  // (09:55) is due.
  const due = computeDueReminders(
    [],
    [event({ starts_at: "2026-11-21T10:10:00.000Z", ends_at: "2026-11-21T10:40:00.000Z" })],
    NOW,
  );
  assert.equal(due.length, 1);
  assert.equal(due[0]?.itemType, "event");
  assert.equal(due[0]?.remindAt.toISOString(), "2026-11-21T09:55:00.000Z");
  assert.equal(due[0]?.url, "/calendar");
});

test("an event without reminders never fires", () => {
  const due = computeDueReminders([], [event({ reminders: [] })], NOW);
  assert.equal(due.length, 0);
});

test("an event reminder before the window has not fired yet", () => {
  const due = computeDueReminders(
    [],
    [event({ starts_at: "2026-11-21T12:00:00.000Z", reminders: [{ minutesBefore: 60 }] })],
    NOW,
  );
  assert.equal(due.length, 0);
});

test("a recurring weekly event produces one reminder per due occurrence", () => {
  const due = computeDueReminders(
    [],
    [
      event({
        starts_at: "2026-11-16T11:00:00.000Z", // Monday 16:30 IST
        rrule: "FREQ=WEEKLY;BYDAY=MO",
        reminders: [{ minutesBefore: 0 }],
      }),
    ],
    new Date("2026-11-21T10:00:00.000Z"),
  );
  // Occurrences on 16 Nov and 23 Nov — only the first has passed.
  assert.equal(due.length, 1);
  assert.equal(due[0]?.remindAt.toISOString(), "2026-11-16T11:00:00.000Z");
});

test("each reminder carries the exact time it was scheduled for", () => {
  const due = computeDueReminders(
    [],
    [event({ starts_at: "2026-11-21T10:10:00.000Z", ends_at: "2026-11-21T10:40:00.000Z" })],
    NOW,
  );
  assert.equal(due[0]?.remindAt.getTime(), Date.parse("2026-11-21T09:55:00.000Z"));
});
