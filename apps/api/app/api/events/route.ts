import { requireUser, toErrorResponse } from "@/lib/auth";
import { CalendarEventCreateSchema, EventsRangeQuerySchema } from "@agent/shared";

import { rowToEvent, eventInsert, type EventRow } from "@/lib/productivity";
import { buildRRuleSet } from "@/lib/recurrence";
import { supabaseAdmin } from "@/lib/supabase/server";
import { zodMessage } from "@/lib/zod-error";

export async function GET(request: Request) {
  try {
    const user = await requireUser(request);
    const url = new URL(request.url);
    const query = EventsRangeQuerySchema.parse(Object.fromEntries(url.searchParams));

    const from = query.from ? new Date(query.from) : new Date(Date.now() - 30 * 24 * 60 * 60 * 1000);
    const to = query.to ? new Date(query.to) : new Date(Date.now() + 90 * 24 * 60 * 60 * 1000);

    const { data, error } = await supabaseAdmin()
      .from("calendar_events")
      .select("*")
      .eq("user_id", user.id)
      .is("deleted_at", null)
      .lte("starts_at", to.toISOString())
      .gte("ends_at", from.toISOString())
      .order("starts_at", { ascending: true })
      .limit(200);
    if (error) throw new Error(`Could not list events: ${error.message}`);

    const expanded = expandEvents((data ?? []) as EventRow[], from, to);
    return Response.json({ events: expanded.map(rowToEvent) });
  } catch (error) {
    return toErrorResponse(error);
  }
}

export async function POST(request: Request) {
  try {
    const user = await requireUser(request);
    const parsed = CalendarEventCreateSchema.safeParse(await request.json().catch(() => null));
    if (!parsed.success) {
      return Response.json(
        { error: { code: "bad_request", message: zodMessage(parsed.error) } },
        { status: 400 },
      );
    }
    const input = parsed.data;
    const { data, error } = await supabaseAdmin()
      .from("calendar_events")
      .insert(
        eventInsert({
          userId: user.id,
          title: input.title,
          description: input.description ?? null,
          startsAt: input.startsAt,
          endsAt: input.endsAt,
          allDay: input.allDay ?? false,
          tz: input.tz ?? "Asia/Kolkata",
          location: input.location ?? null,
          rrule: input.rrule ?? null,
          exdates: input.exdates ?? [],
          reminders: input.reminders ?? [],
          createdBy: input.createdBy ?? "user",
          sourceRunId: input.sourceRunId ?? null,
          icalUid: input.icalUid ?? null,
        }),
      )
      .select("*")
      .single();
    if (error) throw new Error(`Could not create event: ${error.message}`);
    return Response.json({ event: rowToEvent(data as EventRow) }, { status: 201 });
  } catch (error) {
    return toErrorResponse(error);
  }
}

/**
 * Expands recurring events within a date range using RRULE.
 * Non-recurring events are returned as-is. EXDATEs are respected.
 */
function expandEvents(events: EventRow[], rangeFrom: Date, rangeTo: Date): EventRow[] {
  const result: EventRow[] = [];

  for (const event of events) {
    if (!event.rrule) {
      const starts = new Date(event.starts_at);
      const ends = new Date(event.ends_at);
      if (starts < rangeTo && ends > rangeFrom) result.push(event);
      continue;
    }

    const ruleSet = buildRRuleSet(event.rrule, event.exdates, new Date(event.starts_at));
    if (!ruleSet) {
      const starts = new Date(event.starts_at);
      const ends = new Date(event.ends_at);
      if (starts < rangeTo && ends > rangeFrom) result.push(event);
      continue;
    }

    try {
      const occurrences = ruleSet.between(rangeFrom, rangeTo, true);
      const duration = new Date(event.ends_at).getTime() - new Date(event.starts_at).getTime();
      for (const occ of occurrences) {
        const occStart = new Date(occ);
        result.push({
          ...event,
          starts_at: occStart.toISOString(),
          ends_at: new Date(occStart.getTime() + duration).toISOString(),
        });
      }
    } catch {
      const starts = new Date(event.starts_at);
      const ends = new Date(event.ends_at);
      if (starts < rangeTo && ends > rangeFrom) result.push(event);
    }
  }

  return result.sort(
    (a, b) => new Date(a.starts_at).getTime() - new Date(b.starts_at).getTime(),
  );
}
