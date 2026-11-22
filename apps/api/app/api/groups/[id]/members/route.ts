import { GroupMembersSchema } from "@agent/shared";
import { z } from "zod";

import { requireUser, toErrorResponse } from "@/lib/auth";
import { replaceGroupMembers, toPublicGroup } from "@/lib/groups/store";
import { zodMessage } from "@/lib/zod-error";

/**
 * PUT /api/groups/:id/members — replace the group's whole membership set.
 * The lead is always included and is represented by exactly one lead row.
 */
export async function PUT(
  request: Request,
  context: { params: Promise<{ id: string }> },
) {
  try {
    const user = await requireUser(request);
    const { id } = await context.params;
    if (!z.string().uuid().safeParse(id).success) {
      return Response.json(
        { error: { code: "bad_request", message: "Invalid group id." } },
        { status: 400 },
      );
    }
    const parsed = GroupMembersSchema.safeParse(await request.json().catch(() => null));
    if (!parsed.success) {
      return Response.json(
        { error: { code: "bad_request", message: zodMessage(parsed.error) } },
        { status: 400 },
      );
    }

    const group = await replaceGroupMembers(user.id, id, parsed.data);
    if (!group) {
      return Response.json(
        { error: { code: "not_found", message: "No such group." } },
        { status: 404 },
      );
    }
    return Response.json({ group: toPublicGroup(group) });
  } catch (error) {
    return toErrorResponse(error);
  }
}
