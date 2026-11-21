import { requireUser, toErrorResponse } from "@/lib/auth";
import { TaskListPatchSchema } from "@agent/shared";

import { rowToTaskList, type TaskListRow } from "@/lib/productivity";
import { supabaseAdmin } from "@/lib/supabase/server";
import { zodMessage } from "@/lib/zod-error";

async function ownedList(userId: string, id: string) {
  const { data } = await supabaseAdmin()
    .from("task_lists")
    .select("*")
    .eq("id", id)
    .eq("user_id", userId)
    .maybeSingle();
  return data as TaskListRow | null;
}

export async function PATCH(request: Request, ctx: { params: Promise<{ id: string }> }) {
  try {
    const user = await requireUser(request);
    const { id } = await ctx.params;
    const current = await ownedList(user.id, id);
    if (!current) {
      return Response.json(
        { error: { code: "not_found", message: "Unknown task list." } },
        { status: 404 },
      );
    }
    const parsed = TaskListPatchSchema.safeParse(await request.json().catch(() => ({})));
    if (!parsed.success) {
      return Response.json(
        { error: { code: "bad_request", message: zodMessage(parsed.error) } },
        { status: 400 },
      );
    }
    const patch: Record<string, unknown> = {};
    if (parsed.data.name !== undefined) patch.name = parsed.data.name;
    if (parsed.data.sort !== undefined) patch.sort = parsed.data.sort;

    const { data, error } = await supabaseAdmin()
      .from("task_lists")
      .update(patch)
      .eq("id", id)
      .eq("user_id", user.id)
      .select("*")
      .single();
    if (error) throw new Error(`Could not update task list: ${error.message}`);
    return Response.json({ taskList: rowToTaskList(data as TaskListRow) });
  } catch (error) {
    return toErrorResponse(error);
  }
}

export async function DELETE(request: Request, ctx: { params: Promise<{ id: string }> }) {
  try {
    const user = await requireUser(request);
    const { id } = await ctx.params;
    const current = await ownedList(user.id, id);
    if (!current) {
      return Response.json(
        { error: { code: "not_found", message: "Unknown task list." } },
        { status: 404 },
      );
    }
    const { error } = await supabaseAdmin()
      .from("task_lists")
      .delete()
      .eq("id", id)
      .eq("user_id", user.id);
    if (error) throw new Error(`Could not delete task list: ${error.message}`);
    return Response.json({ deleted: true });
  } catch (error) {
    return toErrorResponse(error);
  }
}
