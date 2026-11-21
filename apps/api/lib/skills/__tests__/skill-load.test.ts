import assert from "node:assert/strict";
import { test } from "node:test";

import {
  narrowToolSet,
  pickAssignedSkill,
  skillIndexSection,
  type SkillAssignmentRow,
  type SkillRow,
} from "../load";

const skill = (overrides: Partial<SkillRow> = {}): SkillRow => ({
  id: "skill-1",
  user_id: "user-1",
  slug: "research-brief",
  name: "Research Brief",
  description: "Write structured briefs.",
  body: "Steps…",
  tools: null,
  vault_path: "skills/research-brief/SKILL.md",
  git_sha: "abc",
  enabled: true,
  updated_at: "2026-11-21T00:00:00.000Z",
  ...overrides,
});

// --- narrowToolSet ---------------------------------------------------------

test("a skill without a tools list does not narrow anything", () => {
  assert.equal(narrowToolSet(null, ["a", "b"], []), null);
  assert.equal(narrowToolSet(null, ["a", "b"], null), null);
  assert.deepEqual(narrowToolSet(["a", "b"], ["a", "b", "c"], null), ["a", "b"]);
});

test("a skill narrows the available set when the agent is not yet narrowed", () => {
  assert.deepEqual(
    narrowToolSet(null, ["web_search", "fetch_page", "read_note"], ["web_search"]),
    ["web_search"],
  );
});

test("narrowing never adds a tool outside the current set", () => {
  const result = narrowToolSet(
    ["web_search", "fetch_page"],
    ["web_search", "fetch_page", "read_note", "save_memory"],
    ["web_search", "save_memory", "write_note"],
  );
  assert.deepEqual(result, ["web_search"]);
});

test("narrowing never adds a tool that is not actually available", () => {
  const result = narrowToolSet(null, ["web_search"], ["web_search", "mcp_evil_tool"]);
  assert.deepEqual(result, ["web_search"]);
});

test("narrowing stacks: a second skill intersects the already-narrowed set", () => {
  const once = narrowToolSet(null, ["a", "b", "c"], ["a", "b"]);
  const twice = narrowToolSet(once, ["a", "b", "c"], ["b", "c"]);
  assert.deepEqual(twice, ["b"]);
});

test("a skill declaring only unknown tools narrows to nothing (still no grants)", () => {
  assert.deepEqual(narrowToolSet(null, ["a", "b"], ["nope"]), []);
});

// --- pickAssignedSkill -----------------------------------------------------

test("loads a skill only when it is assigned and enabled", () => {
  const assignments: SkillAssignmentRow[] = [{ skill_id: "skill-1", enabled: true }];
  assert.ok(pickAssignedSkill([skill()], assignments, "research-brief"));
});

test("refuses a skill the agent does not have", () => {
  assert.equal(pickAssignedSkill([skill()], [], "research-brief"), null);
  assert.equal(
    pickAssignedSkill([skill()], [{ skill_id: "other", enabled: true }], "research-brief"),
    null,
  );
});

test("refuses disabled skills and disabled assignments", () => {
  assert.equal(
    pickAssignedSkill([skill({ enabled: false })], [{ skill_id: "skill-1", enabled: true }], "research-brief"),
    null,
  );
  assert.equal(
    pickAssignedSkill([skill()], [{ skill_id: "skill-1", enabled: false }], "research-brief"),
    null,
  );
});

test("refuses an unknown slug even when other skills are assigned", () => {
  const assignments: SkillAssignmentRow[] = [{ skill_id: "skill-1", enabled: true }];
  assert.equal(pickAssignedSkill([skill()], assignments, "something-else"), null);
});

// --- skillIndexSection -----------------------------------------------------

test("the prompt index is name/description lines only (no body)", () => {
  const section = skillIndexSection([
    { slug: "research-brief", name: "Research Brief", description: "Write briefs." },
    { slug: "weekly-review", name: "Weekly Review", description: "Summarize the week." },
  ]);
  assert.match(section, /- research-brief: Write briefs\./);
  assert.match(section, /- weekly-review: Summarize the week\./);
  assert.doesNotMatch(section, /Steps/);
});

test("the prompt index is empty when the agent has no skills", () => {
  assert.equal(skillIndexSection([]), "");
});
