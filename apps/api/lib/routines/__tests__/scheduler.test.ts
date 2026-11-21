import assert from "node:assert/strict";
import { describe, it } from "node:test";

import {
  isRoutineTriggerMessage,
  MAX_CONSECUTIVE_FAILURES,
  routineResultText,
  routineTriggerPart,
} from "../scheduler";
import { normalizeSchedule, RoutineScheduleInputSchema } from "../tools";

const IST = "Asia/Kolkata";

describe("routine trigger parts", () => {
  it("marks the message as routine-sourced", () => {
    const part = routineTriggerPart({ id: "r1", name: "Monday summary" } as never);
    assert.equal(part.type, "routine-trigger");
    assert.equal(part.source, "routine");
    assert.equal(part.routine_id, "r1");
    assert.equal(part.routine_name, "Monday summary");
  });

  it("recognises a message that carries the trigger part", () => {
    const parts = [
      { type: "text", text: "summarize my tasks" },
      routineTriggerPart({ id: "r1", name: "Monday summary" } as never),
    ];
    assert.equal(isRoutineTriggerMessage(parts), true);
  });

  it("ignores a normal human message", () => {
    assert.equal(
      isRoutineTriggerMessage([{ type: "text", text: "hello" }]),
      false,
    );
    assert.equal(isRoutineTriggerMessage(null), false);
    assert.equal(isRoutineTriggerMessage("not an array"), false);
  });
});

describe("routineResultText", () => {
  it("prefixes the answer with the routine name", () => {
    assert.equal(
      routineResultText("Monday summary", "Three tasks are open."),
      "**Monday summary**\n\nThree tasks are open.",
    );
  });
});

describe("failure guardrail", () => {
  it("auto-pauses after three consecutive failures", () => {
    assert.equal(MAX_CONSECUTIVE_FAILURES, 3);
  });
});

describe("normalizeSchedule", () => {
  it("keeps a weekly rule as-is", () => {
    const parsed = RoutineScheduleInputSchema.parse({
      frequency: "weekly",
      days_of_week: ["MO"],
      time: "09:00",
    });
    assert.deepEqual(normalizeSchedule(parsed, IST), {
      frequency: "weekly",
      days_of_week: ["MO"],
      time: "09:00",
    });
  });

  it("derives the wall clock of a one-shot from run_at", () => {
    const parsed = RoutineScheduleInputSchema.parse({
      frequency: "once",
      run_at: "2026-11-24T03:30:00.000Z",
    });
    const schedule = normalizeSchedule(parsed, IST);
    assert.equal(schedule.frequency, "once");
    assert.equal(schedule.time, "09:00");
    assert.equal(schedule.run_at, "2026-11-24T03:30:00.000Z");
  });

  it("rejects a recurring rule without a time", () => {
    const result = RoutineScheduleInputSchema.safeParse({
      frequency: "weekly",
      days_of_week: ["MO"],
    });
    assert.equal(result.success, false);
  });

  it("rejects a one-shot without any time", () => {
    const result = RoutineScheduleInputSchema.safeParse({ frequency: "once" });
    assert.equal(result.success, false);
  });

  it("rejects a malformed time", () => {
    const result = RoutineScheduleInputSchema.safeParse({
      frequency: "daily",
      time: "9am",
    });
    assert.equal(result.success, false);
  });
});
