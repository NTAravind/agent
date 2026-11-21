import { requireUser, toErrorResponse } from "@/lib/auth";
import { CalendarEventPatchSchema } from "@agent/shared";

import { rowToEvent, eventUpdate, type EventRow } from "@/lib/productivity";
import { supabaseAdmin } from "@/lib/supabase/server";
import { zodMessage } from "@/lib/zod-error";

async function ownedEvent(userId: string, id: string) {
  const { data } = await supabaseAdmin()
    .from("calendar_events")
    .select("*")
    .eq("id", id)
    .eq("user_id", userId)
    .maybeSingle();
  return data as EventRow | null;
}

export async function PATCH(request: Request, ctx: { params: Promise<{ id: string }> }) {
  try {
    const user = await requireUser(request);
    const { id } = await ctx.params;
    const current = await ownedEvent(user.id, id);
    if (!current) {
      return Response.json(
        { error: { code: "not_found", message: "Unknown event." } },
        { status: 404 },
      );
    }
    const parsed = CalendarEventPatchSchema.safeParse(await request.json().catch(() => ({})));
    if (!parsed.success) {
      return Response.json(
        { error: { code: "bad_request", message: zodMessage(parsed.error) } },
        { status: 400 },
      );
    }
    const input = parsed.data;
    const startsAt = input.startsAt ?? current.starts_at;
    const endsAt = input.endsAt ?? current.ends_at;
    if (new Date(startsAt) >= new Date(endsAt)) {
      return Response.json(
        { error: { code: "bad_request", message: "startsAt must be before endsAt." } },
        { status: 400 },
      );
    }

    const { data, error } = await supabaseAdmin()
      .from("calendar_events")
      .update(eventUpdate(input))
      .eq("id", id)
      .eq("user_id", user.id)
      .select("*")
      .single();
    if (error) throw new Error(`Could not update event: ${error.message}`);
    return Response.json({ event: rowToEvent(data as EventRow) });
  } catch (error) {
    return toErrorResponse(error);
  }
}

export async function DELETE(request: Request, ctx: { params: Promise<{ id: string }> }) {
  try {
    const user = await requireUser(request);
    const { id } = await ctx.params;
    const current = await ownedEvent(user.id, id);
    if (!current) {
      return Response.json(
        { error: { code: "not_found", message: "Unknown event." } },
        { status: 404 },
      );
    }
    // Soft delete (Phase 9 rule): rows are never hard-deleted.
    const { error } = await supabaseAdmin()
      .from("calendar_events")
      .update({ deleted_at: new Date().toISOString() })
      .eq("id", id)
      .eq("user_id", user.id);
    if (error) throw new Error(`Could not delete event: ${error.message}`);
    return Response.json({ deleted: true });
  } catch (error) {
    return toErrorResponse(error);
  }
}
