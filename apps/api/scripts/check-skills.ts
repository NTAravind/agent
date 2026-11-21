/**
 * Live end-to-end check for Skills (Phase 8).
 *
 *   npx tsx --env-file=.env.local scripts/check-skills.ts
 *
 * Creates a throwaway agent + skill (DB index only — no vault commits), runs
 * a real agent run against the model, and verifies:
 *   1. the prompt index only carries name/description,
 *   2. load_skill works for an assigned skill and is refused otherwise,
 *   3. the model follows the loaded instructions (marker in the result),
 *   4. a skill's `tools` narrows the run's tool set (timeline event),
 *   5. buildSystemPrompt(agentId) carries the index.
 * Cleans up every row it created.
 */
import { buildSystemPrompt } from "../lib/chat/system-prompt";
import { createRun } from "../lib/agent/runs";
import { runAgent } from "../lib/agent/graph";
import {
  listSkillsForAgent,
  loadSkillBody,
  setAgentSkills,
  skillIndexSection,
} from "../lib/skills/load";
import { upsertSkillIndex } from "../lib/skills/sync";
import { supabaseAdmin } from "../lib/supabase/server";

const SLUG = "skill-check-live";
const MARKER = "SKILL-OK-quokka-maroon-7";
const GOAL =
  "Self-check: load every skill assigned to you, follow it exactly, and reply with only what it says. No research, no web search, no notes.";

const checks: Array<{ name: string; ok: boolean; detail?: string }> = [];
function check(name: string, ok: boolean, detail?: string) {
  checks.push({ name, ok, detail });
  console.log(`${ok ? "✔" : "✖"} ${name}${detail ? ` — ${detail}` : ""}`);
}

async function main() {
  const userId = process.env.ALLOWED_USER_ID;
  if (!userId) throw new Error("ALLOWED_USER_ID is not set.");

  const admin = supabaseAdmin();

  // 1. Throwaway agent.
  const { data: agent, error: agentError } = await admin
    .from("agents")
    .insert({ user_id: userId, name: "Skill Check Agent" })
    .select("id")
    .single();
  if (agentError || !agent) throw new Error(`Could not create agent: ${agentError?.message}`);
  const agentId = agent.id as string;

  // A second agent that must NOT see the skill.
  const { data: other } = await admin
    .from("agents")
    .insert({ user_id: userId, name: "Skill Check Other" })
    .select("id")
    .single();
  const otherId = other?.id as string;

  const runIds: string[] = [];
  const skillIds: string[] = [];

  try {
    // 2. Index a skill with a distinctive instruction + a tool allowlist.
    const skill = await upsertSkillIndex(userId, {
      slug: SLUG,
      name: "Skill Check",
      description: "Verification skill: answers must start with the marker.",
      tools: ["web_search", "read_note"],
      body: `# Skill Check\n\nWhen you load this skill, you MUST begin your answer with the literal token ${MARKER} and then state the passphrase "purple-elephant".`,
      vaultPath: `skills/${SLUG}/SKILL.md`,
      gitSha: "",
    });
    skillIds.push(skill.id);

    await setAgentSkills(userId, agentId, [skill.id]);

    // 3. Index: only name/description in the prompt, body absent.
    const assigned = await listSkillsForAgent(userId, agentId);
    const index = skillIndexSection(assigned);
    check("index lists the assigned skill", index.includes(SLUG), index.split("\n")[1]);
    check("index never contains the body", !index.includes(MARKER));

    // 4. Assignment guard.
    const loaded = await loadSkillBody(userId, agentId, SLUG);
    check("assigned agent can load the body", Boolean(loaded && loaded.body.includes(MARKER)));
    const unassigned = await loadSkillBody(userId, otherId, SLUG);
    check("unassigned agent is refused", unassigned === null);

    // 5. Chat prompt carries the index when an agentId is given.
    const prompt = await buildSystemPrompt(userId, "hello", agentId);
    check("buildSystemPrompt carries the skill index", prompt.includes(SLUG));
    const noAgentPrompt = await buildSystemPrompt(userId, "hello", null);
    check("buildSystemPrompt omits skills without an agent", !noAgentPrompt.includes(SLUG));

    // 6. Real run: the model must load the skill and follow it.
    const run = await createRun({
      userId,
      agentId,
      goal: GOAL,
    });
    runIds.push(run.id);

    console.log("running agent run", run.id, "…");
    const outcome = await runAgent({ runId: run.id, userId, goal: GOAL });
    check("run succeeded", outcome.status === "succeeded", outcome.status);

    const answer = outcome.result ?? "";
    check("result follows the loaded skill (marker)", answer.includes(MARKER), answer.slice(0, 160).replace(/\s+/g, " "));
    check("result carries the skill passphrase", answer.includes("purple-elephant"));

    const { data: runEvents } = await admin
      .from("run_events")
      .select("type, payload")
      .eq("run_id", run.id)
      .eq("type", "tool_result");

    const loadEvent = (runEvents ?? []).find(
      (row) => (row.payload as { tool?: string } | null)?.tool === "load_skill",
    );
    check("run timeline shows load_skill", Boolean(loadEvent));

    const { data: gateEvents } = await admin
      .from("run_events")
      .select("type, payload")
      .eq("run_id", run.id)
      .eq("type", "node_end");

    const narrowed = (gateEvents ?? []).find(
      (row) => (row.payload as { toolAllow?: string[] } | null)?.toolAllow !== undefined,
    );
    const allow = (narrowed?.payload as { toolAllow?: string[] } | null)?.toolAllow;
    check(
      "tool set narrowed to the skill's allowlist",
      Array.isArray(allow) && allow.join(",") === "web_search,read_note",
      JSON.stringify(allow),
    );
  } finally {
    // Cleanup: run events → run → assignments (cascade) → skill → agents.
    for (const runId of runIds) {
      await admin.from("run_events").delete().eq("run_id", runId);
      await admin.from("agent_runs").delete().eq("id", runId).eq("user_id", userId);
    }
    for (const skillId of skillIds) {
      await admin.from("skills").delete().eq("id", skillId).eq("user_id", userId);
    }
    if (otherId) await admin.from("agents").delete().eq("id", otherId).eq("user_id", userId);
    await admin.from("agents").delete().eq("id", agentId).eq("user_id", userId);
    console.log("cleaned up test rows.");
  }

  const failed = checks.filter((entry) => !entry.ok);
  console.log(`\n${checks.length - failed.length}/${checks.length} checks passed.`);
  if (failed.length > 0) process.exit(1);
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
