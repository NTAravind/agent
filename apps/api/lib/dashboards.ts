import { randomUUID } from "node:crypto";

import type {
  Dashboard,
  DashboardCreate,
  DashboardSummary,
  DashboardUpdate,
  DashboardVersion,
  DashboardWidget,
} from "@agent/shared";

import { supabaseAdmin } from "@/lib/supabase/server";

type DashboardRow = {
  id: string;
  user_id: string;
  title: string;
  description: string | null;
  created_by_agent_id: string | null;
  layout: Dashboard["layout"];
  version: number;
  created_at: string;
  updated_at: string;
};
type WidgetRow = {
  id: string;
  dashboard_id: string;
  type: DashboardWidget["type"];
  title: string;
  config: unknown;
  data_source: DashboardWidget["dataSource"] | null;
  position: DashboardWidget["position"];
  size: DashboardWidget["size"];
  created_at: string;
  updated_at: string;
};
type VersionRow = {
  id: string;
  dashboard_id: string;
  version: number;
  snapshot: Dashboard;
  created_at: string;
  created_by_agent_id: string | null;
};

const DASHBOARD_COLUMNS = "id,user_id,title,description,created_by_agent_id,layout,version,created_at,updated_at";
const WIDGET_COLUMNS = "id,dashboard_id,type,title,config,data_source,position,size,created_at,updated_at";
const VERSION_COLUMNS = "id,dashboard_id,version,snapshot,created_at,created_by_agent_id";

function toWidget(row: WidgetRow): DashboardWidget {
  return {
    id: row.id,
    type: row.type,
    title: row.title,
    config: row.config,
    dataSource: row.data_source,
    position: row.position,
    size: row.size,
  };
}

function toSummary(row: DashboardRow): DashboardSummary {
  return {
    id: row.id,
    title: row.title,
    description: row.description,
    createdByAgentId: row.created_by_agent_id,
    layout: row.layout,
    version: row.version,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
}

function toDashboard(row: DashboardRow, widgetRows: WidgetRow[]): Dashboard {
  return {
    ...toSummary(row),
    widgets: widgetRows.map(toWidget).sort((a, b) =>
      a.position.y - b.position.y || a.position.x - b.position.x || (a.id ?? "").localeCompare(b.id ?? ""),
    ),
  };
}

function widgetRows(dashboardId: string, widgets: DashboardWidget[]) {
  return widgets.map((widget) => ({
    ...(widget.id ? { id: widget.id } : {}),
    dashboard_id: dashboardId,
    type: widget.type,
    title: widget.title,
    config: widget.config,
    data_source: widget.dataSource ?? null,
    position: widget.position,
    size: widget.size,
  }));
}

async function readWidgets(dashboardId: string): Promise<WidgetRow[]> {
  const { data, error } = await supabaseAdmin()
    .from("dashboard_widgets")
    .select(WIDGET_COLUMNS)
    .eq("dashboard_id", dashboardId)
    .order("created_at", { ascending: true })
    .limit(24);
  if (error) throw new Error(`Could not load dashboard widgets: ${error.message}`);
  return (data ?? []) as WidgetRow[];
}

export async function listDashboards(userId: string, limit = 20, offset = 0): Promise<DashboardSummary[]> {
  const { data, error } = await supabaseAdmin()
    .from("dashboards")
    .select(DASHBOARD_COLUMNS)
    .eq("user_id", userId)
    .order("updated_at", { ascending: false })
    .order("id", { ascending: false })
    .range(offset, offset + limit - 1);
  if (error) throw new Error(`Could not load dashboards: ${error.message}`);
  return ((data ?? []) as DashboardRow[]).map(toSummary);
}

export async function getDashboard(userId: string, dashboardId: string): Promise<Dashboard | null> {
  const { data, error } = await supabaseAdmin()
    .from("dashboards")
    .select(DASHBOARD_COLUMNS)
    .eq("id", dashboardId)
    .eq("user_id", userId)
    .maybeSingle();
  if (error) throw new Error(`Could not load dashboard: ${error.message}`);
  if (!data) return null;
  const row = data as DashboardRow;
  return toDashboard(row, await readWidgets(dashboardId));
}

function withWidgetIds(widgets: DashboardWidget[]): DashboardWidget[] {
  return widgets.map((widget) => ({ ...widget, id: widget.id ?? randomUUID() }));
}

async function commitRevision(
  userId: string,
  dashboard: Dashboard,
  expectedVersion: number | null,
): Promise<void> {
  const { data, error } = await supabaseAdmin().rpc("create_dashboard_revision", {
    p_user_id: userId,
    p_dashboard_id: dashboard.id,
    p_expected_version: expectedVersion,
    p_title: dashboard.title,
    p_description: dashboard.description,
    p_created_by_agent_id: dashboard.createdByAgentId,
    p_layout: dashboard.layout,
    p_widgets: widgetRows(dashboard.id, dashboard.widgets),
    p_snapshot: dashboard,
  });
  if (error) {
    if (error.code === "P0002") throw new Error("Dashboard changed during the update. Reload it and try again.");
    if (error.code === "P0001" && error.message === "dashboard_creation_rate_limit") {
      throw Object.assign(new Error("dashboard_creation_rate_limit"), { code: "P0001" });
    }
    throw new Error(`Could not save dashboard revision: ${error.message}`);
  }
  if (data !== dashboard.version) throw new Error("Dashboard revision was not saved consistently.");
}

async function assertAgentOwned(userId: string, agentId: string | null | undefined): Promise<void> {
  if (!agentId) return;
  const { data, error } = await supabaseAdmin()
    .from("agents")
    .select("id")
    .eq("id", agentId)
    .eq("user_id", userId)
    .maybeSingle();
  if (error) throw new Error(`Could not verify dashboard agent: ${error.message}`);
  if (!data) throw new Error("Dashboard agent not found.");
}

export async function createDashboard(userId: string, input: DashboardCreate): Promise<Dashboard> {
  await assertAgentOwned(userId, input.createdByAgentId);
  const now = new Date().toISOString();
  const dashboard: Dashboard = {
    id: randomUUID(),
    title: input.title,
    description: input.description ?? null,
    createdByAgentId: input.createdByAgentId ?? null,
    layout: input.layout,
    version: 1,
    createdAt: now,
    updatedAt: now,
    widgets: withWidgetIds(input.widgets),
  };
  await commitRevision(userId, dashboard, null);
  return dashboard;
}

export async function updateDashboard(
  userId: string,
  dashboardId: string,
  input: DashboardUpdate,
): Promise<Dashboard | null> {
  await assertAgentOwned(userId, input.createdByAgentId);
  const existing = await getDashboard(userId, dashboardId);
  if (!existing) return null;
  const nextVersion = existing.version + 1;
  const now = new Date().toISOString();
  const nextBase: DashboardSummary = {
    ...existing,
    ...(input.title !== undefined ? { title: input.title } : {}),
    ...(input.description !== undefined ? { description: input.description } : {}),
    ...(input.createdByAgentId !== undefined ? { createdByAgentId: input.createdByAgentId } : {}),
    ...(input.layout !== undefined ? { layout: input.layout } : {}),
    version: nextVersion,
    updatedAt: now,
  };
  const dashboard: Dashboard = {
    ...nextBase,
    widgets: withWidgetIds(input.widgets ?? existing.widgets),
  };
  await commitRevision(userId, dashboard, existing.version);
  return dashboard;
}

export async function deleteDashboard(userId: string, dashboardId: string): Promise<boolean> {
  const { data, error } = await supabaseAdmin()
    .from("dashboards")
    .delete()
    .eq("id", dashboardId)
    .eq("user_id", userId)
    .select("id");
  if (error) throw new Error(`Could not delete dashboard: ${error.message}`);
  return (data?.length ?? 0) > 0;
}

export async function listDashboardVersions(userId: string, dashboardId: string): Promise<DashboardVersion[] | null> {
  const { data: ownedDashboard, error: ownerError } = await supabaseAdmin()
    .from("dashboards")
    .select("id")
    .eq("id", dashboardId)
    .eq("user_id", userId)
    .maybeSingle();
  if (ownerError) throw new Error(`Could not verify dashboard ownership: ${ownerError.message}`);
  if (!ownedDashboard) return null;
  const { data, error } = await supabaseAdmin()
    .from("dashboard_versions")
    .select(VERSION_COLUMNS)
    .eq("dashboard_id", dashboardId)
    .order("version", { ascending: false })
    .limit(50);
  if (error) throw new Error(`Could not load dashboard versions: ${error.message}`);
  return ((data ?? []) as VersionRow[]).map((row) => ({
    id: row.id,
    dashboardId: row.dashboard_id,
    version: row.version,
    snapshot: row.snapshot,
    createdAt: row.created_at,
    createdByAgentId: row.created_by_agent_id,
  }));
}

export async function restoreDashboardVersion(
  userId: string,
  dashboardId: string,
  version: number,
): Promise<Dashboard | null> {
  const dashboard = await getDashboard(userId, dashboardId);
  if (!dashboard) return null;
  const { data, error } = await supabaseAdmin()
    .from("dashboard_versions")
    .select("snapshot")
    .eq("dashboard_id", dashboardId)
    .eq("version", version)
    .maybeSingle();
  if (error) throw new Error(`Could not load dashboard version: ${error.message}`);
  if (!data) return null;
  const snapshot = (data as { snapshot: Dashboard }).snapshot;
  return updateDashboard(userId, dashboardId, {
    title: snapshot.title,
    description: snapshot.description,
    createdByAgentId: snapshot.createdByAgentId,
    layout: snapshot.layout,
    widgets: snapshot.widgets,
  });
}

