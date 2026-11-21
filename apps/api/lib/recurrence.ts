import { RRule, RRuleSet, rrulestr } from "rrule";

/**
 * Recurrence helpers (Phase 9).
 *
 * Recurrence is stored as an RRULE string and expanded on read — occurrences
 * are never materialized in the database.
 */

/**
 * Builds an RRuleSet from an RRULE string, applying EXDATEs.
 *
 * `dtstart` anchors the rule to the item's own start time. Without it,
 * rrule.js defaults DTSTART to *now*, which silently moves every occurrence
 * to the current time of day — so the anchor is always passed when known.
 * An explicit DTSTART inside the RRULE string wins.
 *
 * Returns null when the rule cannot be parsed (callers fall back to the
 * base row rather than dropping the item).
 */
export function buildRRuleSet(
  rrule: string,
  exdates: string[] = [],
  dtstart?: Date | null,
): RRuleSet | null {
  try {
    const set = new RRuleSet();
    const parsed = rrulestr(rrule);
    if (dtstart && !/DTSTART/i.test(rrule)) {
      set.rrule(new RRule({ ...parsed.origOptions, dtstart }));
    } else {
      set.rrule(parsed);
    }
    for (const exdate of exdates) {
      const date = new Date(exdate);
      if (Number.isNaN(date.getTime())) continue;
      set.exdate(date);
    }
    return set;
  } catch {
    return null;
  }
}

/**
 * Expands a recurring item into the occurrence starts inside a window.
 * Non-recurring items yield their single start.
 */
export function expandStarts(
  rrule: string | null,
  exdates: string[] | undefined,
  rangeFrom: Date,
  rangeTo: Date,
  fallbackStart: Date,
  dtstart?: Date | null,
): Date[] {
  if (!rrule) return [fallbackStart];
  const set = buildRRuleSet(rrule, exdates ?? [], dtstart ?? fallbackStart);
  if (!set) return [fallbackStart];
  try {
    return set.between(rangeFrom, rangeTo, true).map((occ) => new Date(occ));
  } catch {
    return [fallbackStart];
  }
}
