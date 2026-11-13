import { z } from "zod";

import { requireUser, toErrorResponse } from "@/lib/auth";
import { createThread, listThreads } from "@/lib/chat/persist";

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
});

/** POST /api/threads — create an empty thread. */
export async function POST(request: Request) {
  try {
    const user = await requireUser(request);
    const body = CreateThreadSchema.parse(await request.json().catch(() => ({})));
    const thread = await createThread(user.id, { title: body.title ?? null, model: body.model ?? null });
    return Response.json({ thread }, { status: 201 });
  } catch (error) {
    return toErrorResponse(error);
  }
}
