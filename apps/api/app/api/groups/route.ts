import { GroupCreateSchema } from "@agent/shared";

import { requireUser, toErrorResponse } from "@/lib/auth";
import { createGroup, listGroupRuntimes, toPublicGroup } from "@/lib/groups/store";
import { zodMessage } from "@/lib/zod-error";

/**
 * GET  /api/groups — the caller's dynamic agent groups.
 * POST /api/groups — create a group and its membership.
 */
export async function GET(request: Request) {
  try {
    const user = await requireUser(request);
    const groups = await listGroupRuntimes(user.id);
    return Response.json({ groups: groups.map(toPublicGroup) });
  } catch (error) {
    return toErrorResponse(error);
  }
}

export async function POST(request: Request) {
  try {
    const user = await requireUser(request);
    const parsed = GroupCreateSchema.safeParse(await request.json().catch(() => null));
    if (!parsed.success) {
      return Response.json(
        { error: { code: "bad_request", message: zodMessage(parsed.error) } },
        { status: 400 },
      );
    }

    const input = parsed.data;
    const group = await createGroup({
      userId: user.id,
      name: input.name,
      description: input.description ?? null,
      leadAgentId: input.leadAgentId,
      mode: input.mode,
      maxHops: input.maxHops,
      tokenBudget: input.tokenBudget,
      memberIds: input.memberIds ?? [],
    });
    return Response.json({ group: toPublicGroup(group) }, { status: 201 });
  } catch (error) {
    return toErrorResponse(error);
  }
}
