import type { Thread, StoredMessage } from "@agent/shared";

import { loadAgentSummaries } from "@/lib/agents";
import { supabaseAdmin } from "@/lib/supabase/server";

type MessagePart = Record<string, unknown>;

const THREAD_COLUMNS = "id, title, model, agent_id, created_at, updated_at";

/** Attaches each thread's agent (name + resolved avatar) for list/detail responses. */
async function withThreadAgents(rows: Thread[]): Promise<Thread[]> {
  const summaries = await loadAgentSummaries(rows.map((row) => row.agent_id));
  return rows.map((row) => ({
    ...row,
    agent: row.agent_id ? (summaries.get(row.agent_id) ?? null) : null,
  }));
}

export async function createThread(
  userId: string,
  options: {
    id?: string;
    title?: string | null;
    model?: string | null;
    agentId?: string | null;
  } = {},
): Promise<Thread> {
  const { data, error } = await supabaseAdmin()
    .from("threads")
    .insert({
      ...(options.id ? { id: options.id } : {}),
      user_id: userId,
      title: options.title ?? null,
      model: options.model ?? null,
      ...(options.agentId ? { agent_id: options.agentId } : {}),
    })
    .select(THREAD_COLUMNS)
    .single();

  if (error || !data) {
    throw new Error(`Could not create thread: ${error?.message ?? "unknown error"}`);
  }

  // Agents are chats: the first thread opened for an agent becomes its
  // primary (persistent) thread, so the agent's conversation keeps growing
  // instead of starting over on every visit.
  if (options.agentId) {
    const { error: primaryError } = await supabaseAdmin()
      .from("agents")
      .update({ primary_thread_id: (data as Thread).id })
      .eq("id", options.agentId)
      .eq("user_id", userId)
      .is("primary_thread_id", null);
    if (primaryError) {
      console.warn("[chat] could not set the agent's primary thread:", primaryError.message);
    }
  }

  const [thread] = await withThreadAgents([data as Thread]);
  return thread;
}

export async function getThread(userId: string, threadId: string): Promise<Thread | null> {
  const { data, error } = await supabaseAdmin()
    .from("threads")
    .select(THREAD_COLUMNS)
    .eq("id", threadId)
    .eq("user_id", userId)
    .maybeSingle();

  if (error) {
    throw new Error(`Could not read thread: ${error.message}`);
  }
  if (!data) return null;
  const [thread] = await withThreadAgents([data as Thread]);
  return thread;
}

export async function listThreads(userId: string, limit = 50): Promise<Thread[]> {
  const { data, error } = await supabaseAdmin()
    .from("threads")
    .select(THREAD_COLUMNS)
    .eq("user_id", userId)
    .order("updated_at", { ascending: false })
    .limit(limit);

  if (error) {
    throw new Error(`Could not list threads: ${error.message}`);
  }
  return withThreadAgents((data as Thread[]) ?? []);
}

export async function listMessages(userId: string, threadId: string): Promise<StoredMessage[]> {
  const { data, error } = await supabaseAdmin()
    .from("messages")
    .select("id, thread_id, role, model, parts, created_at")
    .eq("thread_id", threadId)
    .eq("user_id", userId)
    .order("created_at", { ascending: true });

  if (error) {
    throw new Error(`Could not list messages: ${error.message}`);
  }
  return (data as StoredMessage[]) ?? [];
}

export async function insertMessage(
  userId: string,
  threadId: string,
  role: "user" | "assistant" | "system" | "tool",
  parts: MessagePart[],
  model?: string | null,
): Promise<void> {
  const { error } = await supabaseAdmin().from("messages").insert({
    user_id: userId,
    thread_id: threadId,
    role,
    model: model ?? null,
    parts,
  });

  if (error) {
    console.warn("[chat] could not persist message:", error.message);
    return;
  }

  // Keep the thread's updated_at fresh so the thread list sorts correctly.
  await supabaseAdmin()
    .from("threads")
    .update({ updated_at: new Date().toISOString() })
    .eq("id", threadId)
    .eq("user_id", userId);
}

export async function renameThread(userId: string, threadId: string, title: string): Promise<void> {
  const { error } = await supabaseAdmin()
    .from("threads")
    .update({ title, updated_at: new Date().toISOString() })
    .eq("id", threadId)
    .eq("user_id", userId);

  if (error) {
    throw new Error(`Could not rename thread: ${error.message}`);
  }
}

export async function deleteThread(userId: string, threadId: string): Promise<void> {
  const { error } = await supabaseAdmin()
    .from("threads")
    .delete()
    .eq("id", threadId)
    .eq("user_id", userId);

  if (error) {
    throw new Error(`Could not delete thread: ${error.message}`);
  }
}

/** First user message, truncated, used as the thread title. */
export function titleFromParts(parts: MessagePart[]): string | null {
  const text = parts
    .filter((part) => part.type === "text" && typeof part.text === "string")
    .map((part) => part.text as string)
    .join(" ")
    .trim();

  if (!text) return null;
  return text.length > 60 ? `${text.slice(0, 57)}…` : text;
}
