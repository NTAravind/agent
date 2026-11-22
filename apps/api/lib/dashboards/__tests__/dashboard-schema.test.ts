import assert from "node:assert/strict";
import test from "node:test";

import {
  DashboardCreateSchema,
  DashboardUpdateSchema,
  MAX_DASHBOARD_WIDGETS,
} from "@agent/shared";

const validStat = {
  type: "stat",
  title: "Tasks",
  config: { type: "stat", label: "Open tasks", value: "4" },
};

test("dashboard create applies layout and widget defaults", () => {
  const parsed = DashboardCreateSchema.parse({ title: "Overview", widgets: [validStat] });
  assert.deepEqual(parsed.layout, { columns: 12, rowHeight: 96, gap: 12 });
  assert.deepEqual(parsed.widgets[0]?.position, { x: 0, y: 0 });
  assert.deepEqual(parsed.widgets[0]?.size, { width: 3, height: 2 });
});

test("dashboard widgets must match a supported Canvas component type", () => {
  const parsed = DashboardCreateSchema.safeParse({
    title: "Overview",
    widgets: [{ ...validStat, config: { type: "button", label: "Go", action: "refresh" } }],
  });
  assert.equal(parsed.success, false);
});

test("dashboard image configs require safe HTTPS URLs", () => {
  assert.equal(DashboardCreateSchema.safeParse({
    title: "Overview",
    widgets: [{ type: "image", title: "Report", config: { type: "image", uri: "http://example.com/report.png" } }],
  }).success, false);
  assert.equal(DashboardCreateSchema.safeParse({
    title: "Overview",
    widgets: [{ type: "image", title: "Report", config: { type: "image", uri: "https://example.com/report.png" } }],
  }).success, true);
});

test("dashboard widgets enforce widget count and grid bounds", () => {
  const tooMany = DashboardCreateSchema.safeParse({
    title: "Overview",
    widgets: Array.from({ length: MAX_DASHBOARD_WIDGETS + 1 }, (_, i) => ({ ...validStat, title: `Stat ${i}` })),
  });
  assert.equal(tooMany.success, false);

  const outsideGrid = DashboardCreateSchema.safeParse({
    title: "Overview",
    widgets: [{ ...validStat, position: { x: 11, y: 0 }, size: { width: 2, height: 1 } }],
  });
  assert.equal(outsideGrid.success, false);
});

test("dashboard updates require at least one field and reject malformed configs", () => {
  assert.equal(DashboardUpdateSchema.safeParse({}).success, false);
  assert.equal(
    DashboardUpdateSchema.safeParse({ widgets: [{ ...validStat, config: { type: "chart", kind: "pie", data: [] } }] }).success,
    false,
  );
});
