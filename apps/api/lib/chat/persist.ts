import type { GroupHandoffPayload, Thread, StoredMessage } from "@agent/shared";
import { z } from "zod";

import { loadAgentSummaries } from "@/lib/agents";
import { supabaseAdmin } from "@/lib/supabase/server";

type MessagePart = Record<string, unknown>;

const THREAD_COLUMNS = "id, title, model, agent_id, group_id, created_at, updated_at";

type ThreadGroupSummary = { id: string; name: string; mode: "handoff" | "roundtable" };

/** Attaches the minimal group summary to group threads. */
async function withThreadGroups(rows: Thread[], userId: string): Promise<Thread[]> {
  const ids = [...new Set(rows.map((row) => row.group_id).filter((id): id is string => Boolean(id)))];
  if (ids.length === 0) return rows;
  const { data } = await supabaseAdmin()
    .from("agent_groups")
    .select("id, name, mode")
    .in("id", ids)
    .eq("user_id", userId);
  const groups = new Map(
    ((data ?? []) as ThreadGroupSummary[]).map((group) => [group.id, group]),
  );
  return rows.map((row) => ({
    ...row,
    group: row.group_id ? (groups.get(row.group_id) ?? null) : null,
  }));
}

/** Attaches each thread's agent (name + resolved avatar) for list/detail responses. */
async function withThreadAgents(rows: Thread[], userId: string): Promise<Thread[]> {
  const [summaries, grouped] = await Promise.all([
    loadAgentSummaries(rows.map((row) => row.agent_id), userId),
    withThreadGroups(rows, userId),
  ]);
  return grouped.map((row) => ({
    ...row,
    agent: row.agent_id ? (summaries.get(row.agent_id) ?? null) : null,
  }));
}

/** Sets an agent's primary thread when it does not have one yet. */
async function setPrimaryThreadIfUnset(
  userId: string,
  agentId: string,
  threadId: string,
): Promise<void> {
  const { error } = await supabaseAdmin()
    .from("agents")
    .update({ primary_thread_id: threadId })
    .eq("id", agentId)
    .eq("user_id", userId)
    .is("primary_thread_id", null);
  if (error) {
    console.warn("[chat] could not set the agent's primary thread:", error.message);
  }
}

export async function createThread(
  userId: string,
  options: {
    id?: string;
    title?: string | null;
    model?: string | null;
    agentId?: string | null;
    /** Group this thread belongs to (group chat). */
    groupId?: string | null;
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
      ...(options.groupId ? { group_id: options.groupId } : {}),
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
    await setPrimaryThreadIfUnset(userId, options.agentId, (data as Thread).id);
  }

  const [thread] = await withThreadAgents([data as Thread], userId);
  return thread;
}

/**
 * Binds an unscoped thread to an agent.
 *
 * The update is conditional on `agent_id is null`, so two concurrent requests
 * cannot move the same thread to different agents. The returned id is the
 * thread's effective owner after the update.
 */
export async function bindThreadToAgent(
  userId: string,
  threadId: string,
  agentId: string,
): Promise<string | null> {
  const { data, error } = await supabaseAdmin()
    .from("threads")
    .update({ agent_id: agentId })
    .eq("id", threadId)
    .eq("user_id", userId)
    .is("agent_id", null)
    .select("agent_id")
    .maybeSingle();

  if (error) {
    throw new Error(`Could not bind thread to agent: ${error.message}`);
  }

  // A concurrent request may have won the conditional update. Re-read the
  // thread so the caller can reject a conflicting owner instead of using it.
  const effectiveAgentId =
    (data as { agent_id?: string | null } | null)?.agent_id ??
    (await getThread(userId, threadId))?.agent_id ??
    null;

  if (effectiveAgentId === agentId) {
    await setPrimaryThreadIfUnset(userId, agentId, threadId);
  }

  return effectiveAgentId;
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
  const [thread] = await withThreadAgents([data as Thread], userId);
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
  return withThreadAgents((data as Thread[]) ?? [], userId);
}

export async function listMessages(userId: string, threadId: string): Promise<StoredMessage[]> {
  const { data, error } = await supabaseAdmin()
    .from("messages")
    .select(
      "id, thread_id, role, model, parts, from_agent_id, to_agent_id, handoff, run_id, created_at",
    )
    .eq("thread_id", threadId)
    .eq("user_id", userId)
    .order("created_at", { ascending: true });

  if (error) {
    throw new Error(`Could not list messages: ${error.message}`);
  }
  const messages = (data as StoredMessage[]) ?? [];
  const summaries = await loadAgentSummaries(
    messages.flatMap((message) => [message.from_agent_id, message.to_agent_id]),
    userId,
  );
  return messages.map((message) => ({
    ...message,
    fromAgent: message.from_agent_id
      ? (summaries.get(message.from_agent_id) ?? null)
      : null,
    toAgent: message.to_agent_id ? (summaries.get(message.to_agent_id) ?? null) : null,
  }));
}

export async function insertMessage(
  userId: string,
  threadId: string,
  role: "user" | "assistant" | "system" | "tool",
  parts: MessagePart[],
  model?: string | null,
  options?: {
    fromAgentId?: string | null;
    toAgentId?: string | null;
    handoff?: GroupHandoffPayload | null;
    runId?: string | null;
  },
): Promise<void> {
  const { error } = await supabaseAdmin().from("messages").insert({
    user_id: userId,
    thread_id: threadId,
    role,
    model: model ?? null,
    parts,
    ...(options?.fromAgentId ? { from_agent_id: options.fromAgentId } : {}),
    ...(options?.toAgentId ? { to_agent_id: options.toAgentId } : {}),
    ...(options?.handoff ? { handoff: options.handoff } : {}),
    ...(options?.runId ? { run_id: options.runId } : {}),
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

/**
 * Inserts or updates one assistant message without ever crossing ownership.
 *
 * The update is scoped by message id, user id and thread id. If the row does
 * not exist yet, it is inserted with the same id. This is used by ordinary
 * chat: the first response inserts a UUID-backed assistant row, while an
 * inline-approval continuation updates that same row instead of creating a
 * duplicate. A foreign message id can therefore never be overwritten.
 */
export async function upsertOwnedMessage(input: {
  userId: string;
  threadId: string;
  messageId: string;
  role: "user" | "assistant" | "system" | "tool";
  parts: MessagePart[];
  model?: string | null;
  fromAgentId?: string | null;
  toAgentId?: string | null;
  handoff?: GroupHandoffPayload | null;
  runId?: string | null;
}): Promise<boolean> {
  if (!z.string().uuid().safeParse(input.messageId).success) {
    console.warn("[chat] refused to persist a message with a non-UUID id.");
    return false;
  }

  const mutableFields: Record<string, unknown> = {
    role: input.role,
    model: input.model ?? null,
    parts: input.parts,
  };
  if (input.fromAgentId !== undefined) mutableFields.from_agent_id = input.fromAgentId;
  if (input.toAgentId !== undefined) mutableFields.to_agent_id = input.toAgentId;
  if (input.handoff !== undefined) mutableFields.handoff = input.handoff;
  if (input.runId !== undefined) mutableFields.run_id = input.runId;

  const admin = supabaseAdmin();
  const updateOwned = async (): Promise<{ found: boolean; error: unknown }> => {
    const { data, error } = await admin
      .from("messages")
      .update(mutableFields)
      .eq("id", input.messageId)
      .eq("user_id", input.userId)
      .eq("thread_id", input.threadId)
      .select("id")
      .maybeSingle();
    return { found: Boolean(data), error };
  };

  const updated = await updateOwned();
  if (updated.error) {
    console.warn("[chat] could not update message:", updated.error);
    return false;
  }
  if (updated.found) {
    await touchThread(input.userId, input.threadId);
    return true;
  }

  const { error: insertError } = await admin.from("messages").insert({
    id: input.messageId,
    user_id: input.userId,
    thread_id: input.threadId,
    role: input.role,
    model: input.model ?? null,
    parts: input.parts,
    ...(input.fromAgentId !== undefined ? { from_agent_id: input.fromAgentId } : {}),
    ...(input.toAgentId !== undefined ? { to_agent_id: input.toAgentId } : {}),
    ...(input.handoff !== undefined ? { handoff: input.handoff } : {}),
    ...(input.runId !== undefined ? { run_id: input.runId } : {}),
  });

  if (insertError) {
    // A concurrent request may have inserted the same row after our scoped
    // update found nothing. Retry the ownership-scoped update once; never
    // fall back to an unscoped upsert that could overwrite another user's row.
    const retried = await updateOwned();
    if (retried.error || !retried.found) {
      console.warn("[chat] could not persist message:", insertError);
      return false;
    }
  }

  await touchThread(input.userId, input.threadId);
  return true;
}

/** Keeps a thread's updated_at fresh after a message write. */
async function touchThread(userId: string, threadId: string): Promise<void> {
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
