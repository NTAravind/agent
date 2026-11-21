import assert from "node:assert/strict";
import { test } from "node:test";

import { SkillPatchSchema } from "@agent/shared";

import { parseFrontmatter } from "../../vault/parse";
import {
  composeSkillFile,
  isSkillVaultPath,
  parseSkillFile,
  skillSlugFromPath,
  slugifyName,
} from "../sync";

test("isSkillVaultPath only accepts skills/<slug>/SKILL.md", () => {
  assert.equal(isSkillVaultPath("skills/research-brief/SKILL.md"), true);
  assert.equal(isSkillVaultPath("skills/SKILL.md"), false);
  assert.equal(isSkillVaultPath("skills/a/b/SKILL.md"), false);
  assert.equal(isSkillVaultPath("skills/research-brief/skill.md"), false);
  assert.equal(isSkillVaultPath("notes/skills/x/SKILL.md"), false);
  assert.equal(isSkillVaultPath("Projects/Idea.md"), false);
});

test("skillSlugFromPath extracts a valid slug only", () => {
  assert.equal(skillSlugFromPath("skills/research-brief/SKILL.md"), "research-brief");
  assert.equal(skillSlugFromPath("skills/Bad Slug/SKILL.md"), null);
  assert.equal(skillSlugFromPath("Projects/Idea.md"), null);
});

test("parseSkillFile reads frontmatter, tools and body", () => {
  const content = [
    "---",
    "name: Research Brief",
    "description: Write structured research briefs with citations.",
    "tools:",
    "  - web_search",
    "  - fetch_page",
    "---",
    "",
    "# Research Brief",
    "",
    "Always cite sources.",
    "",
  ].join("\n");

  const parsed = parseSkillFile("skills/research-brief/SKILL.md", content);
  assert.ok(parsed);
  assert.equal(parsed.slug, "research-brief");
  assert.equal(parsed.name, "Research Brief");
  assert.equal(parsed.description, "Write structured research briefs with citations.");
  assert.deepEqual(parsed.tools, ["web_search", "fetch_page"]);
  assert.match(parsed.body, /^# Research Brief/);
  assert.doesNotMatch(parsed.body, /^---/);
});

test("parseSkillFile tolerates a missing tools list", () => {
  const content = ["---", "name: Plain", "description: No tools here.", "---", "", "Body."].join(
    "\n",
  );
  const parsed = parseSkillFile("skills/plain/SKILL.md", content);
  assert.ok(parsed);
  assert.deepEqual(parsed.tools, []);
});

test("parseSkillFile rejects missing description and bad paths", () => {
  const noDescription = ["---", "name: NoDesc", "---", "Body"].join("\n");
  assert.equal(parseSkillFile("skills/no-desc/SKILL.md", noDescription), null);
  assert.equal(
    parseSkillFile("Projects/Idea.md", "---\nname: x\ndescription: y\n---\n"),
    null,
  );
});

test("parseFrontmatter grows a list under an empty key (tools: + - items)", () => {
  const { frontmatter } = parseFrontmatter(
    ["---", "name: X", "tools:", "  - web_search", "  - read_note", "---", "body"].join("\n"),
  );
  assert.ok(frontmatter);
  assert.deepEqual(frontmatter.tools, ["web_search", "read_note"]);
});

test("composeSkillFile round-trips through parseSkillFile", () => {
  const file = composeSkillFile({
    name: "Weekly Review",
    description: "Summarize the week every Friday.",
    tools: ["web_search", "search_notes"],
    body: "# Review\n\nSteps here.",
  });
  const parsed = parseSkillFile("skills/weekly-review/SKILL.md", file);
  assert.ok(parsed);
  assert.equal(parsed.name, "Weekly Review");
  assert.equal(parsed.description, "Summarize the week every Friday.");
  assert.deepEqual(parsed.tools, ["web_search", "search_notes"]);
  assert.equal(parsed.body, "# Review\n\nSteps here.");
});

test("composeSkillFile omits the tools block when empty", () => {
  const file = composeSkillFile({ name: "X", description: "Y", body: "Z" });
  assert.doesNotMatch(file, /tools:/);
  const parsed = parseSkillFile("skills/x/SKILL.md", file);
  assert.ok(parsed);
  assert.deepEqual(parsed.tools, []);
});

test("slugifyName produces kebab slugs and never an empty one", () => {
  assert.equal(slugifyName("Research Brief (v2)"), "research-brief-v2");
  assert.equal(slugifyName("  Weekly   Review  "), "weekly-review");
  assert.equal(slugifyName("!!!"), "skill");
  assert.equal(slugifyName("UPPER"), "upper");
});

test("SkillPatchSchema keeps absent fields absent (no default body wipe)", () => {
  // Regression: `.partial()` over a `.default("")` field used to fill body in
  // as "", which wiped content on an enabled-only PATCH (DB and GitHub).
  const enabledOnly = SkillPatchSchema.safeParse({ enabled: false });
  assert.ok(enabledOnly.success);
  assert.equal("body" in enabledOnly.data, false);
  assert.equal("name" in enabledOnly.data, false);
  assert.equal(enabledOnly.data.enabled, false);

  const bodyPatch = SkillPatchSchema.safeParse({ body: "new body" });
  assert.ok(bodyPatch.success);
  assert.equal(bodyPatch.data.body, "new body");
});
