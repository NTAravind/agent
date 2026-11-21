import assert from "node:assert/strict";
import { describe, it } from "node:test";

import {
  computeNextRuns,
  currentTimeContext,
  describeSchedule,
  nextRunAfter,
  scheduleToRRule,
  zonedParts,
  zonedTimeToUtc,
} from "../schedule";

const IST = "Asia/Kolkata";

/** 2026-11-21T12:00:00Z — a Saturday, 17:30 in IST. */
const NOW = new Date("2026-11-21T12:00:00.000Z");

describe("zoned wall-clock math", () => {
  it("reads the local parts of an instant", () => {
    const parts = zonedParts(new Date("2026-11-23T04:30:00.000Z"), IST);
    assert.equal(parts.year, 2026);
    assert.equal(parts.month, 11);
    assert.equal(parts.day, 23);
    assert.equal(parts.hour, 10);
    assert.equal(parts.minute, 0);
    assert.equal(parts.weekday, 1); // Monday
  });

  it("converts a wall-clock time to the matching UTC instant", () => {
    const instant = zonedTimeToUtc(2026, 11, 23, 9, 0, IST);
    assert.equal(instant.toISOString(), "2026-11-23T03:30:00.000Z");
    const back = zonedParts(instant, IST);
    assert.equal(back.hour, 9);
    assert.equal(back.minute, 0);
    assert.equal(back.day, 23);
  });

  it("keeps the wall clock across a DST transition (America/New_York)", () => {
    // 2026-03-08 is the US spring-forward day: 09:00 local is 13:00 UTC.
    const before = zonedTimeToUtc(2026, 3, 7, 9, 0, "America/New_York");
    const after = zonedTimeToUtc(2026, 3, 9, 9, 0, "America/New_York");
    assert.equal(before.toISOString(), "2026-03-07T14:00:00.000Z");
    assert.equal(after.toISOString(), "2026-03-09T13:00:00.000Z");
    assert.equal(zonedParts(after, "America/New_York").hour, 9);
  });
});

describe("scheduleToRRule", () => {
  it("describes a weekly rule", () => {
    const rrule = scheduleToRRule({
      frequency: "weekly",
      days_of_week: ["MO"],
      time: "09:00",
    });
    assert.equal(rrule, "FREQ=WEEKLY;BYDAY=MO;BYHOUR=9;BYMINUTE=0");
  });

  it("describes a daily and a monthly rule", () => {
    assert.equal(
      scheduleToRRule({ frequency: "daily", time: "08:30" }),
      "FREQ=DAILY;BYHOUR=8;BYMINUTE=30",
    );
    assert.equal(
      scheduleToRRule({ frequency: "monthly", day_of_month: 15, time: "09:00" }),
      "FREQ=MONTHLY;BYMONTHDAY=15;BYHOUR=9;BYMINUTE=0",
    );
  });

  it("has no rule for a one-shot schedule", () => {
    assert.equal(
      scheduleToRRule({ frequency: "once", time: "09:00", run_at: "2026-11-24T03:30:00.000Z" }),
      null,
    );
  });
});

describe("computeNextRuns", () => {
  it("returns the next three Mondays at 09:00 IST", () => {
    const runs = computeNextRuns(
      { frequency: "weekly", days_of_week: ["MO"], time: "09:00" },
      IST,
      NOW,
      3,
    );
    assert.deepEqual(runs, [
      "2026-11-23T03:30:00.000Z",
      "2026-11-30T03:30:00.000Z",
      "2026-12-07T03:30:00.000Z",
    ]);
    // Every occurrence is 09:00 in the user's zone.
    for (const run of runs) {
      const parts = zonedParts(new Date(run), IST);
      assert.equal(parts.hour, 9);
      assert.equal(parts.minute, 0);
      assert.equal(parts.weekday, 1);
    }
  });

  it("handles several weekdays per week", () => {
    const runs = computeNextRuns(
      { frequency: "weekly", days_of_week: ["WE", "MO"], time: "09:00" },
      IST,
      NOW,
      3,
    );
    assert.deepEqual(runs, [
      "2026-11-23T03:30:00.000Z",
      "2026-11-25T03:30:00.000Z",
      "2026-11-30T03:30:00.000Z",
    ]);
  });

  it("defaults a weekly rule without weekdays to Monday", () => {
    const runs = computeNextRuns({ frequency: "weekly", time: "09:00" }, IST, NOW, 1);
    assert.equal(runs[0], "2026-11-23T03:30:00.000Z");
  });

  it("returns daily occurrences", () => {
    // NOW is exactly 17:30 IST, and occurrences are strictly *after* the
    // reference instant — so today's slot is already gone.
    const runs = computeNextRuns({ frequency: "daily", time: "17:30" }, IST, NOW, 2);
    assert.deepEqual(runs, ["2026-11-22T12:00:00.000Z", "2026-11-23T12:00:00.000Z"]);
  });

  it("returns monthly occurrences on the requested day", () => {
    const runs = computeNextRuns(
      { frequency: "monthly", day_of_month: 15, time: "09:00" },
      IST,
      NOW,
      2,
    );
    // The first November 15th is in the past, so the next one is December.
    assert.deepEqual(runs, ["2026-12-15T03:30:00.000Z", "2027-01-15T03:30:00.000Z"]);
  });

  it("returns the single instant for a one-shot routine", () => {
    const runs = computeNextRuns(
      { frequency: "once", time: "09:00", run_at: "2026-11-24T03:30:00.000Z" },
      IST,
      NOW,
      3,
    );
    assert.deepEqual(runs, ["2026-11-24T03:30:00.000Z"]);
  });

  it("drops a one-shot routine whose instant has passed", () => {
    const runs = computeNextRuns(
      { frequency: "once", time: "09:00", run_at: "2026-11-01T03:30:00.000Z" },
      IST,
      NOW,
      3,
    );
    assert.deepEqual(runs, []);
  });

  it("never returns an occurrence at or before the reference instant", () => {
    const runs = computeNextRuns(
      { frequency: "daily", time: "09:00" },
      IST,
      new Date("2026-11-23T03:30:00.000Z"),
      3,
    );
    assert.equal(runs[0], "2026-11-24T03:30:00.000Z");
  });
});

describe("nextRunAfter", () => {
  it("returns the first future occurrence", () => {
    const next = nextRunAfter(
      { frequency: "weekly", days_of_week: ["MO"], time: "09:00" },
      IST,
      NOW,
    );
    assert.equal(next, "2026-11-23T03:30:00.000Z");
  });
});

describe("describeSchedule", () => {
  it("describes a weekly rule", () => {
    assert.equal(
      describeSchedule({ frequency: "weekly", days_of_week: ["MO"], time: "09:00" }, IST),
      "Every Monday at 09:00",
    );
  });

  it("describes multiple weekdays", () => {
    assert.equal(
      describeSchedule({ frequency: "weekly", days_of_week: ["MO", "FR"], time: "08:15" }, IST),
      "Every Monday, Friday at 08:15",
    );
  });

  it("describes daily, monthly and one-shot rules", () => {
    assert.equal(describeSchedule({ frequency: "daily", time: "07:00" }, IST), "Every day at 07:00");
    assert.equal(
      describeSchedule({ frequency: "monthly", day_of_month: 15, time: "09:00" }, IST),
      "On the 15th of every month at 09:00",
    );
    assert.equal(
      describeSchedule(
        { frequency: "once", time: "09:00", run_at: "2026-11-24T03:30:00.000Z" },
        IST,
      ),
      "Once on 24/11/2026 at 09:00",
    );
  });
});

describe("currentTimeContext", () => {
  it("states the local date, time and weekday", () => {
    const line = currentTimeContext(IST, NOW);
    assert.match(line, /2026-11-21 17:30 Saturday \(Asia\/Kolkata\)/);
  });
});
