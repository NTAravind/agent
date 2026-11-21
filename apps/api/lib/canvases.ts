import {
  validateCanvasSpec,
  type CanvasRow,
  type CanvasSpec,
  type CanvasSummary,
} from "@agent/shared";

import { buildRRuleSet } from "@/lib/recurrence";
import { searchMemories, searchNotes } from "@/lib/knowledge/search";
import { supabaseAdmin } from "@/lib/supabase/server";
import { webSearch } from "@/lib/tools/web";

/**
 * Canvas storage + refresh (ARCHITECTURE.md 3.7).
 *
 * The spec is zod-validated on every write; data sources re-run on refresh
 * with no LLM call and rewrite the bound components.
 */

const CANVAS_COLUMNS = "id, user_id, title, spec, data_sources, version, created_by_run, created_at, updated_at";

export async function createCanvas(input: {
  userId: string;
  title: string;
  spec: CanvasSpec;
  createdByRun?: string | null;
}): Promise<CanvasRow> {
  const { data, error } = await supabaseAdmin()
    .from("canvases")
    .insert({
      user_id: input.userId,
      title: input.title,
      spec: input.spec,
      data_sources: input.spec.dataSources ?? [],
      created_by_run: input.createdByRun ?? null,
    })
    .select(CANVAS_COLUMNS)
    .single();

  if (error || !data) {
    throw new Error(`Could not save the canvas: ${error?.message ?? "insert failed"}`);
  }

  return data as CanvasRow;
}

export async function getCanvas(userId: string, id: string): Promise<CanvasRow | null> {
  const { data } = await supabaseAdmin()
    .from("canvases")
    .select(CANVAS_COLUMNS)
    .eq("id", id)
    .eq("user_id", userId)
    .maybeSingle();

  return (data as CanvasRow) ?? null;
}

export async function listCanvases(userId: string, limit = 50): Promise<CanvasSummary[]> {
  const { data } = await supabaseAdmin()
    .from("canvases")
    .select("id, title, version, created_at, updated_at")
    .eq("user_id", userId)
    .order("updated_at", { ascending: false })
    .limit(limit);

  return (data ?? []) as CanvasSummary[];
}

/** Replaces the whole spec (PUT semantics) and bumps the version. */
export async function updateCanvasSpec(
  userId: string,
  id: string,
  spec: CanvasSpec,
): Promise<CanvasRow | null> {
  const existing = await getCanvas(userId, id);
  if (!existing) return null;

  const { data, error } = await supabaseAdmin()
    .from("canvases")
    .update({
      spec,
      data_sources: spec.dataSources ?? [],
      title: spec.title ?? existing.title,
      version: existing.version + 1,
      updated_at: new Date().toISOString(),
    })
    .eq("id", id)
    .eq("user_id", userId)
    .select(CANVAS_COLUMNS)
    .single();

  if (error || !data) {
    throw new Error(`Could not update the canvas: ${error?.message ?? "update failed"}`);
  }

  return data as CanvasRow;
}

export async function deleteCanvas(userId: string, id: string): Promise<boolean> {
  const { data } = await supabaseAdmin()
    .from("canvases")
    .delete()
    .eq("id", id)
    .eq("user_id", userId)
    .select("id");

  return (data?.length ?? 0) > 0;
}

// --- Refresh ---------------------------------------------------------------

/**
 * Re-runs every data source with no LLM call and rewrites the components
 * bound to it. web_search results become a markdown digest; note/memory
 * searches become a list. Unbound sources are ignored.
 */
export async function refreshCanvas(userId: string, canvas: CanvasRow): Promise<CanvasRow> {
  const validation = validateCanvasSpec(canvas.spec);
  if (!validation.ok) {
    throw new Error(`Canvas spec is invalid: ${validation.error}`);
  }

  const spec = validation.spec;
  const sources = spec.dataSources ?? [];
  if (sources.length === 0) {
    return canvas; // nothing data-bound — refresh is a no-op
  }

  const results = new Map<string, unknown>();
  for (const source of sources) {
    try {
      if (source.kind === "web_search") {
        const response = await webSearch(source.query, 5);
        results.set(source.id, {
          kind: "web_search",
          answer: response.answer,
          results: response.results.map((result) => ({
            title: result.title,
            url: result.url,
            snippet: result.snippet,
          })),
        });
      } else if (source.kind === "search_notes") {
        const chunks = await searchNotes({ userId, query: source.query, k: 8 });
        results.set(source.id, {
          kind: "search_notes",
          matches: chunks.map((chunk) => ({
            path: chunk.path,
            heading: chunk.heading,
            excerpt: chunk.content.slice(0, 300),
          })),
        });
      } else if (source.kind === "recall_memory") {
        const memories = await searchMemories({ userId, query: source.query, k: 8 });
        results.set(source.id, {
          kind: "recall_memory",
          matches: memories.map((memory) => ({ kind: memory.kind, content: memory.content })),
        });
      } else if (source.kind === "list_tasks") {
        // No LLM: a plain DB read of the user's tasks.
        const query = supabaseAdmin()
          .from("tasks")
          .select("id, title, status, due_at, priority, created_by")
          .eq("user_id", userId)
          .is("deleted_at", null)
          .order("due_at", { ascending: true, nullsFirst: false })
          .limit(50);
        if (source.query.trim() && source.query.trim() !== "all") {
          query.eq("status", source.query.trim());
        }
        const { data: tasks } = await query;
        results.set(source.id, {
          kind: "list_tasks",
          matches: (tasks ?? []).map((task) => ({
            id: task.id as string,
            title: task.title as string,
            status: task.status as string,
            dueAt: task.due_at as string | null,
            createdBy: task.created_by as string,
          })),
        });
      } else {
        // list_events — no LLM: plain DB read, recurring events expanded.
        const now = new Date();
        const rangeEnd = new Date(now.getTime() + 30 * 24 * 60 * 60 * 1000);
        const { data: events } = await supabaseAdmin()
          .from("calendar_events")
          .select("id, title, starts_at, ends_at, all_day, rrule, exdates, created_by")
          .eq("user_id", userId)
          .is("deleted_at", null)
          .lte("starts_at", rangeEnd.toISOString())
          .gte("ends_at", now.toISOString())
          .order("starts_at", { ascending: true })
          .limit(50);
        results.set(source.id, {
          kind: "list_events",
          matches: expandEventOccurrences(events ?? [], now, rangeEnd),
        });
      }
    } catch (error) {
      console.warn(`[canvas] refresh of source ${source.id} failed:`, error instanceof Error ? error.message : error);
    }
  }

  const rewritten = rewriteBoundComponents(structuredClone(spec), results);
  const updated = await supabaseAdmin()
    .from("canvases")
    .update({ spec: rewritten, updated_at: new Date().toISOString() })
    .eq("id", canvas.id)
    .eq("user_id", userId)
    .select(CANVAS_COLUMNS)
    .single();

  if (updated.error || !updated.data) {
    throw new Error(`Could not store the refreshed canvas: ${updated.error?.message ?? "update failed"}`);
  }

  return updated.data as CanvasRow;
}

type SourceResult =
  | { kind: "web_search"; answer: string; results: { title: string; url: string; snippet: string }[] }
  | { kind: "search_notes"; matches: { path: string; heading: string | null; excerpt: string }[] }
  | { kind: "recall_memory"; matches: { kind: string; content: string }[] }
  | { kind: "list_tasks"; matches: { id: string; title: string; status: string; dueAt: string | null; createdBy: string }[] }
  | { kind: "list_events"; matches: { id: string; title: string; startsAt: string; endsAt: string; createdBy: string }[] };

/**
 * Expands recurring calendar events into the occurrences that fall in the
 * window (no LLM involved).
 */
function expandEventOccurrences(
  events: Array<{
    id: string;
    title: string;
    starts_at: string;
    ends_at: string;
    all_day: boolean;
    rrule: string | null;
    exdates: string[] | null;
    created_by: string;
  }>,
  rangeFrom: Date,
  rangeTo: Date,
): Array<{ id: string; title: string; startsAt: string; endsAt: string; createdBy: string }> {
  const out: Array<{ id: string; title: string; startsAt: string; endsAt: string; createdBy: string }> = [];
  for (const event of events) {
    if (!event.rrule) {
      out.push({
        id: event.id,
        title: event.title,
        startsAt: event.starts_at,
        endsAt: event.ends_at,
        createdBy: event.created_by,
      });
      continue;
    }
    try {
      const set = buildRRuleSet(event.rrule, event.exdates ?? [], new Date(event.starts_at));
      if (!set) throw new Error("bad rrule");
      const duration = new Date(event.ends_at).getTime() - new Date(event.starts_at).getTime();
      for (const occ of set.between(rangeFrom, rangeTo, true)) {
        const start = new Date(occ);
        out.push({
          id: event.id,
          title: event.title,
          startsAt: start.toISOString(),
          endsAt: new Date(start.getTime() + duration).toISOString(),
          createdBy: event.created_by,
        });
      }
    } catch {
      out.push({
        id: event.id,
        title: event.title,
        startsAt: event.starts_at,
        endsAt: event.ends_at,
        createdBy: event.created_by,
      });
    }
  }
  return out.slice(0, 50);
}

function rewriteBoundComponents(
  spec: CanvasSpec,
  results: Map<string, unknown>,
): CanvasSpec {
  const walk = (node: CanvasSpec["root"]): CanvasSpec["root"] => {
    const sourceId = (node as { source?: string }).source;
    if (sourceId && results.has(sourceId)) {
      const result = results.get(sourceId) as SourceResult;
      if (node.type === "markdown") {
        return { ...node, text: renderSourceMarkdown(result) };
      }
      if (node.type === "list") {
        return {
          ...node,
          items: renderSourceItems(result).slice(0, 100),
        };
      }
      // stat/chart/table bindings keep their existing data in v1.
    }

    if (node.type === "stack") {
      return { ...node, children: node.children.map((child) => walk(child as CanvasSpec["root"])) };
    }
    if (node.type === "tabs") {
      return { ...node, tabs: node.tabs.map((tab) => ({ ...tab, child: walk(tab.child as CanvasSpec["root"]) })) };
    }
    return node;
  };

  return { ...spec, root: walk(spec.root) };
}

function renderSourceMarkdown(result: SourceResult): string {
  if (result.kind === "web_search") {
    const lines = [
      result.answer,
      "",
      ...result.results.slice(0, 5).map((item) => `- [${item.title}](${item.url}) — ${item.snippet.slice(0, 200)}`),
    ];
    return lines.join("\n");
  }
  if (result.kind === "search_notes") {
    return result.matches
      .slice(0, 8)
      .map((match) => `- **${match.path}**${match.heading ? ` — ${match.heading}` : ""}: ${match.excerpt.slice(0, 200)}`)
      .join("\n") || "No note matches yet.";
  }
  if (result.kind === "list_tasks") {
    return (
      result.matches
        .slice(0, 20)
        .map((task) => {
          const due = task.dueAt ? ` — due ${new Date(task.dueAt).toLocaleDateString("en-IN")}` : "";
          const done = task.status === "done" ? "✓ " : task.status === "cancelled" ? "✗ " : "• ";
          return `${done}${task.title}${due}`;
        })
        .join("\n") || "No tasks yet."
    );
  }
  if (result.kind === "list_events") {
    return (
      result.matches
        .slice(0, 20)
        .map((event) => {
          const when = new Date(event.startsAt).toLocaleString("en-IN", { timeZone: "Asia/Kolkata" });
          return `• **${event.title}** — ${when}`;
        })
        .join("\n") || "No upcoming events."
    );
  }
  return (
    result.matches
      .slice(0, 8)
      .map((match) => `- (${match.kind}) ${match.content}`)
      .join("\n") || "No memories match yet."
  );
}

function renderSourceItems(result: SourceResult): { title: string; subtitle?: string; link?: string }[] {
  if (result.kind === "web_search") {
    return result.results.map((item) => ({ title: item.title, subtitle: item.snippet.slice(0, 200), link: item.url }));
  }
  if (result.kind === "search_notes") {
    return result.matches.map((match) => ({ title: match.path, subtitle: match.heading ?? match.excerpt.slice(0, 150) }));
  }
  if (result.kind === "list_tasks") {
    return result.matches.map((task) => ({
      title: task.title,
      subtitle: task.dueAt
        ? `Due ${new Date(task.dueAt).toLocaleString("en-IN", { timeZone: "Asia/Kolkata" })}`
        : task.status,
    }));
  }
  if (result.kind === "list_events") {
    return result.matches.map((event) => ({
      title: event.title,
      subtitle: new Date(event.startsAt).toLocaleString("en-IN", { timeZone: "Asia/Kolkata" }),
    }));
  }
  return result.matches.map((match) => ({ title: match.content.slice(0, 120), subtitle: match.kind }));
}

export { validateCanvasSpec };
