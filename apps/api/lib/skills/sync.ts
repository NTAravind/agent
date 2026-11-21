import { SkillFrontmatterSchema, SKILL_SLUG_RE } from "@agent/shared";

import { supabaseAdmin } from "@/lib/supabase/server";
import { parseFrontmatter } from "@/lib/vault/parse";
import { SKILL_COLUMNS, type SkillRow } from "@/lib/skills/load";

/**
 * Vault → index sync for skills.
 *
 * The GitHub vault is the source of truth: a skill is a markdown file at
 * `skills/<slug>/SKILL.md` with frontmatter. Supabase only holds the rebuilt
 * index (name/description for the prompt, body for `load_skill`) — no
 * chunking or embedding is needed for skills.
 */

/** `skills/<slug>/SKILL.md` — exactly one level under skills/. */
export function isSkillVaultPath(path: string): boolean {
  return /^skills\/[^/]+\/SKILL\.md$/.test(path);
}

export function skillSlugFromPath(path: string): string | null {
  const match = /^skills\/([^/]+)\/SKILL\.md$/.exec(path);
  const slug = match?.[1];
  return slug && SKILL_SLUG_RE.test(slug) ? slug : null;
}

export type ParsedSkill = {
  slug: string;
  name: string;
  description: string;
  tools: string[];
  body: string;
};

/** Max stored body — skills are instruction bundles, not notes. */
export const MAX_SKILL_BODY = 40_000;

/**
 * Parses a SKILL.md file. Returns null when the path is not a skill path or
 * the frontmatter is missing/invalid (name + description are required — the
 * description is what the system prompt shows).
 */
export function parseSkillFile(path: string, content: string): ParsedSkill | null {
  const slug = skillSlugFromPath(path);
  if (!slug) return null;

  const { frontmatter, body } = parseFrontmatter(content);
  const parsed = SkillFrontmatterSchema.safeParse(frontmatter ?? {});
  if (!parsed.success) return null;

  const tools = Array.isArray(parsed.data.tools)
    ? [...new Set(parsed.data.tools.map((entry) => entry.trim()).filter(Boolean))]
    : [];

  return {
    slug,
    name: parsed.data.name.trim(),
    description: parsed.data.description.trim().slice(0, 200),
    tools,
    body: body.replace(/^\r?\n/, "").trimEnd().slice(0, MAX_SKILL_BODY),
  };
}

/** Frontmatter values are single-line in our mini parser — collapse newlines. */
function frontmatterValue(value: string): string {
  return value.replace(/\s*\r?\n\s*/g, " ").trim();
}

/** Serializes a skill back into SKILL.md (create/edit from the app). */
export function composeSkillFile(input: {
  name: string;
  description: string;
  tools?: string[];
  body?: string;
}): string {
  const lines = [
    "---",
    `name: ${frontmatterValue(input.name)}`,
    `description: ${frontmatterValue(input.description)}`,
  ];
  const tools = (input.tools ?? []).map((entry) => entry.trim()).filter(Boolean);
  if (tools.length > 0) {
    lines.push("tools:");
    for (const entry of tools) lines.push(`  - ${entry}`);
  }
  lines.push("---", "", (input.body ?? "").trim(), "");
  return lines.join("\n");
}

/** `Research Brief (v2)` → `research-brief-v2`. */
export function slugifyName(name: string): string {
  const slug = name
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 60)
    .replace(/-+$/g, "");
  return SKILL_SLUG_RE.test(slug) ? slug : "skill";
}

/** Upserts the index row for one vault skill file (onConflict: user_id, slug). */
export async function upsertSkillIndex(
  userId: string,
  input: {
    slug: string;
    name: string;
    description: string;
    tools: string[];
    body: string;
    vaultPath: string;
    gitSha: string;
  },
): Promise<SkillRow> {
  const { data, error } = await supabaseAdmin()
    .from("skills")
    .upsert(
      {
        user_id: userId,
        slug: input.slug,
        name: input.name,
        description: input.description,
        body: input.body,
        tools: input.tools,
        vault_path: input.vaultPath,
        git_sha: input.gitSha,
        updated_at: new Date().toISOString(),
      },
      { onConflict: "user_id,slug" },
    )
    .select(SKILL_COLUMNS)
    .single();

  if (error || !data) {
    throw new Error(`Could not index skill ${input.slug}: ${error?.message ?? "upsert failed"}`);
  }
  return data as SkillRow;
}

/**
 * Deletes index rows whose vault file disappeared in this sync. Only rows
 * with a vault_path are considered (app-created rows always get one when the
 * vault is configured).
 */
export async function removeMissingSkills(
  userId: string,
  seenVaultPaths: Set<string>,
): Promise<number> {
  const { data } = await supabaseAdmin()
    .from("skills")
    .select("id, vault_path")
    .eq("user_id", userId)
    .not("vault_path", "is", null);

  let removed = 0;
  for (const row of (data ?? []) as Array<{ id: string; vault_path: string | null }>) {
    if (!row.vault_path || seenVaultPaths.has(row.vault_path)) continue;
    const { error } = await supabaseAdmin()
      .from("skills")
      .delete()
      .eq("id", row.id)
      .eq("user_id", userId);
    if (!error) removed += 1;
  }
  return removed;
}
