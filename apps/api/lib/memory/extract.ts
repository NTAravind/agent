import { generateObject } from "ai";
import { z } from "zod";

import { DEFAULT_FALLBACK_ORDER, DEFAULT_MODEL_ID, FAST_MODEL_ID } from "@/lib/models";
import { withFallback } from "@/lib/models/fallback";
import { upsertMemories } from "@/lib/knowledge/search";
import { supabaseAdmin } from "@/lib/supabase/server";

/**
 * Memory extraction.
 *
 * Phase 9 split the old `kind='task'` memories out of the memory store:
 * todos now live in the `tasks` table. The extractor still *detects*
 * commitments, but a detected task becomes a **suggested task**
 * (`created_by='suggested'`) that the user accepts or dismisses in the
 * Today/Tasks screen — it never lands in the long-term memory store.
 */

const MemorySchema = z.object({
  kind: z.enum(["fact", "preference", "decision", "task"]),
  content: z.string(),
  /** For tasks: optional due date (ISO 8601) inferred from the conversation. */
  dueAt: z.string().optional(),
});

const ExtractionSchema = z.object({
  memories: z.array(MemorySchema),
});

const EXTRACTION_PROMPT = `Extract durable information about the user from this conversation.

Only include things that stay true beyond this conversation:
- fact: something true about the user or their world
- preference: how the user likes things done (style, format, tools, tone)
- decision: a choice the user made and will keep
- task: something the user committed to doing (include an ISO 8601 dueAt when the conversation states one)

Rules:
- One self-contained statement per memory. No pronouns that refer to the conversation.
- Skip small talk, transient context and anything the assistant said about itself.
- If there is nothing worth remembering, return an empty list.`;

/**
 * Extracts memories from a finished conversation and stores them.
 * Detected tasks become suggested tasks instead of memories.
 *
 * Runs inside an Inngest step so a slow model never blocks the chat.
 */
export async function extractMemories(
  userId: string,
  threadId: string,
): Promise<{ inserted: number; skipped: number; suggestedTasks: number }> {
  const { data: messages } = await supabaseAdmin()
    .from("messages")
    .select("role, parts")
    .eq("thread_id", threadId)
    .eq("user_id", userId)
    .order("created_at", { ascending: true })
    .limit(40);

  if (!messages || messages.length === 0) {
    return { inserted: 0, skipped: 0, suggestedTasks: 0 };
  }

  const transcript = (messages as Array<{ role: string; parts: unknown }>)
    .map((message) => {
      const text = (message.parts as Array<{ type: string; text?: string }>)
        .filter((part) => part.type === "text")
        .map((part) => part.text ?? "")
        .join(" ")
        .trim();
      return text ? `${message.role}: ${text}` : null;
    })
    .filter(Boolean)
    .join("\n");

  if (!transcript) return { inserted: 0, skipped: 0, suggestedTasks: 0 };

  const { result } = await withFallback(
    [FAST_MODEL_ID, DEFAULT_MODEL_ID, ...DEFAULT_FALLBACK_ORDER],
    (model) =>
      generateObject({
        model,
        schema: ExtractionSchema,
        prompt: `${EXTRACTION_PROMPT}\n\nConversation:\n${transcript}`,
      }),
    { userId },
  );

  const extracted = result.object.memories
    .map((memory) => ({ ...memory, content: memory.content.trim() }))
    .filter((memory) => memory.content.length >= 3)
    .slice(0, 12);

  if (extracted.length === 0) return { inserted: 0, skipped: 0, suggestedTasks: 0 };

  // Tasks become suggested tasks; only facts/preferences/decisions are memories.
  const tasks = extracted.filter((memory) => memory.kind === "task");
  const memories = extracted
    .filter((memory) => memory.kind !== "task")
    .map((memory) => ({ kind: memory.kind, content: memory.content }));

  const suggestedTasks = await createSuggestedTasks(userId, tasks);
  const resultCounts = memories.length
    ? await upsertMemories(userId, memories, { similar: 0.92 })
    : { inserted: 0, skipped: 0 };

  return { ...resultCounts, suggestedTasks };
}

/**
 * Creates tasks with `created_by='suggested'` for detected commitments.
 * Falls back to the user's first task list when no list exists yet.
 */
async function createSuggestedTasks(
  userId: string,
  tasks: Array<{ content: string; dueAt?: string }>,
): Promise<number> {
  if (tasks.length === 0) return 0;
  const admin = supabaseAdmin();

  const { data: lists } = await admin
    .from("task_lists")
    .select("id")
    .eq("user_id", userId)
    .order("sort", { ascending: true })
    .limit(1);

  let listId = lists?.[0]?.id as string | undefined;
  if (!listId) {
    const { data: created } = await admin
      .from("task_lists")
      .insert({ user_id: userId, name: "Inbox", sort: 0 })
      .select("id")
      .single();
    if (!created) return 0;
    listId = created.id as string;
  }

  const rows = tasks.map((task) => ({
    user_id: userId,
    list_id: listId,
    title: task.content.slice(0, 200),
    notes: null,
    created_by: "suggested",
    ...(task.dueAt ? { due_at: task.dueAt } : {}),
  }));

  const { error } = await admin.from("tasks").insert(rows);
  if (error) {
    console.warn("[memory] could not create suggested tasks:", error.message);
    return 0;
  }
  return rows.length;
}
