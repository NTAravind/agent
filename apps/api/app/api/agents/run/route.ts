import { z } from "zod";

import { requireUser, toErrorResponse } from "@/lib/auth";
import { executeRun } from "@/lib/agent/execute";
import { createRun } from "@/lib/agent/runs";
import { resolveTaskThreadScope } from "@/lib/agent/task-thread";
import {
  bindThreadToAgent,
  createThread,
  insertMessage,
  titleFromParts,
} from "@/lib/chat/persist";
import { getGroupRuntime } from "@/lib/groups/store";
import { inngest } from "@/lib/inngest/client";
import { agentRunRequested } from "@/lib/inngest/events";
import { defaultMobileModel, primeMobileModel } from "@/lib/models/catalog";
import { supabaseAdmin } from "@/lib/supabase/server";
import { defaultAgentId } from "@/lib/mcp/tools-loader";

/**
 * POST /api/agents/run — start an agent or dynamic-group run.
 *
 * Ordinary body: { goal, threadId?, inline?, model?, agentId?, tz? }.
 * Group body: { groupId?, goal, threadId?, inline?, tz? }. A thread that
 * already belongs to a group routes to that group even when groupId is
 * omitted; otherwise a group thread is created on demand. Group member
 * turns are persisted as child runs under the parent group run.
 */
export async function POST(request: Request) {
  try {
    const user = await requireUser(request);
    const body = (await request.json().catch(() => ({}))) as {
      goal?: string;
      threadId?: string;
      inline?: boolean;
      model?: string;
      agentId?: string;
      groupId?: string;
      /** The user's timezone — relative dates in the goal resolve against it. */
      tz?: string;
    };

    const goal = body.goal?.trim();
    if (!goal || goal.length < 3) {
      return Response.json(
        { error: { code: "bad_request", message: "A goal of at least 3 characters is required." } },
        { status: 400 },
      );
    }

    if (body.groupId && !z.string().uuid().safeParse(body.groupId).success) {
      return Response.json(
        { error: { code: "bad_request", message: "Invalid group id." } },
        { status: 400 },
      );
    }
    if (body.threadId && !z.string().uuid().safeParse(body.threadId).success) {
      return Response.json(
        { error: { code: "bad_request", message: "Invalid thread id." } },
        { status: 400 },
      );
    }

    // Resolve an existing thread first. A group-thread message is a valid
    // group entry point without repeating the group id in every request.
    let threadId = body.threadId ?? null;
    let threadGroupId: string | null = null;
    let threadAgentId: string | null = null;
    let threadExists = false;
    if (threadId) {
      const { data: thread } = await supabaseAdmin()
        .from("threads")
        .select("id, group_id, agent_id")
        .eq("id", threadId)
        .eq("user_id", user.id)
        .maybeSingle();
      if (thread) {
        threadExists = true;
        threadGroupId = (thread as { group_id?: string | null }).group_id ?? null;
        threadAgentId = (thread as { agent_id?: string | null }).agent_id ?? null;
      } else if (body.groupId) {
        return Response.json(
          { error: { code: "not_found", message: "Unknown thread." } },
          { status: 404 },
        );
      }
      // A client-generated ordinary thread id may not exist yet. Task Mode
      // creates it below, preserving the id so subsequent chat turns continue
      // the same conversation.
    }

    const groupId = body.groupId ?? threadGroupId;
    if (groupId) {
      if (body.groupId && threadGroupId && body.groupId !== threadGroupId) {
        return Response.json(
          { error: { code: "bad_request", message: "That thread belongs to a different group." } },
          { status: 400 },
        );
      }
      // A group run owns its agent and model: members each bring their own.
      // Silently dropping an explicit agentId/model would hide a client bug.
      if (body.agentId || body.model) {
        return Response.json(
          {
            error: {
              code: "bad_request",
              message:
                "Group runs pick each member's agent and model from the group itself; agentId and model are not accepted here.",
            },
          },
          { status: 400 },
        );
      }

      const group = await getGroupRuntime(user.id, groupId);
      if (!group) {
        return Response.json(
          { error: { code: "not_found", message: "No such group." } },
          { status: 404 },
        );
      }
      if (group.members.length === 0 || !group.leadAgentId) {
        return Response.json(
          { error: { code: "conflict", message: "Choose a lead agent before starting this group." } },
          { status: 409 },
        );
      }
      // A sleeping member (or lead) must be woken before the group may route
      // to it — the same rule ordinary runs enforce for a single agent.
      const asleep = group.members.filter((member) => member.sleeping);
      if (asleep.length > 0) {
        return Response.json(
          {
            error: {
              code: "conflict",
              message: `${asleep.map((member) => member.name).join(", ")} ${asleep.length === 1 ? "is" : "are"} asleep — wake ${asleep.length === 1 ? "it" : "them"} before starting this group run.`,
            },
          },
          { status: 409 },
        );
      }
      // One live parent run per group thread: two concurrent parents would
      // interleave member turns in the same durable conversation.
      const { data: busyRun } = await supabaseAdmin()
        .from("agent_runs")
        .select("id")
        .eq("group_id", group.id)
        .is("parent_run_id", null)
        .in("status", ["queued", "running", "awaiting_approval", "paused"])
        .limit(1)
        .maybeSingle();
      if (busyRun) {
        return Response.json(
          {
            error: {
              code: "conflict",
              message: "This group already has a run in flight. Wait for it to finish or cancel it first.",
            },
          },
          { status: 409 },
        );
      }

      if (!threadId) {
        const thread = await createThread(user.id, {
          title: group.name,
          model: null,
          groupId: group.id,
        });
        threadId = thread.id;
      } else if (!threadGroupId) {
        return Response.json(
          { error: { code: "bad_request", message: "Use a group thread for this group run." } },
          { status: 400 },
        );
      }

      // The run row exists first so the user's message can be linked to it.
      const run = await createRun({
        userId: user.id,
        goal,
        threadId,
        agentId: null,
        model: null,
        tz: body.tz ?? null,
        groupId: group.id,
      });

      // The user's message is part of the durable group conversation. The
      // member graph receives a compact brief, never this full transcript.
      await insertMessage(
        user.id,
        threadId,
        "user",
        [{ type: "text", text: goal }],
        null,
        { runId: run.id },
      );

      if (body.inline) {
        const result = await executeRun({
          runId: run.id,
          userId: user.id,
          goal,
          tz: body.tz,
        });
        return Response.json({
          runId: run.id,
          status: result.status,
          groupId: group.id,
          threadId,
        });
      }

      await inngest.send(
        agentRunRequested.create({
          runId: run.id,
          userId: user.id,
          goal,
          threadId,
          groupId: group.id,
          ...(body.tz ? { tz: body.tz } : {}),
        }),
      );
      return Response.json(
        { runId: run.id, status: "queued", groupId: group.id, threadId },
        { status: 202 },
      );
    }

    const preferredModel = body.model ?? await defaultMobileModel({ tools: true, structuredOutput: true });
    if (!preferredModel || !(await primeMobileModel(preferredModel))) {
      return Response.json({ error: { code: "bad_request", message: "Choose a model enabled in the provider dashboard." } }, { status: 400 });
    }

    // The thread's persisted agent remains authoritative. An omitted agent
    // falls back to the user's default only when the thread has no owner yet.
    const fallbackAgentId =
      !body.agentId && !threadAgentId
        ? await defaultAgentId(user.id).catch(() => null)
        : null;
    const scope = resolveTaskThreadScope({
      hasThread: threadExists,
      storedAgentId: threadAgentId,
      requestedAgentId: body.agentId ?? null,
      fallbackAgentId,
    });
    if (!scope.ok) {
      return Response.json(
        { error: { code: scope.code, message: scope.message } },
        { status: 409 },
      );
    }

    // Resolve the target agent (must own it) and enforce its sleep state.
    let agentId: string | null = scope.agentId;
    if (agentId) {
      const { data: agent } = await supabaseAdmin()
        .from("agents")
        .select("id, sleeping")
        .eq("id", agentId)
        .eq("user_id", user.id)
        .maybeSingle();
      if (!agent) {
        return Response.json(
          { error: { code: "not_found", message: "Unknown agent." } },
          { status: 404 },
        );
      }
      if ((agent as { sleeping?: boolean }).sleeping) {
        return Response.json(
          { error: { code: "conflict", message: "That agent is asleep — wake it before starting a task." } },
          { status: 409 },
        );
      }
      agentId = (agent as { id: string }).id;
    }

    // Create the ordinary conversation when needed, or bind an unscoped
    // existing thread to the resolved agent. The client may provide its own
    // UUID for a new thread; preserving it avoids a second round trip.
    if (!threadExists) {
      const thread = await createThread(user.id, {
        ...(threadId ? { id: threadId } : {}),
        title: titleFromParts([{ type: "text", text: goal }]),
        model: preferredModel,
        agentId,
      });
      threadId = thread.id;
      threadExists = true;
    } else if (scope.threadAction === "bind" && agentId) {
      const effectiveAgentId = await bindThreadToAgent(
        user.id,
        threadId!,
        agentId,
      );
      if (effectiveAgentId !== agentId) {
        return Response.json(
          {
            error: {
              code: "agent_mismatch",
              message: "This conversation belongs to a different agent.",
            },
          },
          { status: 409 },
        );
      }
      agentId = effectiveAgentId;
    }

    const run = await createRun({
      userId: user.id,
      goal,
      threadId,
      agentId,
      model: preferredModel,
      tz: body.tz ?? null,
    });

    // The user's Task Mode turn belongs to the same durable conversation as
    // the final answer. Linking both messages to the run keeps the transcript
    // and task timeline connected.
    await insertMessage(
      user.id,
      threadId!,
      "user",
      [{ type: "text", text: goal }],
      preferredModel,
      { runId: run.id },
    );

    if (body.inline) {
      const result = await executeRun({ runId: run.id, userId: user.id, goal, preferredModel, tz: body.tz });
      return Response.json({
        runId: run.id,
        status: result.status,
        threadId,
        agentId,
      });
    }

    await inngest.send(
      agentRunRequested.create({
        runId: run.id,
        userId: user.id,
        ...(agentId ? { agentId } : {}),
        goal,
        threadId: threadId ?? undefined,
        preferredModel,
        ...(body.tz ? { tz: body.tz } : {}),
      }),
    );

    return Response.json(
      { runId: run.id, status: "queued", threadId, agentId },
      { status: 202 },
    );
  } catch (error) {
    return toErrorResponse(error);
  }
}
