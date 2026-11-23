import { z } from "zod";
import { isStepCount, tool, type ToolSet } from "ai";

import { insertMessage } from "@/lib/chat/persist";
import {
  PRIVATE_HANDOFF_BLOCKED,
  buildHandoffBrief,
  handoffAllowedForPrivacy,
  privateModelChain,
} from "@/lib/groups/privacy";
import type { GroupHandoff, GroupToolContext } from "@/lib/groups/types";
import { getGroupRuntime } from "@/lib/groups/store";
import { defaultMobileModel } from "@/lib/models/catalog";
import { generateTextWithFallback } from "@/lib/models/generate";
import {
  DEFAULT_FALLBACK_ORDER,
  DEFAULT_MODEL_ID,
  findRegistryEntry,
} from "@/lib/models/registry";
import { supabaseAdmin } from "@/lib/supabase/server";

/**
 * Group tools (Phase 11).
 *
 * The calling agent is always read from the persisted run context — never
 * from model arguments. Handoff and consult targets are resolved against the
 * server-loaded member list, so a model cannot reach an agent outside its
 * group. The privacy boundary is enforced here too: a member whose model may
 * read private context cannot hand that context to a member whose model may
 * not, whatever the model writes in `task` or `question`.
 */

export const GROUP_TOOL_NAMES = ["handoff_to", "ask_agent", "post_to_group"] as const;
export type GroupToolName = (typeof GROUP_TOOL_NAMES)[number];

export const groupToolDeclarations = {
  handoff_to: {
    description:
      "Hand the task to another member of this agent group and end your turn. Use the member's exact name. The target must be a current group member.",
    inputSchema: z.object({
      agent: z.string().min(1).max(120).describe("Exact name or id of the group member."),
      task: z.string().min(3).max(2_000).describe("Self-contained task for the next member."),
      context: z.string().max(4_000).optional().describe("Optional concise context for the next member."),
    }),
  },
  ask_agent: {
    description:
      "Ask another group member a quick question and receive their answer without giving up your turn. The target must be a current group member.",
    inputSchema: z.object({
      agent: z.string().min(1).max(120).describe("Exact name or id of the group member."),
      question: z.string().min(3).max(2_000).describe("A focused question for the member."),
    }),
  },
  post_to_group: {
    description:
      "Post a visible progress update to the group chat. Use this for milestones or blockers; it does not hand off control.",
    inputSchema: z.object({
      message: z.string().min(1).max(2_000).describe("A concise progress update for the user."),
    }),
  },
} as const;

export function isGroupTool(name: string): name is GroupToolName {
  return (GROUP_TOOL_NAMES as readonly string[]).includes(name);
}

function normalize(value: string): string {
  return value.trim().toLocaleLowerCase().replace(/[\s_-]+/g, " ");
}

/** Resolves a model-provided member reference against the server member list. */
export function resolveGroupMember(
  reference: string,
  members: GroupToolContext["members"],
): GroupToolContext["members"][number] | null {
  const wanted = normalize(reference);
  return (
    members.find((member) => member.id === reference) ??
    members.find((member) => normalize(member.name) === wanted) ??
    null
  );
}

/** Whether a nested consult is allowed at the given depth. */
export function evaluateAskDepth(depth: number, maxDepth: number): boolean {
  return Number.isInteger(depth) && depth >= 0 && depth < maxDepth;
}

/**
 * The tools a quick consult may use.
 *
 * A consult may ask one more member for help while it is answering, but it
 * may never hand off (a consult is not a turn) and its own consults run one
 * level deeper, so the group's depth limit is a real limit rather than a
 * check no code path can fail.
 */
function nestedConsultTools(
  context: GroupToolContext & { runId: string; userId: string },
  onTokens: (tokens: number) => void,
): ToolSet {
  return {
    ask_agent: tool({
      description: groupToolDeclarations.ask_agent.description,
      inputSchema: groupToolDeclarations.ask_agent.inputSchema as z.ZodType,
      execute: async (args) => {
        const nested = await executeGroupTool(
          { name: "ask_agent", args: (args ?? {}) as Record<string, unknown> },
          { ...context, depth: context.depth + 1, canHandoff: false },
        );
        const result = nested as { answer?: string; tokensUsed?: number };
        if (Number.isFinite(result.tokensUsed)) onTokens(Number(result.tokensUsed));
        return result.answer ?? "";
      },
    }),
  };
}

/** The model registry is the source of truth for private-context access. */
export function modelAllowsPrivate(modelId: string): boolean {
  const entry = findRegistryEntry(modelId);
  if (entry) return entry.privateOk;
  return modelId.startsWith("google:");
}

async function targetModel(member: { model: string | null }): Promise<string> {
  if (member.model) return member.model;
  return (await defaultMobileModel()) ?? DEFAULT_MODEL_ID;
}

async function targetPrivateOk(member: { model: string | null }): Promise<boolean> {
  return modelAllowsPrivate(await targetModel(member));
}

function toolError(message: string): Error & { toolResult?: true } {
  return Object.assign(new Error(message), { toolResult: true as const });
}

/**
 * Builds the quick-consult prompt under the target's privacy policy. A
 * non-private target receives the explicit question only: neither the
 * caller's prior task nor the rolling group summary may cross that boundary.
 */
export function buildConsultPrompt(input: {
  targetName: string;
  callerBrief: string;
  question: string;
  summary?: string;
  privateOk: boolean;
}): string {
  const safe = buildHandoffBrief(
    {
      task: input.question,
      ...(input.summary ? { summary: input.summary } : {}),
    },
    input.privateOk,
  );
  return [
    `You are ${input.targetName}, a member of an agent group. Answer the caller's question directly and concisely.`,
    ...(input.privateOk ? [`Caller task: ${input.callerBrief}`] : []),
    `Question: ${safe.task}`,
    ...(safe.summary ? [`Group context:\n${safe.summary}`] : []),
  ].join("\n\n");
}

export type GroupToolResult =
  | { handoff: GroupHandoff }
  | {
      consultedAgentId: string;
      consultedAgentName: string;
      answer: string;
      /** Input + output tokens spent by the consult, charged to the group budget. */
      tokensUsed: number;
    }
  | { posted: true; messageId?: string };

/**
 * Executes one group tool. The graph calls this only after its normal tool
 * gate, so group tools never bypass the approval policy.
 */
export async function executeGroupTool(
  call: { name: string; args: Record<string, unknown> },
  context: GroupToolContext & { runId: string; userId: string },
): Promise<GroupToolResult> {
  const name = call.name as GroupToolName;
  const args = call.args ?? {};

  if (name === "post_to_group") {
    const parsed = z.object({ message: z.string().min(1).max(2_000) }).parse(args);
    if (!context.threadId) {
      throw toolError("This group turn has no chat thread, so progress cannot be posted.");
    }
    await insertMessage(
      context.userId,
      context.threadId,
      "assistant",
      [{ type: "text", text: parsed.message }],
      null,
      {
        fromAgentId: context.actingAgentId,
        runId: context.runId,
        optional: true,
      },
    );
    return { posted: true };
  }

  if (name === "handoff_to") {
    if (!context.canHandoff) {
      throw toolError(
        "This turn may not hand off: it is a nested consult, not a group member turn.",
      );
    }
    const parsed = z
      .object({
        agent: z.string().min(1).max(120),
        task: z.string().min(3).max(2_000),
        context: z.string().max(4_000).optional(),
      })
      .parse(args);
    const target = resolveGroupMember(parsed.agent, context.members);
    if (!target) {
      throw toolError(
        `"${parsed.agent}" is not a member of this group. Choose one of: ${context.members
          .map((member) => member.name)
          .join(", ")}.`,
      );
    }
    if (target.id === context.actingAgentId) {
      throw toolError("You cannot hand off to yourself. Choose another group member.");
    }

    const privateOk = await targetPrivateOk(target);
    const callerPrivateOk = context.privateAllowed;
    if (!handoffAllowedForPrivacy(callerPrivateOk, privateOk)) {
      throw toolError(PRIVATE_HANDOFF_BLOCKED);
    }
    const safe = buildHandoffBrief(
      {
        task: parsed.task,
        ...(parsed.context ? { context: parsed.context } : {}),
        ...(context.summary ? { summary: context.summary } : {}),
      },
      privateOk,
    );

    return {
      handoff: {
        from: context.actingAgentId,
        to: target.id,
        toName: target.name,
        task: safe.task,
        ...(safe.context ? { context: safe.context } : {}),
      },
    };
  }

  if (name === "ask_agent") {
    const parsed = z
      .object({
        agent: z.string().min(1).max(120),
        question: z.string().min(3).max(2_000),
      })
      .parse(args);
    if (!evaluateAskDepth(context.depth, context.maxDepth)) {
      throw toolError(
        `Nested consult depth ${context.depth + 1} exceeds the group limit of ${context.maxDepth}.`,
      );
    }
    const target = resolveGroupMember(parsed.agent, context.members);
    if (!target) {
      throw toolError(
        `"${parsed.agent}" is not a member of this group. Choose one of: ${context.members
          .map((member) => member.name)
          .join(", ")}.`,
      );
    }

    const privateOk = await targetPrivateOk(target);
    const callerPrivateOk = context.privateAllowed;
    if (!handoffAllowedForPrivacy(callerPrivateOk, privateOk)) {
      throw toolError(PRIVATE_HANDOFF_BLOCKED);
    }
    const model = await targetModel(target);

    // Nested consults spend tokens too; they are charged to the group budget
    // through the member turn's usage sink.
    let nestedTokens = 0;

    const { text, result: generation } = await generateTextWithFallback({
      prompt: buildConsultPrompt({
        targetName: target.name,
        callerBrief: context.brief,
        question: parsed.question,
        ...(context.summary ? { summary: context.summary } : {}),
        privateOk,
      }),
      system:
        "This is a quick consult. Give only the answer the caller needs. Do not invent facts and do not ask follow-up questions.",
      modelIds: privateOk
        ? privateModelChain(model)
        : [model, DEFAULT_MODEL_ID, ...DEFAULT_FALLBACK_ORDER.filter((id) => id !== model)],
      userId: context.userId,
      runId: context.runId,
      maxOutputTokens: 1_200,
      // One nested consult per consult, bounded by the group's depth limit:
      // the consulted member may ask exactly one other member before it
      // answers, which is what makes `maxDepth` a reachable guardrail rather
      // than a check no code path can ever fail.
      ...(evaluateAskDepth(context.depth + 1, context.maxDepth)
        ? {
            tools: nestedConsultTools(context, (tokens) => {
              nestedTokens += tokens;
            }),
            stopWhen: isStepCount(3),
          }
        : {}),
    });

    return {
      consultedAgentId: target.id,
      consultedAgentName: target.name,
      answer: text,
      tokensUsed:
        Number(generation.usage?.inputTokens ?? 0) +
        Number(generation.usage?.outputTokens ?? 0) +
        nestedTokens,
    };
  }

  throw toolError(`Unknown group tool "${call.name}".`);
}

/**
 * Loads a persisted group context from a child run (approval resume path).
 *
 * The persisted snapshot is never trusted for membership or privacy: while a
 * run waits for an approval, the user may have removed the acting member,
 * changed the group's lead, or changed a member's model. The live group is
 * re-read here, and the acting member is resolved from the run row's
 * `agent_id` — the one field the server itself wrote.
 */
export async function loadGroupToolContextForRun(
  userId: string,
  runId: string,
): Promise<(GroupToolContext & { runId: string; userId: string }) | null> {
  const { data, error } = await supabaseAdmin()
    .from("agent_runs")
    .select("id, group_id, group_context, group_depth, agent_id, parent_run_id")
    .eq("id", runId)
    .eq("user_id", userId)
    .maybeSingle();
  if (error) throw new Error(`Could not load the group run context: ${error.message}`);
  if (!data?.group_id) return null;

  const raw = (data.group_context ?? {}) as Partial<GroupToolContext>;
  if (
    typeof raw.groupId !== "string" ||
    typeof raw.parentRunId !== "string" ||
    !Array.isArray(raw.members)
  ) {
    return null;
  }

  // Live membership + live model policy. A member removed while the run was
  // parked may no longer act, and its target set may have changed.
  const group = await getGroupRuntime(userId, data.group_id);
  if (!group) return null;

  const actingAgentId = (data.agent_id as string | null) ?? null;
  if (!actingAgentId) return null;
  const actor = group.members.find((member) => member.id === actingAgentId);
  // The acting member was removed from the group while the run was parked.
  if (!actor) return null;

  const privateAllowed = modelAllowsPrivate(await targetModel(actor));

  return {
    groupId: group.id,
    parentRunId: (data.parent_run_id as string | null) ?? raw.parentRunId,
    threadId: typeof raw.threadId === "string" ? raw.threadId : null,
    actingAgentId,
    mode: group.mode,
    members: group.members.map((member) => ({
      id: member.id,
      name: member.name,
      model: member.model,
    })),
    brief: typeof raw.brief === "string" ? raw.brief : "",
    summary: typeof raw.summary === "string" ? raw.summary : "",
    depth: Number.isInteger(raw.depth) ? Number(raw.depth) : Number(data.group_depth ?? 0),
    maxDepth: Number.isInteger(raw.maxDepth) ? Number(raw.maxDepth) : 2,
    privateAllowed,
    canHandoff: raw.canHandoff !== false,
    runId: data.id as string,
    userId,
  };
}
