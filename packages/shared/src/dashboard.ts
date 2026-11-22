import { z } from "zod";

import {
  CanvasDataSourceSchema,
  validateCanvasSpec,
} from "./canvas";

export const MAX_DASHBOARD_WIDGETS = 24;
export const MAX_DASHBOARD_BYTES = 500_000;

export const DashboardLayoutSchema = z.object({
  columns: z.number().int().min(1).max(12).default(12),
  rowHeight: z.number().int().min(48).max(400).default(96),
  gap: z.number().int().min(0).max(48).default(12),
});
export type DashboardLayout = z.infer<typeof DashboardLayoutSchema>;

export const DashboardWidgetTypeSchema = z.enum([
  "stat",
  "chart",
  "table",
  "list",
  "markdown",
  "image",
]);

export const DashboardWidgetSchema = z.object({
  id: z.string().uuid().optional(),
  type: DashboardWidgetTypeSchema,
  title: z.string().min(1).max(200),
  /** A Canvas component object; validated against the shared Canvas schema below. */
  config: z.unknown(),
  dataSource: CanvasDataSourceSchema.nullable().optional(),
  position: z.object({
    x: z.number().int().min(0).max(11).default(0),
    y: z.number().int().min(0).max(1000).default(0),
  }).default({ x: 0, y: 0 }),
  size: z.object({
    width: z.number().int().min(1).max(12).default(3),
    height: z.number().int().min(1).max(20).default(2),
  }).default({ width: 3, height: 2 }),
}).superRefine((widget, ctx) => {
  const validated = validateCanvasSpec({ root: widget.config });
  if (!validated.ok) {
    ctx.addIssue({ code: "custom", path: ["config"], message: validated.error });
    return;
  }
  const configType = (validated.spec.root as { type?: unknown }).type;
  if (configType !== widget.type) {
    ctx.addIssue({
      code: "custom",
      path: ["config", "type"],
      message: `Widget type ${widget.type} must use a matching Canvas config.`,
    });
  }
  if (widget.type === "image") {
    const uri = (validated.spec.root as { uri?: unknown }).uri;
    try {
      const parsedUri = typeof uri === "string" ? new URL(uri) : null;
      if (!parsedUri || parsedUri.protocol !== "https:" || parsedUri.username || parsedUri.password) {
        ctx.addIssue({
          code: "custom",
          path: ["config", "uri"],
          message: "Dashboard image URLs must use HTTPS and cannot include credentials.",
        });
      }
    } catch {
      ctx.addIssue({ code: "custom", path: ["config", "uri"], message: "Invalid dashboard image URL." });
    }
  }
  if (widget.position.x + widget.size.width > 12) {
    ctx.addIssue({
      code: "custom",
      path: ["size", "width"],
      message: "Widget must fit within the 12-column dashboard grid.",
    });
  }
});
export type DashboardWidget = z.infer<typeof DashboardWidgetSchema>;

export const DashboardWidgetsSchema = z.array(DashboardWidgetSchema)
  .max(MAX_DASHBOARD_WIDGETS)
  .superRefine((widgets, ctx) => {
    const ids = new Set<string>();
    for (const [index, widget] of widgets.entries()) {
      if (!widget.id) continue;
      if (ids.has(widget.id)) {
        ctx.addIssue({ code: "custom", path: [index, "id"], message: "Widget IDs must be unique within a dashboard." });
      }
      ids.add(widget.id);
    }
  });

const dashboardContentSchema = z.object({
  title: z.string().min(1).max(200),
  description: z.string().max(2000).nullable().optional(),
  createdByAgentId: z.string().uuid().nullable().optional(),
  layout: DashboardLayoutSchema.default({ columns: 12, rowHeight: 96, gap: 12 }),
  widgets: DashboardWidgetsSchema.default([]),
});

function checkGridBounds(
  value: { layout?: DashboardLayout; widgets?: DashboardWidget[] },
  ctx: z.RefinementCtx,
) {
  if (!value.layout || !value.widgets) return;
  value.widgets.forEach((widget, index) => {
    if (widget.position.x + widget.size.width > value.layout!.columns) {
      ctx.addIssue({
        code: "custom",
        path: ["widgets", index, "size", "width"],
        message: "Widget must fit within the dashboard's configured column count.",
      });
    }
  });
}

function checkDashboardBytes(value: unknown, ctx: z.RefinementCtx) {
  if (JSON.stringify(value).length > MAX_DASHBOARD_BYTES) {
    ctx.addIssue({ code: "custom", message: "The dashboard payload exceeds 500 KB." });
  }
}

export const DashboardCreateSchema = dashboardContentSchema
  .superRefine(checkGridBounds)
  .superRefine(checkDashboardBytes);
export type DashboardCreate = z.infer<typeof DashboardCreateSchema>;

export const DashboardUpdateSchema = z.object({
  title: dashboardContentSchema.shape.title.optional(),
  description: dashboardContentSchema.shape.description,
  createdByAgentId: dashboardContentSchema.shape.createdByAgentId,
  layout: DashboardLayoutSchema.optional(),
  widgets: DashboardWidgetsSchema.optional(),
})
  .refine((value) => Object.keys(value).length > 0, "Provide at least one dashboard field to update.")
  .superRefine(checkGridBounds)
  .superRefine(checkDashboardBytes);
export type DashboardUpdate = z.infer<typeof DashboardUpdateSchema>;

export const DashboardIdSchema = z.string().uuid();
export const DashboardVersionRestoreSchema = z.object({
  version: z.number().int().min(1),
});

export const DashboardSummarySchema = z.object({
  id: z.string().uuid(),
  title: z.string(),
  description: z.string().nullable(),
  createdByAgentId: z.string().uuid().nullable(),
  layout: DashboardLayoutSchema,
  version: z.number().int().min(1),
  createdAt: z.string(),
  updatedAt: z.string(),
});
export type DashboardSummary = z.infer<typeof DashboardSummarySchema>;

export const DashboardSchema = DashboardSummarySchema.extend({
  widgets: DashboardWidgetsSchema,
});
export type Dashboard = z.infer<typeof DashboardSchema>;

export const DashboardVersionSchema = z.object({
  id: z.string().uuid(),
  dashboardId: z.string().uuid(),
  version: z.number().int().min(1),
  snapshot: DashboardSchema,
  createdAt: z.string(),
  createdByAgentId: z.string().uuid().nullable(),
});
export type DashboardVersion = z.infer<typeof DashboardVersionSchema>;
