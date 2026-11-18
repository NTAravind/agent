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

import { apiFetch } from "@/lib/api";
import { supabase } from "@/lib/supabase";

async function accessToken(): Promise<string | null> {
  const { data, error } = await supabase.auth.getSession();
  if (error || !data.session) return null;
  return data.session.access_token;
}

/** Starts an agent run (executed durably by Inngest). */
export async function startRun(
  goal: string,
  model?: string | null,
  agentId?: string | null,
): Promise<StartRunResponse> {
  const token = await accessToken();
  if (!token) throw new Error('Not signed in.');
  return await apiFetch<StartRunResponse>("/api/agents/run", {
    token,
    init: {
      method: "POST",
      body: JSON.stringify({
        goal,
        ...(model ? { model } : {}),
        ...(agentId ? { agentId } : {}),
      }),
    },
  });
}

// --- Agent CRUD ------------------------------------------------------------

export type { Agent, AgentCreate, AgentPatch };

export async function fetchAgents(): Promise<Agent[]> {
  const token = await accessToken();
  if (!token) return [];
  const response = await apiFetch<{ agents: Agent[] }>("/api/agents", { token });
  return response.agents;
}

export async function createAgent(input: AgentCreate): Promise<Agent> {
  const token = await accessToken();
  if (!token) throw new Error('Not signed in.');
  const response = await apiFetch<{ agent: Agent }>("/api/agents", {
    token,
    init: { method: "POST", body: JSON.stringify(input) },
  });
  return response.agent;
}

export async function updateAgent(id: string, patch: AgentPatch): Promise<Agent> {
  const token = await accessToken();
  if (!token) throw new Error('Not signed in.');
  const response = await apiFetch<{ agent: Agent }>(`/api/agents/${id}`, {
    token,
    init: { method: "PATCH", body: JSON.stringify(patch) },
  });
  return response.agent;
}

/** Removes the agent; MCP attachments cascade, run history is kept. */
export async function deleteAgent(id: string): Promise<void> {
  const token = await accessToken();
  if (!token) throw new Error('Not signed in.');
  await apiFetch<{ deleted: boolean }>(`/api/agents/${id}`, {
    token,
    init: { method: "DELETE" },
  });
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

  const token = await accessToken();
  if (!token) throw new Error('Not signed in.');

  const signed = await apiFetch<{ storagePath: string; token: string }>(
    `/api/agents/${agentId}/avatar`,
    {
      token,
      init: {
        method: "POST",
        body: JSON.stringify({
          mediaType,
          ...(asset.fileSize ? { sizeBytes: asset.fileSize } : {}),
        }),
      },
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
};

export async function fetchRuns(): Promise<RunListItem[]> {
  const token = await accessToken();
  if (!token) return [];
  const response = await apiFetch<{ runs: RunListItem[] }>("/api/runs", { token });
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
  const token = await accessToken();
  if (!token) throw new Error('Not signed in.');
  return await apiFetch<RunDetail>(`/api/runs/${id}`, { token });
}

/** Records an approve/deny decision; the run resumes via Inngest. */
export async function decideApproval(
  id: string,
  decision: 'approve' | 'deny',
): Promise<void> {
  const token = await accessToken();
  if (!token) throw new Error('Not signed in.');
  await apiFetch<{ ok: boolean }>(`/api/approvals/${id}`, {
    token,
    init: { method: 'POST', body: JSON.stringify({ decision }) },
  });
}
