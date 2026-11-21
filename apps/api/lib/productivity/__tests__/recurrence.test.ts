import assert from "node:assert/strict";
import { test } from "node:test";

import { buildRRuleSet, expandStarts } from "../../recurrence";

const IST = "Asia/Kolkata";

test("a weekly rule keeps the item's time of day (anchored to DTSTART)", () => {
  // Regression: without an anchor, rrule.js defaults DTSTART to *now* and
  // every occurrence drifts to the current time of day.
  const anchor = new Date("2026-11-23T04:30:00.000Z"); // 10:00 IST
  const starts = expandStarts(
    "FREQ=WEEKLY;BYDAY=MO",
    [],
    new Date("2026-11-20T00:00:00.000Z"),
    new Date("2026-12-21T00:00:00.000Z"),
    anchor,
    anchor,
  );
  assert.equal(starts.length, 4);
  for (const start of starts) {
    assert.equal(start.getUTCHours(), 4);
    assert.equal(start.getUTCMinutes(), 30);
    assert.equal(start.getUTCDay(), 1); // Monday
  }
});

test("EXDATEs remove a single occurrence", () => {
  const anchor = new Date("2026-11-23T04:30:00.000Z");
  const starts = expandStarts(
    "FREQ=WEEKLY;BYDAY=MO",
    ["2026-11-30T04:30:00.000Z"],
    new Date("2026-11-20T00:00:00.000Z"),
    new Date("2026-12-21T00:00:00.000Z"),
    anchor,
    anchor,
  );
  assert.equal(starts.length, 3);
  assert.equal(
    starts.some((start) => start.getTime() === Date.parse("2026-11-30T04:30:00.000Z")),
    false,
  );
});

test("a non-recurring item yields its single start", () => {
  const start = new Date("2026-11-23T04:30:00.000Z");
  const starts = expandStarts(
    null,
    [],
    new Date("2026-11-20T00:00:00.000Z"),
    new Date("2026-12-21T00:00:00.000Z"),
    start,
  );
  assert.equal(starts.length, 1);
  assert.equal(starts[0].getTime(), start.getTime());
});

test("an unparseable rule falls back to the base start instead of dropping the item", () => {
  const start = new Date("2026-11-23T04:30:00.000Z");
  const starts = expandStarts(
    "NOT-A-RULE",
    [],
    new Date("2026-11-20T00:00:00.000Z"),
    new Date("2026-12-21T00:00:00.000Z"),
    start,
  );
  assert.equal(starts.length, 1);
  assert.equal(starts[0].getTime(), start.getTime());
  assert.equal(buildRRuleSet("NOT-A-RULE"), null);
});

test("an explicit DTSTART in the rule wins over the anchor", () => {
  const rule = "DTSTART:20260105T090000Z\nRRULE:FREQ=WEEKLY";
  const set = buildRRuleSet(rule, [], new Date("2026-11-23T04:30:00.000Z"));
  assert.ok(set);
  const starts = set.between(
    new Date("2026-01-01T00:00:00.000Z"),
    new Date("2026-02-01T00:00:00.000Z"),
    true,
  );
  assert.ok(starts.length > 0);
  assert.equal(new Date(starts[0]!).getUTCHours(), 9);
});
