import { z } from "zod";

/**
 * Canvas (G4): the agent renders dashboards/reports as a JSON spec, stored in
 * `canvases.spec` and rendered natively by the Expo component catalog
 * (UI_UX_SPEC.md section 4).
 *
 * Rules from the spec:
 *  - Actions are a fixed enum; no eval and no model-supplied code.
 *  - Invalid or unknown nodes render a muted "can't display this block"
 *    card in the client — they never crash the app. The schema is strict so
 *    the API rejects malformed specs at the door.
 *  - Nesting depth ≤ 4, spec size ≤ 100 KB (checked by validateCanvasSpec).
 *  - Optional `source` binds a component to a data source id: refresh re-runs
 *    the query with no LLM call and rewrites the bound block.
 */

export const CANVAS_ACTIONS = ["send_prompt", "refresh", "open_note"] as const;
export type CanvasAction = (typeof CANVAS_ACTIONS)[number];

const statNode = z.object({
  type: z.literal("stat"),
  label: z.string().min(1),
  value: z.string().min(1),
  delta: z.string().optional(),
  source: z.string().optional(),
});

const dataPoint = z.object({
  x: z.union([z.string(), z.number()]),
  y: z.number(),
});

const chartNode = z.object({
  type: z.literal("chart"),
  kind: z.enum(["line", "bar", "pie"]),
  data: z.array(dataPoint).min(1).max(60),
  source: z.string().optional(),
});

const tableNode = z.object({
  type: z.literal("table"),
  columns: z.array(z.string().min(1)).min(1).max(12),
  rows: z.array(z.array(z.union([z.string(), z.number(), z.boolean(), z.null()])).max(12)).max(200),
  source: z.string().optional(),
});

const listItem = z.object({
  title: z.string().min(1),
  subtitle: z.string().optional(),
  link: z.string().optional(),
});

const listNode = z.object({
  type: z.literal("list"),
  items: z.array(listItem).min(1).max(100),
  source: z.string().optional(),
});

const markdownNode = z.object({
  type: z.literal("markdown"),
  text: z.string().min(1).max(20_000),
  source: z.string().optional(),
});

const imageNode = z.object({
  type: z.literal("image"),
  uri: z.string().url(),
  alt: z.string().optional(),
});

const buttonNode = z.object({
  type: z.literal("button"),
  label: z.string().min(1),
  action: z.enum(CANVAS_ACTIONS),
  payload: z.unknown().optional(),
});

const tabsNode = z.object({
  type: z.literal("tabs"),
  tabs: z
    .array(z.object({ label: z.string().min(1), child: z.unknown() }))
    .min(1)
    .max(6),
});

const stackNode = z.object({
  type: z.literal("stack"),
  direction: z.enum(["row", "column"]).default("column"),
  children: z.array(z.unknown()).max(20),
});

// Keep forward compatibility for saved canvases. The native renderer shows a
// muted fallback for component types it does not know yet.
const knownComponentSchema = z.union([
  statNode,
  chartNode,
  tableNode,
  listNode,
  markdownNode,
  imageNode,
  buttonNode,
  tabsNode,
  stackNode,
]);
const knownNodeTypes = new Set([
  "stat", "chart", "table", "list", "markdown", "image", "button", "tabs", "stack",
]);
const unknownNode = z
  .object({ type: z.string().min(1) })
  .passthrough()
  .refine((node) => !knownNodeTypes.has(node.type));

/** Base schema: container children are z.unknown() until the depth walk. */
const componentSchema = z.union([knownComponentSchema, unknownNode]);

export type CanvasComponent = z.infer<typeof knownComponentSchema>;

export const CanvasDataSourceSchema = z.object({
  id: z.string().min(1).max(80),
  kind: z.enum([
    "web_search",
    "search_notes",
    "recall_memory",
    "list_tasks",
    "list_events",
  ]),
  query: z.string().min(2).max(400),
});
export type CanvasDataSource = z.infer<typeof CanvasDataSourceSchema>;

const canvasSpecBase = z.object({
  title: z.string().min(1).max(200).optional(),
  root: componentSchema,
  /** Refreshable queries; bound components carry the matching `source` id. */
  dataSources: z.array(CanvasDataSourceSchema).max(6).optional(),
});

export type CanvasSpec = Omit<z.infer<typeof canvasSpecBase>, "root"> & { root: CanvasComponent };

/** Recursion cap from UI_UX_SPEC.md: nesting depth ≤ 4. */
const MAX_CANVAS_DEPTH = 4;
/** Spec size limit from UI_UX_SPEC.md: 100 KB. */
export const MAX_SPEC_BYTES = 100_000;

function checkDepth(node: unknown, depth: number): string | null {
  if (depth > MAX_CANVAS_DEPTH) return `nesting deeper than ${MAX_CANVAS_DEPTH}`;
  if (typeof node !== "object" || node === null) return null;
  const parsedNode = componentSchema.safeParse(node);
  if (!parsedNode.success) return "contains an invalid component";
  const children =
    (node as { children?: unknown[] }).children ?? (node as { tabs?: { child?: unknown }[] }).tabs?.map((tab) => tab.child);
  if (!Array.isArray(children)) return null;
  for (const child of children) {
    if (!componentSchema.safeParse(child).success) return "contains an invalid child component";
    const problem = checkDepth(child, depth + 1);
    if (problem) return problem;
  }
  return null;
}

export type CanvasSpecValidation =
  | { ok: true; spec: CanvasSpec }
  | { ok: false; error: string };

/** Full spec validation: zod, nesting depth, and the 100 KB size cap. */
export function validateCanvasSpec(input: unknown): CanvasSpecValidation {
  let parsed: ReturnType<typeof canvasSpecBase.safeParse>;
  try {
    parsed = canvasSpecBase.safeParse(input);
  } catch {
    return { ok: false, error: "The canvas spec is not valid JSON." };
  }

  if (!parsed.success) {
    const issue = parsed.error.issues[0];
    return { ok: false, error: `Invalid canvas spec: ${issue ? `${issue.path.join(".") || "spec"} — ${issue.message}` : parsed.error.message}` };
  }

  const depthProblem = checkDepth(parsed.data.root, 1);
  if (depthProblem) return { ok: false, error: `Invalid canvas spec: ${depthProblem}` };

  if (JSON.stringify(parsed.data).length > MAX_SPEC_BYTES) {
    return { ok: false, error: "The canvas spec is larger than 100 KB." };
  }

  return { ok: true, spec: parsed.data as CanvasSpec };
}

/** Supabase row shape for canvases (DATABASE_SCHEMA.md). */
export const CanvasRowSchema = z.object({
  id: z.string().uuid(),
  user_id: z.string().uuid(),
  title: z.string(),
  spec: canvasSpecBase,
  data_sources: z.array(z.unknown()).default([]),
  version: z.number().int(),
  created_by_run: z.string().uuid().nullable(),
  created_at: z.string(),
  updated_at: z.string(),
});

export type CanvasRow = z.infer<typeof CanvasRowSchema>;

export const CanvasSummarySchema = z.object({
  id: z.string().uuid(),
  title: z.string(),
  version: z.number().int(),
  created_at: z.string(),
  updated_at: z.string(),
});

export type CanvasSummary = z.infer<typeof CanvasSummarySchema>;
