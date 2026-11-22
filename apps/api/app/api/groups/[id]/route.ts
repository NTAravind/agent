import { GroupPatchSchema } from "@agent/shared";
import { z } from "zod";

import { requireUser, toErrorResponse } from "@/lib/auth";
import {
  deleteGroup,
  findActiveGroupParentRun,
  getGroupRuntime,
  listActiveGroupRuns,
  replaceGroupMembers,
  toPublicGroup,
  updateGroup,
} from "@/lib/groups/store";
import { zodMessage } from "@/lib/zod-error";
import { supabaseAdmin } from "@/lib/supabase/server";

/**
 * GET    /api/groups/:id — one owned group.
 * PATCH  /api/groups/:id — update group metadata (and optionally membership).
 * DELETE /api/groups/:id — delete the group; chat history is preserved.
 */
export async function GET(
  request: Request,
  context: { params: Promise<{ id: string }> },
) {
  try {
    const user = await requireUser(request);
    const { id } = await context.params;
    if (!z.string().uuid().safeParse(id).success) {
      return Response.json(
        { error: { code: "bad_request", message: "Invalid group id." } },
        { status: 400 },
      );
    }
    const group = await getGroupRuntime(user.id, id);
    if (!group) {
      return Response.json(
        { error: { code: "not_found", message: "No such group." } },
        { status: 404 },
      );
    }
    const { data: thread } = await supabaseAdmin()
      .from("threads")
      .select("id")
      .eq("group_id", id)
      .eq("user_id", user.id)
      .order("updated_at", { ascending: false })
      .limit(1)
      .maybeSingle();
    // The group's live parent run. The mobile group screen uses it to restore
    // the "running" pill after the app was killed mid-run.
    const activeRun = await findActiveGroupParentRun(user.id, id);
    return Response.json({
      group: {
        ...toPublicGroup(group),
        threadId: (thread as { id?: string } | null)?.id ?? null,
        activeParentRunId: activeRun?.id ?? null,
        activeParentRunStatus: activeRun?.status ?? null,
      },
    });
  } catch (error) {
    return toErrorResponse(error);
  }
}

export async function PATCH(
  request: Request,
  context: { params: Promise<{ id: string }> },
) {
  try {
    const user = await requireUser(request);
    const { id } = await context.params;
    if (!z.string().uuid().safeParse(id).success) {
      return Response.json(
        { error: { code: "bad_request", message: "Invalid group id." } },
        { status: 400 },
      );
    }
    const parsed = GroupPatchSchema.safeParse(await request.json().catch(() => null));
    if (!parsed.success) {
      return Response.json(
        { error: { code: "bad_request", message: zodMessage(parsed.error) } },
        { status: 400 },
      );
    }

    const current = await getGroupRuntime(user.id, id);
    if (!current) {
      return Response.json(
        { error: { code: "not_found", message: "No such group." } },
        { status: 404 },
      );
    }

    const input = parsed.data;
    let group = current;
    if (input.memberIds !== undefined || input.leadAgentId !== undefined) {
      const leadAgentId = input.leadAgentId ?? current.leadAgentId;
      if (!leadAgentId) {
        return Response.json(
          { error: { code: "bad_request", message: "Choose a lead agent." } },
          { status: 400 },
        );
      }
      group =
        (await replaceGroupMembers(user.id, id, {
          leadAgentId,
          memberIds:
            input.memberIds ?? current.members.map((member) => member.id),
        })) ?? current;
    }

    const updated = await updateGroup(user.id, id, {
      ...(input.name !== undefined ? { name: input.name } : {}),
      ...(input.description !== undefined ? { description: input.description } : {}),
      ...(input.mode !== undefined ? { mode: input.mode } : {}),
      ...(input.maxHops !== undefined ? { maxHops: input.maxHops } : {}),
      ...(input.tokenBudget !== undefined ? { tokenBudget: input.tokenBudget } : {}),
    });
    return Response.json({ group: toPublicGroup(updated ?? group) });
  } catch (error) {
    return toErrorResponse(error);
  }
}

export async function DELETE(
  request: Request,
  context: { params: Promise<{ id: string }> },
) {
  try {
    const user = await requireUser(request);
    const { id } = await context.params;
    if (!z.string().uuid().safeParse(id).success) {
      return Response.json(
        { error: { code: "bad_request", message: "Invalid group id." } },
        { status: 400 },
      );
    }
    // A group with a live run cannot be deleted: the run, its children and
    // the conversation it is writing into all point at it.
    const activeRuns = await listActiveGroupRuns(user.id, id);
    if (activeRuns.length > 0) {
      return Response.json(
        {
          error: {
            code: "conflict",
            message:
              "This group still has a run in flight. Cancel it before deleting the group.",
          },
        },
        { status: 409 },
      );
    }
    const deleted = await deleteGroup(user.id, id);
    if (!deleted) {
      return Response.json(
        { error: { code: "not_found", message: "No such group." } },
        { status: 404 },
      );
    }
    return Response.json({ deleted: true });
  } catch (error) {
    return toErrorResponse(error);
  }
}
