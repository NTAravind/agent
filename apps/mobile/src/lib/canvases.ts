import type { CanvasRow, CanvasSpec, CanvasSummary } from "@agent/shared";

import { apiFetch } from "@/lib/api";
import { supabase } from "@/lib/supabase";

async function accessToken(): Promise<string | null> {
  const { data, error } = await supabase.auth.getSession();
  if (error || !data.session) return null;
  return data.session.access_token;
}

export async function fetchCanvases(): Promise<CanvasSummary[]> {
  const token = await accessToken();
  if (!token) return [];
  const response = await apiFetch<{ canvases: CanvasSummary[] }>("/api/canvases", { token });
  return response.canvases;
}

export async function fetchCanvas(id: string): Promise<CanvasRow> {
  const token = await accessToken();
  if (!token) throw new Error("Not signed in.");
  const response = await apiFetch<{ canvas: CanvasRow }>(`/api/canvases/${id}`, { token });
  return response.canvas;
}

/** Re-runs data sources (no LLM) and returns the updated canvas. */
export async function refreshCanvas(id: string): Promise<CanvasRow> {
  const token = await accessToken();
  if (!token) throw new Error("Not signed in.");
  const response = await apiFetch<{ canvas: CanvasRow }>(`/api/canvases/${id}/refresh`, {
    token,
    init: { method: "POST" },
  });
  return response.canvas;
}

export async function updateCanvasSpec(id: string, spec: CanvasSpec): Promise<CanvasRow> {
  const token = await accessToken();
  if (!token) throw new Error("Not signed in.");
  const response = await apiFetch<{ canvas: CanvasRow }>(`/api/canvases/${id}`, {
    token,
    init: { method: "PUT", body: JSON.stringify({ spec }) },
  });
  return response.canvas;
}

export async function deleteCanvas(id: string): Promise<void> {
  const token = await accessToken();
  if (!token) throw new Error("Not signed in.");
  await apiFetch<{ ok: boolean }>(`/api/canvases/${id}`, {
    token,
    init: { method: "DELETE" },
  });
}
