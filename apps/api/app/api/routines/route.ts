import { requireUser, toErrorResponse } from "@/lib/auth";
import { RoutineCreateSchema } from "@agent/shared";

import {
  createRoutine,
  listRoutines,
  withPreview,
} from "@/lib/routines/store";
import { normalizeSchedule, RoutineScheduleInputSchema } from "@/lib/routines/tools";
import { DEFAULT_TIMEZONE } from "@/lib/routines/schedule";
import { supabaseAdmin } from "@/lib/supabase/server";
import { zodMessage } from "@/lib/zod-error";

/**
 * GET  /api/routines — the user's routines with their schedule preview.
 * POST /api/routines — create a routine (as a draft; `activate` starts it).
 */
export async function GET(request: Request) {
  try {
    const user = await requireUser(request);
    const routines = await listRoutines(user.id);
    return Response.json({ routines: routines.map((routine) => withPreview(routine)) });
  } catch (error) {
    return toErrorResponse(error);
  }
}

export async function POST(request: Request) {
  try {
    const user = await requireUser(request);
    const parsed = RoutineCreateSchema.safeParse(await request.json().catch(() => null));
    if (!parsed.success) {
      return Response.json(
        { error: { code: "bad_request", message: zodMessage(parsed.error) } },
        { status: 400 },
      );
    }
    const input = parsed.data;
    const tz = input.tz ?? DEFAULT_TIMEZONE;

    // The thread must belong to the user — a routine posts into it.
    let threadId = input.threadId ?? null;
    if (threadId) {
      const { data: thread } = await supabaseAdmin()
        .from("threads")
        .select("id")
        .eq("id", threadId)
        .eq("user_id", user.id)
        .maybeSingle();
      if (!thread) {
        return Response.json(
          { error: { code: "not_found", message: "Unknown thread." } },
          { status: 404 },
        );
      }
    } else {
      // Fall back to the user's most recent thread.
      const { data: threads } = await supabaseAdmin()
        .from("threads")
        .select("id")
        .eq("user_id", user.id)
        .order("updated_at", { ascending: false })
        .limit(1);
      threadId = (threads?.[0] as { id?: string } | undefined)?.id ?? null;
    }
    if (!threadId) {
      return Response.json(
        { error: { code: "bad_request", message: "Start a conversation first — a routine needs a chat to post into." } },
        { status: 400 },
      );
    }

    let agentId = input.agentId ?? null;
    if (agentId) {
      const { data: agent } = await supabaseAdmin()
        .from("agents")
        .select("id")
        .eq("id", agentId)
        .eq("user_id", user.id)
        .maybeSingle();
      if (!agent) {
        return Response.json(
          { error: { code: "not_found", message: "Unknown agent." } },
          { status: 404 },
        );
      }
    } else {
      const { data: thread } = await supabaseAdmin()
        .from("threads")
        .select("agent_id")
        .eq("id", threadId)
        .maybeSingle();
      agentId = (thread as { agent_id?: string | null } | null)?.agent_id ?? null;
    }

    const routine = await createRoutine({
      userId: user.id,
      agentId,
      threadId,
      name: input.name,
      prompt: input.prompt,
      schedule: normalizeSchedule(
        RoutineScheduleInputSchema.parse(input.schedule),
        tz,
      ),
      tz,
      sourceText: input.sourceText ?? null,
      ...(input.approvalMode ? { approvalMode: input.approvalMode } : {}),
    });

    return Response.json({ routine: withPreview(routine) }, { status: 201 });
  } catch (error) {
    return toErrorResponse(error);
  }
}
