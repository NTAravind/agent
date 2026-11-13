import { z } from "zod";

import { requireUser, toErrorResponse } from "@/lib/auth";
import { deleteThread, getThread, listMessages, renameThread } from "@/lib/chat/persist";

type RouteContext = { params: Promise<{ id: string }> };

/** GET /api/threads/:id — thread + messages. */
export async function GET(request: Request, context: RouteContext) {
  try {
    const user = await requireUser(request);
    const { id } = await context.params;

    const thread = await getThread(user.id, id);
    if (!thread) {
      return Response.json({ error: { code: "not_found", message: "Thread not found." } }, { status: 404 });
    }

    const messages = await listMessages(user.id, id);
    return Response.json({ thread, messages });
  } catch (error) {
    return toErrorResponse(error);
  }
}

const RenameSchema = z.object({ title: z.string().min(1).max(200) });

/** PATCH /api/threads/:id — rename. */
export async function PATCH(request: Request, context: RouteContext) {
  try {
    const user = await requireUser(request);
    const { id } = await context.params;

    const body = RenameSchema.parse(await request.json().catch(() => null));
    const thread = await getThread(user.id, id);
    if (!thread) {
      return Response.json({ error: { code: "not_found", message: "Thread not found." } }, { status: 404 });
    }

    await renameThread(user.id, id, body.title);
    return Response.json({ ok: true });
  } catch (error) {
    return toErrorResponse(error);
  }
}

/** DELETE /api/threads/:id — delete the thread and its messages. */
export async function DELETE(request: Request, context: RouteContext) {
  try {
    const user = await requireUser(request);
    const { id } = await context.params;

    const thread = await getThread(user.id, id);
    if (!thread) {
      return Response.json({ error: { code: "not_found", message: "Thread not found." } }, { status: 404 });
    }

    await deleteThread(user.id, id);
    return Response.json({ ok: true });
  } catch (error) {
    return toErrorResponse(error);
  }
}
