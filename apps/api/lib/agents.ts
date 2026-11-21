import {
  AgentAvatarSchema,
  DEFAULT_AGENT_AVATAR,
  type Agent,
  type AgentAvatar,
  type AgentSummary,
} from "@agent/shared";

import { primeMobileModel } from "@/lib/models/catalog";
import { findRegistryEntry } from "@/lib/models/registry";
import { loadAgentMcpTools } from "@/lib/mcp/tools-loader";
import { supabaseAdmin } from "@/lib/supabase/server";

/** Columns every agent route reads — `system_prompt` is exposed as `instructions`. */
export const AGENT_COLUMNS =
  "id, user_id, name, role, system_prompt, model, fallback_models, avatar, is_supervisor, sleeping, primary_thread_id, created_at";

export type AgentRow = {
  id: string;
  user_id: string;
  name: string;
  role: string | null;
  system_prompt: string | null;
  model: string | null;
  fallback_models: string[] | null;
  avatar: unknown;
  is_supervisor: boolean | null;
  sleeping: boolean | null;
  primary_thread_id?: string | null;
  created_at: string;
};

/** Maps a DB row to the shared camelCase `Agent` shape. */
export function rowToAgent(row: AgentRow, toolCount = 0): Agent {
  const avatar = AgentAvatarSchema.safeParse(row.avatar);
  return {
    id: row.id,
    name: row.name,
    role: row.role ?? null,
    instructions: row.system_prompt ?? null,
    model: row.model ?? null,
    fallbackModels: row.fallback_models ?? [],
    avatar: avatar.success ? avatar.data : DEFAULT_AGENT_AVATAR,
    isSupervisor: row.is_supervisor ?? false,
    isSleeping: row.sleeping ?? false,
    toolCount,
    primaryThreadId: row.primary_thread_id ?? null,
    createdAt: row.created_at,
  };
}

/** Row → API agent with the image-avatar signed `url` resolved. */
export async function toPublicAgent(row: AgentRow, toolCount = 0): Promise<Agent> {
  const agent = rowToAgent(row, toolCount);
  return { ...agent, avatar: await resolveAvatar(agent.avatar) };
}

/**
 * The caller's agents with each agent's enabled MCP tool count (what the
 * Agents list shows). Personal scale (a handful of agents), so loading the
 * real tool runtime per agent keeps the count exact.
 */
export async function listAgentsWithCounts(userId: string): Promise<Agent[]> {
  const { data, error } = await supabaseAdmin()
    .from("agents")
    .select(AGENT_COLUMNS)
    .eq("user_id", userId)
    .order("created_at", { ascending: true });
  if (error) throw new Error(`Could not list agents: ${error.message}`);

  const agents: Agent[] = [];
  for (const row of (data ?? []) as AgentRow[]) {
    const runtime = await loadAgentMcpTools(userId, row.id).catch(() => null);
    agents.push(await toPublicAgent(row, runtime ? runtime.tools.size : 0));
  }
  return agents;
}

const AVATAR_URL_TTL_SECONDS = 3600;

/**
 * Image avatars store a Storage path; API responses add a signed read `url`
 * alongside it (private bucket). Anything unreadable falls back to the
 * default emoji, per the UI rule "missing avatar → fall back to emoji".
 */
export async function resolveAvatar(avatar: AgentAvatar): Promise<AgentAvatar> {
  if (avatar.type !== "image") return avatar;
  try {
    const { data, error } = await supabaseAdmin()
      .storage.from("avatars")
      .createSignedUrl(avatar.value, AVATAR_URL_TTL_SECONDS);
    if (error || !data?.signedUrl) throw new Error(error?.message ?? "no url");
    return { ...avatar, url: data.signedUrl };
  } catch {
    return DEFAULT_AGENT_AVATAR;
  }
}

/** The persisted form of an avatar: response-only `url` is never stored. */
export function storedAvatar(avatar: AgentAvatar): AgentAvatar {
  return {
    type: avatar.type,
    value: avatar.value,
    ...(avatar.color ? { color: avatar.color } : {}),
  };
}

/**
 * Batch-loads compact agent references (name + resolved avatar) for embedding
 * into threads, runs and approvals. Accepts null/undefined ids (rows without
 * an agent) and skips them.
 */
export async function loadAgentSummaries(
  ids: Array<string | null | undefined>,
): Promise<Map<string, AgentSummary>> {
  const unique = [...new Set(ids.filter((id): id is string => Boolean(id)))];
  const summaries = new Map<string, AgentSummary>();
  if (unique.length === 0) return summaries;

  const { data, error } = await supabaseAdmin()
    .from("agents")
    .select("id, name, avatar")
    .in("id", unique);
  if (error) throw new Error(`Could not load agents: ${error.message}`);

  for (const row of (data ?? []) as { id: string; name: string; avatar: unknown }[]) {
    const parsed = AgentAvatarSchema.safeParse(row.avatar);
    summaries.set(row.id, {
      name: row.name,
      avatar: await resolveAvatar(parsed.success ? parsed.data : DEFAULT_AGENT_AVATAR),
    });
  }
  return summaries;
}

/** Returns the agent id when it exists and belongs to the user, else null. */
export async function ownedAgentId(userId: string, agentId: string): Promise<string | null> {
  const { data } = await supabaseAdmin()
    .from("agents")
    .select("id")
    .eq("id", agentId)
    .eq("user_id", userId)
    .maybeSingle();
  return (data?.id as string | undefined) ?? null;
}

function badRequest(message: string): Error {
  return Object.assign(new Error(message), { status: 400, code: "bad_request" });
}

/**
 * Rejects model ids neither the static registry nor the persisted, mobile-enabled
 * catalog knows (so the editor can't save an id that `getModel()` would later
 * throw on) and duplicate entries.
 *
 * The mobile picker sources `/api/models`, which reads `provider_models` — those
 * rows carry dynamic ids (`openrouter:cohere/north-mini-code-free`, …) that are
 * not in `MODEL_REGISTRY`. `primeMobileModel` accepts those when enabled and
 * registers them in the runtime registry, exactly like the chat/run routes do.
 */
export async function assertKnownModels(
  model?: string | null,
  fallbackModels?: string[],
): Promise<void> {
  const fallbacks = fallbackModels ?? [];
  const seen = new Set<string>();
  for (const id of [model, ...fallbacks]) {
    if (!id) continue;
    if (!findRegistryEntry(id) && !(await primeMobileModel(id))) {
      throw badRequest(`Unknown model "${id}".`);
    }
    if (seen.has(id)) {
      throw badRequest(`Model "${id}" appears more than once.`);
    }
    seen.add(id);
  }
  if (model && fallbacks.includes(model)) {
    throw badRequest("Fallback models must not repeat the primary model.");
  }
}
