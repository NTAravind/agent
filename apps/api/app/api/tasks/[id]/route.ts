import { requireUser, toErrorResponse } from "@/lib/auth";
import { TaskPatchSchema } from "@agent/shared";

import { rowToTask, taskUpdate, type TaskRow } from "@/lib/productivity";
import { supabaseAdmin } from "@/lib/supabase/server";
import { zodMessage } from "@/lib/zod-error";

async function ownedTask(userId: string, id: string) {
  const { data } = await supabaseAdmin()
    .from("tasks")
    .select("*")
    .eq("id", id)
    .eq("user_id", userId)
    .maybeSingle();
  return data as TaskRow | null;
}

export async function PATCH(request: Request, ctx: { params: Promise<{ id: string }> }) {
  try {
    const user = await requireUser(request);
    const { id } = await ctx.params;
    const current = await ownedTask(user.id, id);
    if (!current) {
      return Response.json(
        { error: { code: "not_found", message: "Unknown task." } },
        { status: 404 },
      );
    }
    const parsed = TaskPatchSchema.safeParse(await request.json().catch(() => ({})));
    if (!parsed.success) {
      return Response.json(
        { error: { code: "bad_request", message: zodMessage(parsed.error) } },
        { status: 400 },
      );
    }
    const input = parsed.data;

    if (input.listId) {
      const { data: list } = await supabaseAdmin()
        .from("task_lists")
        .select("id")
        .eq("id", input.listId)
        .eq("user_id", user.id)
        .maybeSingle();
      if (!list) {
        return Response.json(
          { error: { code: "not_found", message: "Task list not found." } },
          { status: 404 },
        );
      }
    }
    if (input.parentId) {
      if (input.parentId === id) {
        return Response.json(
          { error: { code: "bad_request", message: "Cannot set task as its own parent." } },
          { status: 400 },
        );
      }
      const { data: parent } = await supabaseAdmin()
        .from("tasks")
        .select("id")
        .eq("id", input.parentId)
        .eq("user_id", user.id)
        .maybeSingle();
      if (!parent) {
        return Response.json(
          { error: { code: "not_found", message: "Parent task not found." } },
          { status: 404 },
        );
      }
    }

    const patch = taskUpdate(input);
    if (input.status === "done") patch.completed_at = new Date().toISOString();
    if (input.status === "open") patch.completed_at = null;

    const { data, error } = await supabaseAdmin()
      .from("tasks")
      .update(patch)
      .eq("id", id)
      .eq("user_id", user.id)
      .select("*")
      .single();
    if (error) throw new Error(`Could not update task: ${error.message}`);
    return Response.json({ task: rowToTask(data as TaskRow) });
  } catch (error) {
    return toErrorResponse(error);
  }
}

export async function DELETE(request: Request, ctx: { params: Promise<{ id: string }> }) {
  try {
    const user = await requireUser(request);
    const { id } = await ctx.params;
    const current = await ownedTask(user.id, id);
    if (!current) {
      return Response.json(
        { error: { code: "not_found", message: "Unknown task." } },
        { status: 404 },
      );
    }
    // Soft delete (Phase 9 rule): rows are never hard-deleted.
    const { error } = await supabaseAdmin()
      .from("tasks")
      .update({ deleted_at: new Date().toISOString() })
      .eq("id", id)
      .eq("user_id", user.id);
    if (error) throw new Error(`Could not delete task: ${error.message}`);
    return Response.json({ deleted: true });
  } catch (error) {
    return toErrorResponse(error);
  }
}
