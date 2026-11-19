import { generateObject } from "ai";
import { z } from "zod";

import { DEFAULT_FALLBACK_ORDER, DEFAULT_MODEL_ID, FAST_MODEL_ID } from "@/lib/models";
import { withFallback } from "@/lib/models/fallback";
import { upsertMemories } from "@/lib/knowledge/search";
import { supabaseAdmin } from "@/lib/supabase/server";

const MemorySchema = z.object({
  kind: z.enum(["fact", "preference", "decision", "task"]),
  content: z.string(),
});

const ExtractionSchema = z.object({
  memories: z.array(MemorySchema),
});

const EXTRACTION_PROMPT = `Extract durable information about the user from this conversation.

Only include things that stay true beyond this conversation:
- fact: something true about the user or their world
- preference: how the user likes things done (style, format, tools, tone)
- decision: a choice the user made and will keep
- task: something the user committed to doing

Rules:
- One self-contained statement per memory. No pronouns that refer to the conversation.
- Skip small talk, transient context and anything the assistant said about itself.
- If there is nothing worth remembering, return an empty list.`;

/**
 * Extracts memories from a finished conversation and stores them.
 *
 * Runs inside an Inngest step so a slow model never blocks the chat.
 */
export async function extractMemories(
  userId: string,
  threadId: string,
): Promise<{ inserted: number; skipped: number }> {
  const { data: messages } = await supabaseAdmin()
    .from("messages")
    .select("role, parts")
    .eq("thread_id", threadId)
    .eq("user_id", userId)
    .order("created_at", { ascending: true })
    .limit(40);

  if (!messages || messages.length === 0) {
    return { inserted: 0, skipped: 0 };
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

  if (!transcript) return { inserted: 0, skipped: 0 };

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

  const memories = result.object.memories
    .map((memory) => ({ kind: memory.kind, content: memory.content.trim() }))
    .filter((memory) => memory.content.length >= 3)
    .slice(0, 12);

  if (memories.length === 0) return { inserted: 0, skipped: 0 };

  return upsertMemories(userId, memories, { similar: 0.92 });
}
