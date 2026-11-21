import { z } from "zod";

/** Skills: reusable instruction bundles stored in the vault as SKILL.md files. */

/** Vault slug: lowercase kebab, e.g. "research-brief". */
export const SKILL_SLUG_RE = /^[a-z0-9]+(?:-[a-z0-9]+)*$/;

export const skillSlugSchema = z
  .string()
  .min(1)
  .max(60)
  .regex(SKILL_SLUG_RE, "use lowercase letters, digits and hyphens");

/**
 * Frontmatter of `skills/<slug>/SKILL.md`. `description` is the one-liner the
 * system prompt shows (progressive disclosure); `tools` is an allowlist that
 * can only ever narrow the agent's tool set.
 */
export const SkillFrontmatterSchema = z.object({
  name: z.string().min(1).max(80),
  description: z.string().min(1).max(200),
  tools: z.array(z.string().min(1).max(100)).max(50).optional(),
});
export type SkillFrontmatter = z.infer<typeof SkillFrontmatterSchema>;

/** Skill as API responses return it (camelCase). */
export const SkillSchema = z.object({
  id: z.string().uuid(),
  slug: skillSlugSchema,
  name: z.string(),
  description: z.string(),
  body: z.string(),
  tools: z.array(z.string()),
  vaultPath: z.string().nullable(),
  enabled: z.boolean(),
  /** Agents this skill is assigned to (from agent_skills). */
  assignedAgentIds: z.array(z.string().uuid()),
  updatedAt: z.string(),
});
export type Skill = z.infer<typeof SkillSchema>;

/** POST /api/skills body. `slug` defaults to a slugified `name`. */
export const SkillCreateSchema = z.object({
  slug: skillSlugSchema.optional(),
  name: z.string().min(1).max(80),
  description: z.string().min(1).max(200),
  body: z.string().max(40_000).default(""),
  tools: z.array(z.string().min(1).max(100)).max(50).optional(),
  enabled: z.boolean().optional(),
});
export type SkillCreate = z.infer<typeof SkillCreateSchema>;

/** PATCH /api/skills/:id body — every field optional. */
// `.partial()` alone is not enough: in Zod v4 a `.default()` inside the
// schema still fills in when the key is absent (body would become ""), which
// would wipe content on an enabled-only patch. Override `body` to plain
// optional so "absent" means "keep the current value".
export const SkillPatchSchema = SkillCreateSchema.partial().extend({
  body: z.string().max(40_000).optional(),
});
export type SkillPatch = z.infer<typeof SkillPatchSchema>;

/** PUT /api/agents/:id/skills body — the full assignment set for the agent. */
export const AgentSkillsPutSchema = z.object({
  skillIds: z.array(z.string().uuid()).max(100),
});
export type AgentSkillsPut = z.infer<typeof AgentSkillsPutSchema>;
