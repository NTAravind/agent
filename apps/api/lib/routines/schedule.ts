import type { RoutineSchedule, Weekday } from "@agent/shared";

/**
 * Routine schedule math (Phase 10).
 *
 * The model never supplies dates. It supplies a *structured* schedule
 * ("every Monday at 09:00") and this module turns that into concrete
 * instants in the user's timezone.
 *
 * Why not the `rrule` library: `rrule@2.8` applies `BYHOUR`/`BYMINUTE` in
 * UTC even when `tzid` is set, so "09:00 IST" comes out as 09:00 UTC. The
 * wall-clock arithmetic below is explicit about the timezone instead, so
 * "09:00" always means 09:00 in the user's zone — across DST boundaries too.
 *
 * The RRULE string is still produced (it is the portable description of the
 * recurrence and is stored on the row); `next_run_at` is computed with the
 * timezone-aware math below.
 */

const WEEKDAY_CODES: Weekday[] = ["MO", "TU", "WE", "TH", "FR", "SA", "SU"];

export const DEFAULT_TIMEZONE = "Asia/Kolkata";

/** How far ahead we are willing to look for the next occurrence. */
const MAX_LOOKAHEAD_DAYS = 800;

type ZonedParts = {
  year: number;
  month: number; // 1-12
  day: number;
  hour: number;
  minute: number;
  second: number;
  /** 0 = Sunday … 6 = Saturday (JS convention). */
  weekday: number;
};

function partsFormatter(timeZone: string): Intl.DateTimeFormat {
  return new Intl.DateTimeFormat("en-US", {
    timeZone,
    hourCycle: "h23",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit",
    weekday: "short",
  });
}

const WEEKDAY_BY_NAME: Record<string, number> = {
  Sun: 0,
  Mon: 1,
  Tue: 2,
  Wed: 3,
  Thu: 4,
  Fri: 5,
  Sat: 6,
};

/** The wall-clock parts of an instant, as seen in `timeZone`. */
export function zonedParts(instant: Date, timeZone: string): ZonedParts {
  const parts = partsFormatter(timeZone).formatToParts(instant);
  const get = (type: string): string => parts.find((part) => part.type === type)?.value ?? "0";
  const weekdayName = get("weekday");
  return {
    year: Number(get("year")),
    month: Number(get("month")),
    day: Number(get("day")),
    hour: Number(get("hour")),
    minute: Number(get("minute")),
    second: Number(get("second")),
    weekday: WEEKDAY_BY_NAME[weekdayName] ?? 0,
  };
}

/** The UTC offset (ms) of `timeZone` at the given instant. */
function zoneOffsetMs(instant: Date, timeZone: string): number {
  const parts = zonedParts(instant, timeZone);
  const asUtc = Date.UTC(
    parts.year,
    parts.month - 1,
    parts.day,
    parts.hour,
    parts.minute,
    parts.second,
  );
  // The formatter can round seconds; align to the second before comparing.
  return asUtc - Math.floor(instant.getTime() / 1000) * 1000;
}

/**
 * Converts a wall-clock time in `timeZone` to the matching UTC instant.
 *
 * Two-pass: guess with the offset at the naive instant, then correct with the
 * offset at the guess (this is what makes DST transitions land right).
 */
export function zonedTimeToUtc(
  year: number,
  month: number,
  day: number,
  hour: number,
  minute: number,
  timeZone: string,
): Date {
  const naive = Date.UTC(year, month - 1, day, hour, minute, 0);
  const firstOffset = zoneOffsetMs(new Date(naive), timeZone);
  const firstGuess = naive - firstOffset;
  const secondOffset = zoneOffsetMs(new Date(firstGuess), timeZone);
  const timestamp = secondOffset === firstOffset ? firstGuess : naive - secondOffset;
  return new Date(timestamp);
}

/** Parses "HH:mm" into hours + minutes. */
export function parseTime(time: string): { hour: number; minute: number } {
  const [hours, minutes] = time.split(":");
  return { hour: Number(hours), minute: Number(minutes) };
}

/** The days of the week a weekly rule fires on (defaults to Monday). */
export function scheduleWeekdays(schedule: RoutineSchedule): Weekday[] {
  if (schedule.frequency !== "weekly") return [];
  const days = schedule.days_of_week ?? [];
  if (days.length === 0) return ["MO"];
  // Preserve the canonical MO…SU order so the RRULE and the label are stable.
  return WEEKDAY_CODES.filter((code) => days.includes(code));
}

/**
 * The RRULE string for a recurring schedule (null for one-shot routines).
 * The rule is the portable description of the recurrence; the concrete
 * instants are computed with the timezone-aware math in this module.
 */
export function scheduleToRRule(schedule: RoutineSchedule): string | null {
  if (schedule.frequency === "once") return null;
  const { hour, minute } = parseTime(schedule.time);
  const time = `BYHOUR=${hour};BYMINUTE=${minute}`;

  switch (schedule.frequency) {
    case "daily":
      return `FREQ=DAILY;${time}`;
    case "weekly": {
      const days = scheduleWeekdays(schedule).join(",");
      return `FREQ=WEEKLY;BYDAY=${days};${time}`;
    }
    case "monthly": {
      const day = schedule.day_of_month ?? 1;
      return `FREQ=MONTHLY;BYMONTHDAY=${day};${time}`;
    }
    default:
      return null;
  }
}

/** True when the local calendar date matches the rule (time is not checked). */
function matchesDate(schedule: RoutineSchedule, local: ZonedParts): boolean {
  switch (schedule.frequency) {
    case "daily":
      return true;
    case "weekly": {
      const code = WEEKDAY_CODES[local.weekday === 0 ? 6 : local.weekday - 1];
      return scheduleWeekdays(schedule).includes(code);
    }
    case "monthly":
      return local.day === (schedule.day_of_month ?? 1);
    default:
      return false;
  }
}

/**
 * The next occurrences of a schedule, strictly after `from`.
 *
 * Returns ISO 8601 UTC instants. One-shot routines return their `run_at`
 * (when it is still in the future); recurring routines walk the calendar in
 * the target timezone.
 */
export function computeNextRuns(
  schedule: RoutineSchedule,
  timeZone: string,
  from: Date,
  count = 3,
): string[] {
  if (count <= 0) return [];

  if (schedule.frequency === "once") {
    if (!schedule.run_at) return [];
    const instant = new Date(schedule.run_at);
    if (Number.isNaN(instant.getTime()) || instant.getTime() <= from.getTime()) return [];
    return [instant.toISOString()];
  }

  const { hour, minute } = parseTime(schedule.time);
  const results: string[] = [];

  // Walk the local calendar day by day, starting at the local date of `from`.
  const localStart = zonedParts(from, timeZone);
  let cursor = Date.UTC(localStart.year, localStart.month - 1, localStart.day);

  for (let day = 0; day <= MAX_LOOKAHEAD_DAYS && results.length < count; day += 1) {
    const date = new Date(cursor + day * 86_400_000);
    const local = zonedParts(date, timeZone);
    if (!matchesDate(schedule, local)) continue;

    const instant = zonedTimeToUtc(
      local.year,
      local.month,
      local.day,
      hour,
      minute,
      timeZone,
    );
    if (instant.getTime() <= from.getTime()) continue;
    results.push(instant.toISOString());
  }

  return results;
}

/** The single next occurrence after `from` (null when the rule is exhausted). */
export function nextRunAfter(
  schedule: RoutineSchedule,
  timeZone: string,
  from: Date,
): string | null {
  return computeNextRuns(schedule, timeZone, from, 1)[0] ?? null;
}

/** Human-readable schedule, e.g. "Every Monday at 09:00". */
export function describeSchedule(schedule: RoutineSchedule, timeZone: string): string {
  const { hour, minute } = parseTime(schedule.time);
  const at = `${String(hour).padStart(2, "0")}:${String(minute).padStart(2, "0")}`;

  switch (schedule.frequency) {
    case "once": {
      if (!schedule.run_at) return `Once at ${at}`;
      const local = zonedParts(new Date(schedule.run_at), timeZone);
      const date = `${String(local.day).padStart(2, "0")}/${String(local.month).padStart(2, "0")}/${local.year}`;
      return `Once on ${date} at ${at}`;
    }
    case "daily":
      return `Every day at ${at}`;
    case "weekly": {
      const days = scheduleWeekdays(schedule);
      const names: Record<Weekday, string> = {
        MO: "Monday",
        TU: "Tuesday",
        WE: "Wednesday",
        TH: "Thursday",
        FR: "Friday",
        SA: "Saturday",
        SU: "Sunday",
      };
      const label =
        days.length === 7
          ? "Every day"
          : days.length === 1
            ? `Every ${names[days[0]]}`
            : `Every ${days.map((day) => names[day]).join(", ")}`;
      return `${label} at ${at}`;
    }
    case "monthly": {
      const day = schedule.day_of_month ?? 1;
      return `On the ${day}${day === 1 ? "st" : day === 2 ? "nd" : day === 3 ? "rd" : "th"} of every month at ${at}`;
    }
    default:
      return `At ${at}`;
  }
}

/**
 * The current date/time/timezone line injected into the chat and agent
 * system prompts, so relative expressions ("every Monday at 9") resolve
 * against the user's clock rather than the model's.
 */
export function currentTimeContext(timeZone: string, now = new Date()): string {
  const local = zonedParts(now, timeZone);
  const weekday = ["Sunday", "Monday", "Tuesday", "Wednesday", "Thursday", "Friday", "Saturday"][local.weekday];
  const date = `${local.year}-${String(local.month).padStart(2, "0")}-${String(local.day).padStart(2, "0")}`;
  const time = `${String(local.hour).padStart(2, "0")}:${String(local.minute).padStart(2, "0")}`;
  return `Current date and time: ${date} ${time} ${weekday} (${timeZone}).`;
}
