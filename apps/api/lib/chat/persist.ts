import type { Thread, StoredMessage } from "@agent/shared";

import { supabaseAdmin } from "@/lib/supabase/server";

type MessagePart = Record<string, unknown>;

export async function createThread(
  userId: string,
  options: { id?: string; title?: string | null; model?: string | null } = {},
): Promise<Thread> {
  const { data, error } = await supabaseAdmin()
    .from("threads")
    .insert({
      ...(options.id ? { id: options.id } : {}),
      user_id: userId,
      title: options.title ?? null,
      model: options.model ?? null,
    })
    .select("id, title, model, created_at, updated_at")
    .single();

  if (error || !data) {
    throw new Error(`Could not create thread: ${error?.message ?? "unknown error"}`);
  }

  return data as Thread;
}

export async function getThread(userId: string, threadId: string): Promise<Thread | null> {
  const { data, error } = await supabaseAdmin()
    .from("threads")
    .select("id, title, model, created_at, updated_at")
    .eq("id", threadId)
    .eq("user_id", userId)
    .maybeSingle();

  if (error) {
    throw new Error(`Could not read thread: ${error.message}`);
  }
  return (data as Thread | null) ?? null;
}

export async function listThreads(userId: string, limit = 50): Promise<Thread[]> {
  const { data, error } = await supabaseAdmin()
    .from("threads")
    .select("id, title, model, created_at, updated_at")
    .eq("user_id", userId)
    .order("updated_at", { ascending: false })
    .limit(limit);

  if (error) {
    throw new Error(`Could not list threads: ${error.message}`);
  }
  return (data as Thread[]) ?? [];
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
