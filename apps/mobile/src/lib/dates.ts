/**
 * Date helpers for tasks and events.
 *
 * The product timezone is Asia/Kolkata (settings.timezone default), so all
 * day boundaries are computed in that zone rather than the device's zone.
 */

export const DEFAULT_TIMEZONE = 'Asia/Kolkata';

function parts(value: string | Date, timeZone: string) {
  const date = typeof value === 'string' ? new Date(value) : value;
  const formatter = new Intl.DateTimeFormat('en-CA', {
    timeZone,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
    hour12: false,
  });
  const map: Record<string, string> = {};
  for (const part of formatter.formatToParts(date)) {
    if (part.type !== 'literal') map[part.type] = part.value;
  }
  return map;
}

/** `YYYY-MM-DD` for the given instant in the given timezone. */
export function dayKey(value: string | Date, timeZone = DEFAULT_TIMEZONE): string {
  const p = parts(value, timeZone);
  return `${p.year}-${p.month}-${p.day}`;
}

/** True when the instant falls on the current day in the given timezone. */
export function isToday(value: string | Date, timeZone = DEFAULT_TIMEZONE): boolean {
  return dayKey(value, timeZone) === dayKey(new Date(), timeZone);
}

/** True when the instant is before now. */
export function isPast(value: string | Date): boolean {
  return new Date(value).getTime() < Date.now();
}

/** `9:30 AM` in the given timezone. */
export function formatTime(value: string | Date, timeZone = DEFAULT_TIMEZONE): string {
  return new Intl.DateTimeFormat('en-IN', {
    timeZone,
    hour: 'numeric',
    minute: '2-digit',
  }).format(typeof value === 'string' ? new Date(value) : value);
}

/** `Today`, `Tomorrow`, `Yesterday` or `Mon, 23 Nov`. */
export function formatDayLabel(value: string | Date, timeZone = DEFAULT_TIMEZONE): string {
  const today = dayKey(new Date(), timeZone);
  const target = dayKey(value, timeZone);
  const tomorrow = dayKey(new Date(Date.now() + 86_400_000), timeZone);
  const yesterday = dayKey(new Date(Date.now() - 86_400_000), timeZone);

  if (target === today) return 'Today';
  if (target === tomorrow) return 'Tomorrow';
  if (target === yesterday) return 'Yesterday';

  return new Intl.DateTimeFormat('en-IN', {
    timeZone,
    weekday: 'short',
    day: 'numeric',
    month: 'short',
  }).format(typeof value === 'string' ? new Date(value) : value);
}

/** `23 Nov, 9:30 AM` */
export function formatDateTime(value: string | Date, timeZone = DEFAULT_TIMEZONE): string {
  return new Intl.DateTimeFormat('en-IN', {
    timeZone,
    day: 'numeric',
    month: 'short',
    hour: 'numeric',
    minute: '2-digit',
  }).format(typeof value === 'string' ? new Date(value) : value);
}

/** Long header label: `Saturday, 21 November`. */
export function formatHeaderDate(date = new Date(), timeZone = DEFAULT_TIMEZONE): string {
  return new Intl.DateTimeFormat('en-IN', {
    timeZone,
    weekday: 'long',
    day: 'numeric',
    month: 'long',
  }).format(date);
}

/** ISO instant (with offset) for a local wall-clock time — used by forms. */
export function toIsoWithOffset(date: Date, timeZone = DEFAULT_TIMEZONE): string {
  const p = parts(date, timeZone);
  const hour = p.hour === '24' ? '00' : p.hour;
  return `${p.year}-${p.month}-${p.day}T${hour}:${p.minute}:00+05:30`;
}

/**
 * Start of the local day as an ISO instant.
 *
 * Asia/Kolkata is a fixed +05:30 offset with no daylight saving, so the
 * offset is safe to inline. (The product pins the timezone to IST.)
 */
export function startOfDayIso(value: string | Date = new Date(), timeZone = DEFAULT_TIMEZONE): string {
  return `${dayKey(value, timeZone)}T00:00:00+05:30`;
}

/** End of the local day as an ISO instant. */
export function endOfDayIso(value: string | Date = new Date(), timeZone = DEFAULT_TIMEZONE): string {
  return `${dayKey(value, timeZone)}T23:59:59+05:30`;
}
