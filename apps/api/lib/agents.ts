import {
  AgentAvatarSchema,
  DEFAULT_AGENT_AVATAR,
  type Agent,
} from "@agent/shared";

import { findRegistryEntry } from "@/lib/models/registry";
import { loadAgentMcpTools } from "@/lib/mcp/tools-loader";
import { supabaseAdmin } from "@/lib/supabase/server";

/** Columns every agent route reads — `system_prompt` is exposed as `instructions`. */
export const AGENT_COLUMNS =
  "id, user_id, name, role, system_prompt, model, fallback_models, avatar, is_supervisor, created_at";

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
    toolCount,
    createdAt: row.created_at,
  };
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
    agents.push(rowToAgent(row, runtime ? runtime.tools.size : 0));
  }
  return agents;
}

function badRequest(message: string): Error {
  return Object.assign(new Error(message), { status: 400, code: "bad_request" });
}

/**
 * Rejects model ids the registry doesn't know (so the editor can't save an
 * id that `getModel()` would later throw on) and duplicate entries.
 */
export function assertKnownModels(
  model?: string | null,
  fallbackModels?: string[],
): void {
  const fallbacks = fallbackModels ?? [];
  const seen = new Set<string>();
  for (const id of [model, ...fallbacks]) {
    if (!id) continue;
    if (!findRegistryEntry(id)) throw badRequest(`Unknown model "${id}".`);
    if (seen.has(id)) {
      throw badRequest(`Model "${id}" appears more than once.`);
    }
    seen.add(id);
  }
  if (model && fallbacks.includes(model)) {
    throw badRequest("Fallback models must not repeat the primary model.");
  }
}
