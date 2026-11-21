import { supabaseAdmin } from "@/lib/supabase/server";

/**
 * Expo Push Service client (https://exp.host/--/api/v2/push/send).
 *
 * No SDK dependency: the REST API is a single POST with a message array, so
 * a plain fetch keeps the API bundle small.
 */

const EXPO_PUSH_URL = "https://exp.host/--/api/v2/push/send";

export type PushMessage = {
  title: string;
  body: string;
  data?: Record<string, unknown>;
  sound?: string | null;
  badge?: number;
};

export type PushResult = {
  sent: number;
  failed: number;
  errors: string[];
};

/** Expo tokens look like `ExponentPushToken[xxx]` or `ExpoPushToken[xxx]`. */
function isExpoToken(token: string): boolean {
  return /^(Exponent|Expo)PushToken\[[A-Za-z0-9_-]+\]$/.test(token);
}

/**
 * Sends push messages to the user's registered devices.
 * Invalid tokens are removed so a dead token never blocks future sends.
 */
export async function sendPush(
  userId: string,
  messages: PushMessage[],
): Promise<PushResult> {
  const result: PushResult = { sent: 0, failed: 0, errors: [] };
  if (messages.length === 0) return result;

  const { data: tokens, error } = await supabaseAdmin()
    .from("push_tokens")
    .select("id, expo_token")
    .eq("user_id", userId);
  if (error) {
    result.errors.push(`Could not read push tokens: ${error.message}`);
    return result;
  }

  const valid = (tokens ?? []).filter((row) => isExpoToken(row.expo_token));
  if (valid.length === 0) {
    result.errors.push("No valid push tokens registered.");
    return result;
  }

  // Expo accepts a batch; keep batches small to stay under payload limits.
  const payload = valid.flatMap((row) =>
    messages.map((message) => ({
      to: row.expo_token,
      title: message.title,
      body: message.body,
      data: message.data ?? {},
      sound: message.sound ?? "default",
      ...(message.badge !== undefined ? { badge: message.badge } : {}),
      channelId: "default",
      priority: "high",
    })),
  );

  try {
    const response = await fetch(EXPO_PUSH_URL, {
      method: "POST",
      headers: { "Content-Type": "application/json", Accept: "application/json" },
      body: JSON.stringify(payload),
    });
    if (!response.ok) {
      result.failed += payload.length;
      result.errors.push(`Expo push API returned ${response.status}.`);
      return result;
    }

    const body = (await response.json()) as {
      data?: Array<{ status: string; id?: string; message?: string }>;
    };
    const ticketErrors = new Set<string>();
    for (const ticket of body.data ?? []) {
      if (ticket.status === "ok") {
        result.sent += 1;
      } else {
        result.failed += 1;
        if (ticket.message) ticketErrors.add(ticket.message);
      }
    }
    result.errors.push(...ticketErrors);
  } catch (error) {
    result.failed += payload.length;
    result.errors.push(error instanceof Error ? error.message : String(error));
  }

  return result;
}

/** Removes push tokens Expo reported as no longer valid. */
export async function pruneDeadTokens(userId: string, tokens: string[]): Promise<void> {
  if (tokens.length === 0) return;
  await supabaseAdmin()
    .from("push_tokens")
    .delete()
    .eq("user_id", userId)
    .in("expo_token", tokens);
}
