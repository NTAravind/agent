import type {
  Agent,
  AgentCreate,
  AgentPatch,
  AgentRun,
  AgentSummary,
  Approval,
  RunEvent,
  StartRunResponse,
} from "@agent/shared";
import * as ImagePicker from "expo-image-picker";

import { authedFetch } from "@/lib/api-session";
import { supabase } from "@/lib/supabase";

/** Starts an agent run (executed durably by Inngest). */
export async function startRun(
  goal: string,
  model?: string | null,
  agentId?: string | null,
): Promise<StartRunResponse> {
  return await authedFetch<StartRunResponse>("/api/agents/run", {
    method: "POST",
    body: JSON.stringify({
      goal,
      ...(model ? { model } : {}),
      ...(agentId ? { agentId } : {}),
    }),
  });
}

// --- Agent CRUD ------------------------------------------------------------

export type { Agent, AgentCreate, AgentPatch };

export async function fetchAgents(): Promise<Agent[]> {
  const response = await authedFetch<{ agents: Agent[] }>("/api/agents");
  return response.agents;
}

export async function createAgent(input: AgentCreate): Promise<Agent> {
  const response = await authedFetch<{ agent: Agent }>("/api/agents", { method: "POST", body: JSON.stringify(input) });
  return response.agent;
}

export async function updateAgent(id: string, patch: AgentPatch): Promise<Agent> {
  const response = await authedFetch<{ agent: Agent }>(`/api/agents/${id}`, { method: "PATCH", body: JSON.stringify(patch) });
  return response.agent;
}

/** Removes the agent; MCP attachments cascade, run history is kept. */
export async function deleteAgent(id: string): Promise<void> {
  await authedFetch<{ deleted: boolean }>(`/api/agents/${id}`, { method: "DELETE" });
}

/**
 * Opens the photo library and uploads the chosen image straight to the
 * private avatars bucket via a signed URL. Returns the Storage path to store
 * on the agent, or null when the picker was canceled.
 */
export async function uploadAgentAvatar(agentId: string): Promise<string | null> {
  const permission = await ImagePicker.requestMediaLibraryPermissionsAsync();
  if (!permission.granted) {
    throw new Error('Photo library access is required to change the avatar.');
  }

  const result = await ImagePicker.launchImageLibraryAsync({
    mediaTypes: ["images"],
    quality: 0.9,
    allowsMultipleSelection: false,
  });
  if (result.canceled || !result.assets[0]) return null;
  const asset = result.assets[0];
  const mediaType = asset.mimeType ?? "image/jpeg";


  const signed = await authedFetch<{ storagePath: string; token: string }>(
    `/api/agents/${agentId}/avatar`,
    {
      method: "POST",
      body: JSON.stringify({
        mediaType,
        ...(asset.fileSize ? { sizeBytes: asset.fileSize } : {}),
      }),
    },
  );

  const form = new FormData();
  form.append("file", {
    uri: asset.uri,
    name: asset.fileName ?? "avatar.jpg",
    type: mediaType,
  } as unknown as Blob);

  const { error } = await supabase.storage
    .from("avatars")
    .uploadToSignedUrl(signed.storagePath, signed.token, form, {
      contentType: mediaType,
      upsert: false,
    });
  if (error) throw new Error(`Upload failed: ${error.message}`);

  return signed.storagePath;
}

export type RunListItem = {
  id: string;
  goal: string;
  status: string;
  model: string | null;
  tokens_used: number;
  created_at: string;
  finished_at: string | null;
  /**
   * The agent that owns the run. `GET /api/runs` already joins this — it was
   * previously undeclared on the mobile side, which forced a goal-substring
   * heuristic to match runs to agents. Null for runs started without an agent.
   */
  agent_id?: string | null;
  /** Embedded agent summary (name + resolved avatar) from the same join. */
  agent?: AgentSummary | null;
};

export async function fetchRuns(): Promise<RunListItem[]> {
  const response = await authedFetch<{ runs: RunListItem[] }>("/api/runs");
  return response.runs;
}

/** A supervisor's specialist child run (nests under the parent timeline). */
export type RunChild = {
  id: string;
  goal: string;
  status: string;
  model: string | null;
  tokens_used: number;
  created_at: string;
  finished_at: string | null;
  /** The specialist that ran it (name + resolved avatar). */
  agent?: AgentSummary | null;
};

export type RunDetail = {
  run: AgentRun;
  events: RunEvent[];
  /** The run's agent (name + resolved avatar), when it has one. */
  agent?: AgentSummary | null;
  /** Supervisor children, oldest first (nesting order). */
  children?: RunChild[];
  pendingApprovals?: Approval[];
};

export async function fetchRun(id: string): Promise<RunDetail> {
  return await authedFetch<RunDetail>(`/api/runs/${id}`);
}

/** Records an approve/deny decision; the run resumes via Inngest. */
export async function decideApproval(
  id: string,
  decision: 'approve' | 'deny',
): Promise<void> {
  await authedFetch<{ ok: boolean }>(`/api/approvals/${id}`, {
    method: 'POST',
    body: JSON.stringify({ decision }),
  });
}

/**
 * Pauses a run: the API flips the status row and the graph stops at its next
 * step boundary. Supervisor children pause with their parent.
 */
export async function pauseRun(id: string): Promise<void> {
  await authedFetch<{ status: string }>(`/api/runs/${id}/pause`, { method: 'POST' });
}

/**
 * Resumes a paused run from its checkpoint (queued via Inngest `run/resumed`).
 * 409 when the run is not paused or its agent is asleep.
 */
export async function resumeRun(id: string): Promise<void> {
  await authedFetch<{ ok: boolean }>(`/api/runs/${id}/resume`, { method: 'POST' });
}

/** Cancels an unfinished run (and a supervisor's unfinished children). */
export async function cancelRun(id: string): Promise<void> {
  await authedFetch<{ status: string }>(`/api/runs/${id}/cancel`, { method: 'POST' });
}

/**
 * Sleeps an agent: pauses all of its active tasks and blocks new ones until
 * it wakes. Returns how many runs were paused.
 */
export async function sleepAgent(id: string): Promise<{ pausedRuns: number }> {
  return await authedFetch<{ sleeping: true; pausedRuns: number }>(`/api/agents/${id}/sleep`, { method: 'POST' });
}

/**
 * Wakes a sleeping agent: clears the flag and resumes all of its paused
 * tasks (plus supervisors waiting on them). Returns how many were resumed.
 */
export async function wakeAgent(id: string): Promise<{ resumedRuns: number }> {
  return await authedFetch<{ sleeping: false; resumedRuns: number }>(`/api/agents/${id}/wake`, { method: 'POST' });
}
