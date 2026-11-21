import { tool } from "ai";
import { z } from "zod";

import type { Skill } from "@agent/shared";

import { supabaseAdmin } from "@/lib/supabase/server";

/**
 * Reading skills: assignment-guarded loading and the progressive-disclosure
 * prompt index.
 *
 * Security: a skill can only be listed/loaded for an agent it is actually
 * assigned to (both rows filtered by user_id — server code uses the service
 * role). A skill's `tools` may only narrow the agent's tool set; it can never
 * grant tools the agent does not already have.
 */

export const SKILL_COLUMNS =
  "id, user_id, slug, name, description, body, tools, vault_path, git_sha, enabled, updated_at";

export type SkillRow = {
  id: string;
  user_id: string;
  slug: string;
  name: string;
  description: string;
  body: string;
  tools: string[] | null;
  vault_path: string | null;
  git_sha: string | null;
  enabled: boolean;
  updated_at: string;
};

export type SkillAssignmentRow = {
  skill_id: string;
  enabled: boolean;
};

/** Enabled skills assigned to the agent (agent must belong to the user). */
export async function listSkillsForAgent(userId: string, agentId: string): Promise<SkillRow[]> {
  const ownsAgent = await agentOwnedBy(userId, agentId);
  if (!ownsAgent) return [];

  const { data: assignments, error: assignmentError } = await supabaseAdmin()
    .from("agent_skills")
    .select("skill_id, enabled")
    .eq("agent_id", agentId)
    .eq("enabled", true);
  if (assignmentError || !assignments?.length) return [];

  const ids = (assignments as SkillAssignmentRow[]).map((row) => row.skill_id);
  const { data: skills, error } = await supabaseAdmin()
    .from("skills")
    .select(SKILL_COLUMNS)
    .in("id", ids)
    .eq("user_id", userId)
    .eq("enabled", true);
  if (error) throw new Error(`Could not list skills: ${error.message}`);

  return (skills ?? []) as SkillRow[];
}

/**
 * Pure assignment guard: the slug must match an enabled skill that has an
 * enabled assignment for this agent. Kept side-effect-free so it is unit
 * testable; the callers do the fetching.
 */
export function pickAssignedSkill(
  skills: SkillRow[],
  assignments: SkillAssignmentRow[],
  slug: string,
): SkillRow | null {
  const assigned = new Set(
    assignments.filter((row) => row.enabled).map((row) => row.skill_id),
  );
  const skill = skills.find((row) => row.slug === slug && row.enabled);
  if (!skill || !assigned.has(skill.id)) return null;
  return skill;
}

/** Full body of one assigned skill, or null when it is not assigned. */
export async function loadSkillBody(
  userId: string,
  agentId: string,
  slug: string,
): Promise<SkillRow | null> {
  const ownsAgent = await agentOwnedBy(userId, agentId);
  if (!ownsAgent) return null;

  const { data: skill } = await supabaseAdmin()
    .from("skills")
    .select(SKILL_COLUMNS)
    .eq("user_id", userId)
    .eq("slug", slug)
    .eq("enabled", true)
    .maybeSingle();
  if (!skill) return null;

  const { data: assignment } = await supabaseAdmin()
    .from("agent_skills")
    .select("skill_id, enabled")
    .eq("agent_id", agentId)
    .eq("skill_id", (skill as SkillRow).id)
    .maybeSingle();

  return pickAssignedSkill([skill as SkillRow], assignment ? [assignment as SkillAssignmentRow] : [], slug);
}

/** Which agent (if any) a run belongs to. IDs come from the run row, never the model. */
export async function runAgentId(userId: string, runId: string): Promise<string | null> {
  const { data } = await supabaseAdmin()
    .from("agent_runs")
    .select("agent_id")
    .eq("id", runId)
    .eq("user_id", userId)
    .maybeSingle();
  return (data?.agent_id as string | null | undefined) ?? null;
}

async function agentOwnedBy(userId: string, agentId: string): Promise<boolean> {
  const { data } = await supabaseAdmin()
    .from("agents")
    .select("id")
    .eq("id", agentId)
    .eq("user_id", userId)
    .maybeSingle();
  return Boolean(data);
}

// --- API reads/writes ------------------------------------------------------

/** Row → camelCase API skill. */
export function rowToSkill(row: SkillRow, assignedAgentIds: string[]): Skill {
  return {
    id: row.id,
    slug: row.slug,
    name: row.name,
    description: row.description,
    body: row.body,
    tools: row.tools ?? [],
    vaultPath: row.vault_path,
    enabled: row.enabled,
    assignedAgentIds,
    updatedAt: row.updated_at,
  };
}

/** The user's skills, each with the agent ids it is assigned to. */
export async function listSkillsWithAssignments(userId: string): Promise<Skill[]> {
  const { data, error } = await supabaseAdmin()
    .from("skills")
    .select(SKILL_COLUMNS)
    .eq("user_id", userId)
    .order("updated_at", { ascending: false });
  if (error) throw new Error(`Could not list skills: ${error.message}`);

  const rows = (data ?? []) as SkillRow[];
  if (rows.length === 0) return [];

  // Two plain queries (no embedded filters): owned agents + assignments for
  // these skills, then intersect — assignments are only counted when the
  // agent belongs to this user.
  const [{ data: agentRows }, { data: assignmentRows }] = await Promise.all([
    supabaseAdmin().from("agents").select("id").eq("user_id", userId),
    supabaseAdmin()
      .from("agent_skills")
      .select("skill_id, agent_id")
      .in("skill_id", rows.map((row) => row.id)),
  ]);

  const owned = new Set(((agentRows ?? []) as Array<{ id: string }>).map((row) => row.id));
  const bySkill = new Map<string, string[]>();
  for (const row of (assignmentRows ?? []) as Array<{ skill_id: string; agent_id: string }>) {
    if (!owned.has(row.agent_id)) continue;
    const list = bySkill.get(row.skill_id) ?? [];
    list.push(row.agent_id);
    bySkill.set(row.skill_id, list);
  }

  return rows.map((row) => rowToSkill(row, bySkill.get(row.id) ?? []));
}

/**
 * Replaces an agent's whole skill assignment set. All ids are verified to
 * belong to the user first; returns the stored set (deduped, order kept).
 */
export async function setAgentSkills(
  userId: string,
  agentId: string,
  skillIds: string[],
): Promise<string[] | null> {
  if (!(await agentOwnedBy(userId, agentId))) return null;

  const ids = [...new Set(skillIds)];
  if (ids.length > 0) {
    const { data: owned } = await supabaseAdmin()
      .from("skills")
      .select("id")
      .eq("user_id", userId)
      .in("id", ids);
    if ((owned ?? []).length !== ids.length) {
      throw Object.assign(new Error("One or more skill ids are unknown."), {
        status: 400,
        code: "bad_request",
      });
    }
  }

  const admin = supabaseAdmin();
  const { error: clearError } = await admin.from("agent_skills").delete().eq("agent_id", agentId);
  if (clearError) {
    throw new Error(`Could not update skill assignments: ${clearError.message}`);
  }

  if (ids.length > 0) {
    const { error } = await admin.from("agent_skills").insert(
      ids.map((skillId) => ({ agent_id: agentId, skill_id: skillId })),
    );
    if (error) throw new Error(`Could not update skill assignments: ${error.message}`);
  }

  return ids;
}

// --- Prompt index (progressive disclosure) ---------------------------------

/**
 * The only thing the system prompt carries: one line per assigned skill.
 * The body is fetched on demand via `load_skill`.
 */
export function skillIndexSection(
  skills: Array<{ slug: string; name: string; description: string }>,
): string {
  if (skills.length === 0) return "";
  return [
    "Skills assigned to you (progressive disclosure — call load_skill(slug) to read one when the task needs it; only the name and description are shown until you load it):",
    ...skills.map((skill) => `- ${skill.slug}: ${skill.description} (${skill.name})`),
  ].join("\n");
}

/** The agent's skill index for a run, or "" when it has none / no agent. */
export async function loadSkillIndexForRun(runId: string, userId: string): Promise<string> {
  try {
    const agentId = await runAgentId(userId, runId);
    if (!agentId) return "";
    const skills = await listSkillsForAgent(userId, agentId);
    return skillIndexSection(skills);
  } catch (error) {
    console.warn("[skills] could not load the run's skill index:", error);
    return "";
  }
}

// --- Tool narrowing --------------------------------------------------------

/**
 * Intersects a skill's declared allowlist with the agent's current tool set.
 *
 * - `skillTools` null/empty → no narrowing (returns `current` unchanged).
 * - `current` null → the agent is not yet narrowed, so the base set is
 *   everything currently available.
 * - The result never contains a tool outside `current` ∩ `available` —
 *   skills can only ever narrow, never grant.
 */
export function narrowToolSet(
  current: string[] | null,
  available: string[],
  skillTools: string[] | null | undefined,
): string[] | null {
  if (!skillTools || skillTools.length === 0) return current;
  const declared = new Set(skillTools);
  const base = current ?? available;
  return base.filter((name) => declared.has(name));
}

// --- Chat-side tool --------------------------------------------------------

/**
 * `load_skill` for the chat route (AI SDK tool with a real execute). The
 * agent id comes from the request context — never from model arguments.
 */
export function buildSkillTools(context: { userId: string; agentId: string }) {
  return {
    load_skill: tool({
      description:
        "Load the full instructions of a skill assigned to this agent by its slug (slugs come from the skill index in your instructions). Use when the task needs the skill's detailed procedure. A skill may narrow your tool set.",
      inputSchema: z.object({ slug: z.string().min(1).max(80) }),
      execute: async ({ slug }) => {
        const skill = await loadSkillBody(context.userId, context.agentId, slug);
        if (!skill) {
          return { found: false, message: `No skill "${slug}" is assigned to this agent.` };
        }
        return {
          found: true,
          slug: skill.slug,
          name: skill.name,
          description: skill.description,
          tools: skill.tools ?? [],
          body: skill.body.slice(0, 12_000),
        };
      },
    }),
  };
}
