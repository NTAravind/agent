import { requireUser, toErrorResponse } from "@/lib/auth";
import { TaskCreateSchema, EventsRangeQuerySchema } from "@agent/shared";

import { rowToTask, taskInsert, type TaskRow } from "@/lib/productivity";
import { supabaseAdmin } from "@/lib/supabase/server";
import { zodMessage } from "@/lib/zod-error";

export async function GET(request: Request) {
  try {
    const user = await requireUser(request);
    const url = new URL(request.url);
    const query = EventsRangeQuerySchema.parse(Object.fromEntries(url.searchParams));

    let queryBuilder = supabaseAdmin()
      .from("tasks")
      .select("*")
      .eq("user_id", user.id)
      .is("deleted_at", null)
      .order("due_at", { ascending: true, nullsFirst: false })
      .order("priority", { ascending: false })
      .order("created_at", { ascending: false });

    if (query.listId) queryBuilder = queryBuilder.eq("list_id", query.listId);
    if (query.status) queryBuilder = queryBuilder.eq("status", query.status);
    if (query.from) queryBuilder = queryBuilder.gte("due_at", query.from);
    if (query.to) queryBuilder = queryBuilder.lte("due_at", query.to);

    const { data, error } = await queryBuilder.limit(200);
    if (error) throw new Error(`Could not list tasks: ${error.message}`);
    return Response.json({
      tasks: ((data ?? []) as TaskRow[]).map(rowToTask),
    });
  } catch (error) {
    return toErrorResponse(error);
  }
}

export async function POST(request: Request) {
  try {
    const user = await requireUser(request);
    const parsed = TaskCreateSchema.safeParse(await request.json().catch(() => null));
    if (!parsed.success) {
      return Response.json(
        { error: { code: "bad_request", message: zodMessage(parsed.error) } },
        { status: 400 },
      );
    }
    const input = parsed.data;

    // Verify list ownership
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
    if (input.parentId) {
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

    const { data, error } = await supabaseAdmin()
      .from("tasks")
      .insert(
        taskInsert({
          userId: user.id,
          listId: input.listId,
          parentId: input.parentId ?? null,
          title: input.title,
          notes: input.notes ?? null,
          status: input.status ?? "open",
          priority: input.priority ?? 0,
          dueAt: input.dueAt ?? null,
          dueAllDay: input.dueAllDay ?? false,
          remindAt: input.remindAt ?? null,
          rrule: input.rrule ?? null,
          createdBy: input.createdBy ?? "user",
          sourceRunId: input.sourceRunId ?? null,
        }),
      )
      .select("*")
      .single();
    if (error) throw new Error(`Could not create task: ${error.message}`);
    return Response.json({ task: rowToTask(data as TaskRow) }, { status: 201 });
  } catch (error) {
    return toErrorResponse(error);
  }
}
