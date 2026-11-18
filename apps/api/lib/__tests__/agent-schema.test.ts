import assert from "node:assert/strict";
import { test } from "node:test";

import {
  AgentCreateSchema,
  AgentPatchSchema,
  AgentSchema,
  AgentAvatarSchema,
  DEFAULT_AGENT_AVATAR,
} from "@agent/shared";

test("AgentCreateSchema accepts a minimal agent", () => {
  const parsed = AgentCreateSchema.safeParse({ name: "Researcher" });
  assert.equal(parsed.success, true);
  if (parsed.success) assert.equal(parsed.data.name, "Researcher");
});

test("AgentCreateSchema rejects an empty name", () => {
  const parsed = AgentCreateSchema.safeParse({ name: "" });
  assert.equal(parsed.success, false);
});

test("AgentCreateSchema accepts the full field set", () => {
  const parsed = AgentCreateSchema.safeParse({
    name: "Verifier",
    role: "Cross-checks claims",
    instructions: "Cite a source for every claim.",
    model: "groq:gpt-oss-120b",
    fallbackModels: ["google:gemini-3.8-flash", "openrouter:qwen3.8-27b"],
    avatar: { type: "emoji", value: "✅", color: "#22C55E" },
    isSupervisor: true,
  });
  assert.equal(parsed.success, true);
  if (parsed.success) {
    assert.equal(parsed.data.avatar?.type, "emoji");
    assert.equal(parsed.data.isSupervisor, true);
    assert.equal(parsed.data.fallbackModels?.length, 2);
  }
});

test("AgentPatchSchema makes every field optional but keeps validation", () => {
  assert.equal(AgentPatchSchema.safeParse({}).success, true);
  assert.equal(AgentPatchSchema.safeParse({ role: null }).success, true);
  assert.equal(AgentPatchSchema.safeParse({ instructions: null }).success, true);
  assert.equal(AgentPatchSchema.safeParse({ name: "" }).success, false);
  assert.equal(
    AgentPatchSchema.safeParse({ avatar: { type: "emoji", value: "🤖", color: "blue" } })
      .success,
    false,
  );
});

test("AgentAvatarSchema requires a #rrggbb color", () => {
  assert.equal(
    AgentAvatarSchema.safeParse({ type: "emoji", value: "🤖", color: "#7F9DFF" }).success,
    true,
  );
  assert.equal(
    AgentAvatarSchema.safeParse({ type: "emoji", value: "🤖", color: "blue" }).success,
    false,
  );
  assert.equal(AgentAvatarSchema.safeParse({ type: "hologram", value: "x" }).success, false);
});

test("AgentSchema validates the API response shape", () => {
  const parsed = AgentSchema.safeParse({
    id: "6f9d5a1e-0f3f-4a5e-9c2f-1b2c3d4e5f60",
    name: "Personal",
    role: null,
    instructions: null,
    model: null,
    fallbackModels: [],
    avatar: DEFAULT_AGENT_AVATAR,
    isSupervisor: false,
    toolCount: 4,
    createdAt: "2026-11-18T00:00:00.000Z",
  });
  assert.equal(parsed.success, true);
  if (parsed.success) assert.equal(parsed.data.toolCount, 4);
});

test("AgentSchema rejects a negative tool count", () => {
  const parsed = AgentSchema.safeParse({
    id: "6f9d5a1e-0f3f-4a5e-9c2f-1b2c3d4e5f60",
    name: "Personal",
    role: null,
    instructions: null,
    model: null,
    fallbackModels: [],
    avatar: DEFAULT_AGENT_AVATAR,
    isSupervisor: false,
    toolCount: -1,
    createdAt: "2026-11-18T00:00:00.000Z",
  });
  assert.equal(parsed.success, false);
});
