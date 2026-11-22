import { z } from "zod";

import { requireUser, toErrorResponse } from "@/lib/auth";
import { createThread, listThreads } from "@/lib/chat/persist";
import { supabaseAdmin } from "@/lib/supabase/server";
import { zodMessage } from "@/lib/zod-error";

/** GET /api/threads — list the user's threads, newest first. */
export async function GET(request: Request) {
  try {
    const user = await requireUser(request);
    const threads = await listThreads(user.id);
    return Response.json({ threads });
  } catch (error) {
    return toErrorResponse(error);
  }
}

const CreateThreadSchema = z.object({
  title: z.string().max(200).optional(),
  model: z.string().optional(),
  /** Group chat; the group must belong to the caller. */
  groupId: z.string().uuid().optional(),
});

/** POST /api/threads — create an empty thread. */
export async function POST(request: Request) {
  try {
    const user = await requireUser(request);
    const parsed = CreateThreadSchema.safeParse(await request.json().catch(() => ({})));
    if (!parsed.success) {
      return Response.json(
        { error: { code: "bad_request", message: zodMessage(parsed.error) } },
        { status: 400 },
      );
    }
    const body = parsed.data;

    if (body.groupId) {
      const { data: group } = await supabaseAdmin()
        .from("agent_groups")
        .select("id")
        .eq("id", body.groupId)
        .eq("user_id", user.id)
        .maybeSingle();
      if (!group) {
        return Response.json(
          { error: { code: "not_found", message: "No such group." } },
          { status: 404 },
        );
      }
    }

    const thread = await createThread(user.id, {
      title: body.title ?? null,
      model: body.model ?? null,
      groupId: body.groupId ?? null,
    });
    return Response.json({ thread }, { status: 201 });
  } catch (error) {
    return toErrorResponse(error);
  }
}
