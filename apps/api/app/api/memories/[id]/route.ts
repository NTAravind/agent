import { requireUser, toErrorResponse } from "@/lib/auth";
import { deleteMemory } from "@/lib/knowledge/search";

/** DELETE /api/memories/:id — forget a memory. */
export async function DELETE(request: Request, context: { params: Promise<{ id: string }> }) {
  try {
    const user = await requireUser(request);
    const { id } = await context.params;

    await deleteMemory(user.id, id);
    return Response.json({ ok: true });
  } catch (error) {
    return toErrorResponse(error);
  }
}
