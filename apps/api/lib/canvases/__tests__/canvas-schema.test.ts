import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { test } from "node:test";

import {
  MAX_SPEC_BYTES,
  validateCanvasSpec,
  type CanvasSpec,
} from "@agent/shared";

const fixturePath = new URL("../../../../../packages/shared/src/fixtures/canvas-fixtures.json", import.meta.url);
const fixtures = JSON.parse(readFileSync(fixturePath, "utf8")) as { name: string; spec: CanvasSpec }[];

test("every canvas fixture validates", () => {
  for (const fixture of fixtures as { name: string; spec: CanvasSpec }[]) {
    const result = validateCanvasSpec(fixture.spec);
    assert.equal(result.ok, true, `fixture ${fixture.name}: ${!result.ok ? result.error : ""}`);
  }
});

test("preserves unknown component types for renderer fallback", () => {
  const result = validateCanvasSpec({
    title: "bad",
    root: { type: "iframe", src: "https://example.com" },
  });
  assert.equal(result.ok, true);
});

test("rejects non-enum button actions", () => {
  const result = validateCanvasSpec({
    root: { type: "button", label: "Run", action: "eval", payload: "code" },
  });
  assert.equal(result.ok, false);
});

test("rejects nesting deeper than 4", () => {
  const deep = (level: number): unknown =>
    level >= 6
      ? { type: "markdown", text: "bottom" }
      : { type: "stack", direction: "column", children: [deep(level + 1)] };

  const result = validateCanvasSpec({ root: deep(1) });
  assert.equal(result.ok, false);
  assert.match(!result.ok ? result.error : "", /nesting/);
});

test("allows nesting exactly 4 deep", () => {
  const at = (level: number): unknown =>
    level >= 4
      ? { type: "markdown", text: "bottom" }
      : { type: "stack", direction: "column", children: [at(level + 1)] };

  assert.equal(validateCanvasSpec({ root: at(1) }).ok, true);
});

test("rejects oversized specs", () => {
  // Many valid-sized nodes that together exceed the 100 KB spec cap.
  const spec = {
    root: {
      type: "stack" as const,
      direction: "column" as const,
      children: Array.from({ length: 7 }, () => ({ type: "markdown", text: "x".repeat(16_000) })),
    },
  };
  const result = validateCanvasSpec(spec);
  assert.equal(result.ok, false);
  assert.match(!result.ok ? result.error : "", /100 KB/);
});

test("chart data bounds are enforced", () => {
  const tooMany = {
    root: {
      type: "chart",
      kind: "line" as const,
      data: Array.from({ length: 61 }, (_, index) => ({ x: index, y: index })),
    },
  };
  assert.equal(validateCanvasSpec(tooMany).ok, false);

  const empty = { root: { type: "chart", kind: "pie" as const, data: [] } };
  assert.equal(validateCanvasSpec(empty).ok, false);
});

test("data source kinds are a fixed enum", () => {
  const result = validateCanvasSpec({
    dataSources: [{ id: "x", kind: "fetch_url", query: "test" }],
    root: { type: "stat", label: "n", value: "1" },
  });
  assert.equal(result.ok, false);
});
