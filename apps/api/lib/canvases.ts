import {
  validateCanvasSpec,
  type CanvasRow,
  type CanvasSpec,
  type CanvasSummary,
} from "@agent/shared";

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
      } else {
        const memories = await searchMemories({ userId, query: source.query, k: 8 });
        results.set(source.id, {
          kind: "recall_memory",
          matches: memories.map((memory) => ({ kind: memory.kind, content: memory.content })),
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
  | { kind: "recall_memory"; matches: { kind: string; content: string }[] };

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
  return result.matches.map((match) => ({ title: match.content.slice(0, 120), subtitle: match.kind }));
}

export { validateCanvasSpec };
