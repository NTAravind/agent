import { buildRRuleSet } from "@/lib/recurrence";
import { sendPush, type PushResult } from "@/lib/push";
import { supabaseAdmin } from "@/lib/supabase/server";

/**
 * Reminder delivery: finds due reminders (tasks + calendar events), pushes
 * them through Expo, and records every delivery so a reminder never fires
 * twice — the log's unique key makes the whole tick idempotent.
 */

/** How far back a recurring occurrence can start and still be relevant. */
const OCCURRENCE_LOOKBACK_MS = 14 * 24 * 60 * 60 * 1000;

export type ReminderTickResult = {
  due: number;
  sent: number;
  failed: number;
  errors: string[];
};

type TaskRow = {
  id: string;
  user_id: string;
  title: string;
  notes: string | null;
  status: string;
  due_at: string | null;
  due_all_day: boolean;
  remind_at: string | null;
  rrule: string | null;
  reminded_at: string | null;
};

export type EventRow = {
  id: string;
  user_id: string;
  title: string;
  starts_at: string;
  ends_at: string;
  all_day: boolean;
  rrule: string | null;
  exdates: string[];
  reminders: Array<{ minutesBefore?: number; method?: string }>;
};

export type DueReminder = {
  userId: string;
  itemType: "task" | "event";
  itemId: string;
  remindAt: Date;
  title: string;
  body: string;
  url: string;
};

/**
 * Computes which reminders are due at `now`.
 *
 * Pure (no database access) so the schedule can be unit-tested: a task is due
 * when its `remind_at` has passed, an event when one of its reminder offsets
 * (minutes before the start) has been reached. Recurring items expand to
 * their occurrences, so each occurrence gets its own reminder.
 */
export function computeDueReminders(
  tasks: TaskRow[],
  events: EventRow[],
  now: Date,
): DueReminder[] {
  const due: DueReminder[] = [];

  for (const task of tasks) {
    if (!task.remind_at) continue;
    const remindAt = new Date(task.remind_at);
    if (remindAt > now) continue;

    // Recurring tasks: each occurrence has its own reminder time.
    const occurrences = task.rrule
      ? expandOccurrences(task.rrule, now, remindAt)
      : [{ start: remindAt }];

    for (const occurrence of occurrences) {
      const occurrenceRemindAt = task.rrule ? new Date(occurrence.start.getTime()) : remindAt;
      if (occurrenceRemindAt > now) continue;
      due.push({
        userId: task.user_id,
        itemType: "task",
        itemId: task.id,
        remindAt: occurrenceRemindAt,
        title: task.title,
        body: task.due_at
          ? `Due ${new Date(task.due_at).toLocaleString("en-IN", { timeZone: "Asia/Kolkata" })}`
          : "Task reminder",
        url: "/",
      });
    }
  }

  for (const event of events) {
    const reminders = Array.isArray(event.reminders) ? event.reminders : [];
    if (reminders.length === 0) continue;

    const starts = expandOccurrences(event.rrule, now, new Date(event.starts_at));
    for (const occurrence of starts) {
      for (const reminder of reminders) {
        const minutes = typeof reminder.minutesBefore === "number" ? reminder.minutesBefore : 0;
        const remindAt = new Date(occurrence.start.getTime() - minutes * 60 * 1000);
        if (remindAt > now) continue;
        due.push({
          userId: event.user_id,
          itemType: "event",
          itemId: event.id,
          remindAt,
          title: event.title,
          body:
            minutes > 0
              ? `Starts ${new Date(occurrence.start).toLocaleString("en-IN", { timeZone: "Asia/Kolkata" })}`
              : "Event starting now",
          url: "/calendar",
        });
      }
    }
  }

  return due;
}

export async function runReminderTick(now = new Date()): Promise<ReminderTickResult> {
  const result: ReminderTickResult = { due: 0, sent: 0, failed: 0, errors: [] };
  const admin = supabaseAdmin();

  const [{ data: tasks }, { data: events }] = await Promise.all([
    admin
      .from("tasks")
      .select("id, user_id, title, notes, status, due_at, due_all_day, remind_at, rrule, reminded_at")
      .eq("status", "open")
      .is("deleted_at", null)
      .not("remind_at", "is", null)
      .lte("remind_at", now.toISOString()),
    admin
      .from("calendar_events")
      .select("id, user_id, title, starts_at, ends_at, all_day, rrule, exdates, reminders")
      .is("deleted_at", null)
      .neq("reminders", "[]"),
  ]);

  const due = computeDueReminders(
    (tasks ?? []) as TaskRow[],
    (events ?? []) as EventRow[],
    now,
  );

  result.due = due.length;

  // Group by user so one push call serves a user's devices.
  const byUser = new Map<string, typeof due>();
  for (const item of due) {
    const list = byUser.get(item.userId) ?? [];
    list.push(item);
    byUser.set(item.userId, list);
  }

  for (const [userId, items] of byUser) {
    // Skip anything already delivered (idempotent across cron retries).
    const fresh = await filterAlreadyReminded(userId, items);
    if (fresh.length === 0) continue;

    // Claim the reminders before sending: the log's unique key means only
    // one tick can claim a given (item, reminder time), so overlapping ticks
    // can never push the same reminder twice.
    const claimed = await claimReminders(userId, fresh);
    if (claimed.length === 0) continue;

    const pushResult: PushResult = await sendPush(
      userId,
      claimed.map((item) => ({
        title: item.title,
        body: item.body,
        data: { url: item.url, itemType: item.itemType, itemId: item.itemId },
      })),
    );
    result.sent += pushResult.sent;
    result.failed += pushResult.failed;
    result.errors.push(...pushResult.errors);

    if (pushResult.sent === 0) {
      // Nothing was delivered (no device registered, or Expo refused the
      // batch) — release the claim so the next tick retries.
      await releaseReminders(userId, claimed);
      continue;
    }

    // Task rows carry a reminded_at column for quick inspection.
    for (const item of claimed.filter((entry) => entry.itemType === "task")) {
      await admin
        .from("tasks")
        .update({ reminded_at: item.remindAt.toISOString() })
        .eq("id", item.itemId)
        .eq("user_id", userId);
    }
  }

  return result;
}

/**
 * Expands an RRULE into occurrence start times that are due (or recently
 * past, so a reminder that fired late is not lost).
 *
 * The rule is anchored to the item's own start time so occurrences keep the
 * original time of day.
 */
function expandOccurrences(
  rrule: string | null,
  now: Date,
  fallbackStart: Date,
): Array<{ start: Date }> {
  if (!rrule) return [{ start: fallbackStart }];
  const set = buildRRuleSet(rrule, [], fallbackStart);
  if (!set) return [{ start: fallbackStart }];
  try {
    const windowStart = new Date(now.getTime() - OCCURRENCE_LOOKBACK_MS);
    const occurrences = set.between(windowStart, new Date(now.getTime() + 366 * 24 * 60 * 60 * 1000), true);
    return occurrences.map((occ) => ({ start: new Date(occ) }));
  } catch {
    return [{ start: fallbackStart }];
  }
}

/** Drops reminders that were already delivered (unique key on the log). */
async function filterAlreadyReminded<
  T extends { itemType: "task" | "event"; itemId: string; remindAt: Date },
>(userId: string, items: T[]): Promise<T[]> {
  if (items.length === 0) return [];
  const admin = supabaseAdmin();
  const { data } = await admin
    .from("reminder_log")
    .select("item_type, item_id, remind_at")
    .eq("user_id", userId)
    .in("item_id", [...new Set(items.map((item) => item.itemId))]);

  const seen = new Set(
    (data ?? []).map(
      (row) =>
        `${row.item_type}:${row.item_id}:${new Date(row.remind_at as string).getTime()}`,
    ),
  );

  return items.filter(
    (item) => !seen.has(`${item.itemType}:${item.itemId}:${item.remindAt.getTime()}`),
  );
}

/**
 * Claims reminders for delivery by inserting their log rows.
 *
 * The unique index on (item_type, item_id, remind_at) makes the claim
 * atomic: a conflicting insert means another tick already owns this
 * reminder, so it is skipped.
 */
async function claimReminders<
  T extends { itemType: "task" | "event"; itemId: string; remindAt: Date },
>(userId: string, items: T[]): Promise<T[]> {
  if (items.length === 0) return [];
  const admin = supabaseAdmin();
  const claimed: T[] = [];

  for (const item of items) {
    const { error } = await admin.from("reminder_log").insert({
      user_id: userId,
      item_type: item.itemType,
      item_id: item.itemId,
      remind_at: item.remindAt.toISOString(),
    });
    if (!error) {
      claimed.push(item);
      continue;
    }
    if (error.code === "23505") continue; // already claimed by another tick
    console.warn("[reminders] could not claim reminder:", error.message);
  }

  return claimed;
}

/** Releases claims whose delivery failed so the next tick retries them. */
async function releaseReminders<
  T extends { itemType: "task" | "event"; itemId: string; remindAt: Date },
>(userId: string, items: T[]): Promise<void> {
  if (items.length === 0) return;
  const admin = supabaseAdmin();
  for (const item of items) {
    await admin
      .from("reminder_log")
      .delete()
      .eq("user_id", userId)
      .eq("item_type", item.itemType)
      .eq("item_id", item.itemId)
      .eq("remind_at", item.remindAt.toISOString());
  }
}
