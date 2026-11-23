import { supabaseAdmin } from "@/lib/supabase/server";

/** One prior conversation turn, as stored on the run row. */
export type ThreadContextTurn = {
  role: "user" | "assistant";
  text: string;
};

/** Bounded prior-conversation context for one Task Mode run. */
export type ThreadContext = {
  turns: ThreadContextTurn[];
};

const MAX_TURNS = 12;
const MAX_TURN_CHARS = 1_500;

/** Extracts plain text from a stored message's parts. */
export function textFromParts(parts: unknown): string {
  if (!Array.isArray(parts)) return "";
  return parts
    .filter(
      (part): part is { type: string; text?: unknown } =>
        Boolean(part) &&
        typeof part === "object" &&
        (part as { type?: unknown }).type === "text",
    )
    .map((part) => String(part.text ?? ""))
    .join(" ")
    .trim();
}

/**
 * Turns stored message rows into a bounded context snapshot.
 *
 * The snapshot keeps the last `limit` turns and truncates each one, so a
 * long conversation cannot blow up the prompt of the next task.
 */
export function buildThreadContext(
  rows: Array<{ role?: string | null; parts?: unknown }>,
  limit: number = MAX_TURNS,
): ThreadContext {
  const max = Math.min(Math.max(limit, 1), MAX_TURNS);

  const turns: ThreadContextTurn[] = [];
  for (const row of rows) {
    const text = textFromParts(row.parts);
    if (!text) continue;
    turns.push({
      role: row.role === "assistant" ? "assistant" : "user",
      text: text.slice(0, MAX_TURN_CHARS),
    });
  }

  return { turns: turns.slice(-max) };
}

/**
 * Loads the earlier turns of a thread so a Task Mode run can continue the
 * conversation instead of starting from the goal alone.
 *
 * The snapshot is bounded (turn count and per-turn length) and excludes the
 * current turn. Group threads are not read here — they own their own context.
 */
export async function loadThreadContext(
  userId: string,
  threadId: string,
  options: { limit?: number } = {},
): Promise<ThreadContext> {
  const { data, error } = await supabaseAdmin()
    .from("messages")
    .select("role, parts")
    .eq("thread_id", threadId)
    .eq("user_id", userId)
    .in("role", ["user", "assistant"])
    .order("created_at", { ascending: true });

  if (error) {
    // A missing context must never block a task; the goal alone still works.
    console.warn("[agent] could not load the thread context:", error.message);
    return { turns: [] };
  }

  return buildThreadContext(
    (data ?? []) as Array<{ role?: string | null; parts?: unknown }>,
    options.limit ?? MAX_TURNS,
  );
}

/** Renders the context as a compact prompt block. */
export function formatThreadContext(context: ThreadContext | null | undefined): string {
  if (!context?.turns?.length) return "";
  return context.turns
    .map((turn) => `${turn.role === "user" ? "User" : "Assistant"}: ${turn.text}`)
    .join("\n");
}
