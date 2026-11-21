import type { CanvasRow, CanvasSpec, CanvasSummary } from "@agent/shared";

import { authedFetch } from "@/lib/api-session";

export async function fetchCanvases(): Promise<CanvasSummary[]> {
  const response = await authedFetch<{ canvases: CanvasSummary[] }>("/api/canvases");
  return response.canvases;
}

export async function fetchCanvas(id: string): Promise<CanvasRow> {
  const response = await authedFetch<{ canvas: CanvasRow }>(`/api/canvases/${id}`);
  return response.canvas;
}

/** Re-runs data sources (no LLM) and returns the updated canvas. */
export async function refreshCanvas(id: string): Promise<CanvasRow> {
  const response = await authedFetch<{ canvas: CanvasRow }>(`/api/canvases/${id}/refresh`, {
    method: "POST",
  });
  return response.canvas;
}

export async function updateCanvasSpec(id: string, spec: CanvasSpec): Promise<CanvasRow> {
  const response = await authedFetch<{ canvas: CanvasRow }>(`/api/canvases/${id}`, {
    method: "PUT",
    body: JSON.stringify({ spec }),
  });
  return response.canvas;
}

export async function deleteCanvas(id: string): Promise<void> {
  await authedFetch<{ ok: boolean }>(`/api/canvases/${id}`, {
    method: "DELETE",
  });
}
