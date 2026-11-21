import { requireUser, toErrorResponse } from "@/lib/auth";
import { TaskListCreateSchema } from "@agent/shared";

import { rowToTaskList, type TaskListRow } from "@/lib/productivity";
import { supabaseAdmin } from "@/lib/supabase/server";
import { zodMessage } from "@/lib/zod-error";

export async function GET(request: Request) {
  try {
    const user = await requireUser(request);
    const { data, error } = await supabaseAdmin()
      .from("task_lists")
      .select("*")
      .eq("user_id", user.id)
      .order("sort", { ascending: true })
      .order("created_at", { ascending: true });
    if (error) throw new Error(`Could not list task lists: ${error.message}`);
    return Response.json({
      taskLists: ((data ?? []) as TaskListRow[]).map(rowToTaskList),
    });
  } catch (error) {
    return toErrorResponse(error);
  }
}

export async function POST(request: Request) {
  try {
    const user = await requireUser(request);
    const parsed = TaskListCreateSchema.safeParse(await request.json().catch(() => null));
    if (!parsed.success) {
      return Response.json(
        { error: { code: "bad_request", message: zodMessage(parsed.error) } },
        { status: 400 },
      );
    }
    const { data, error } = await supabaseAdmin()
      .from("task_lists")
      .insert({
        user_id: user.id,
        name: parsed.data.name,
        sort: parsed.data.sort ?? 0,
      })
      .select("*")
      .single();
    if (error) throw new Error(`Could not create task list: ${error.message}`);
    return Response.json({ taskList: rowToTaskList(data as TaskListRow) }, { status: 201 });
  } catch (error) {
    return toErrorResponse(error);
  }
}
