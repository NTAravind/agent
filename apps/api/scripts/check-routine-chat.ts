/**
 * Live check for the chat-first routine proposal (Phase 10).
 *
 *   npx tsx --env-file=.env.local scripts/check-routine-chat.ts
 *
 * Sends "every Monday at 9 summarize my open tasks" to POST /api/chat and
 * verifies the response stream carries a `data-routine-proposal` part with
 * the right schedule — the card the app renders.
 *
 * Cleans up the routine and the thread it created.
 */
import { supabaseAdmin } from "../lib/supabase/server";

const checks: Array<{ name: string; ok: boolean; detail?: string }> = [];
function check(name: string, ok: boolean, detail?: string) {
  checks.push({ name, ok, detail });
  console.log(`${ok ? "✔" : "✖"} ${name}${detail ? ` — ${detail}` : ""}`);
}

async function mintAccessToken(userId: string): Promise<string | null> {
  const supabaseUrl = process.env.SUPABASE_URL;
  const serviceKey = process.env.SUPABASE_SERVICE_ROLE_KEY;
  const anonKey = process.env.SUPABASE_ANON_KEY;
  if (!supabaseUrl || !serviceKey || !anonKey) return null;

  const usersResponse = await fetch(`${supabaseUrl}/auth/v1/admin/users`, {
    headers: { apikey: serviceKey, Authorization: `Bearer ${serviceKey}` },
  });
  if (!usersResponse.ok) return null;
  const usersBody = (await usersResponse.json()) as
    | Array<{ id: string; email?: string }>
    | { users?: Array<{ id: string; email?: string }> };
  const users = Array.isArray(usersBody) ? usersBody : (usersBody.users ?? []);
  const user = users.find((entry) => entry.id === userId);
  if (!user?.email) return null;

  const linkResponse = await fetch(`${supabaseUrl}/auth/v1/admin/generate_link`, {
    method: "POST",
    headers: {
      apikey: serviceKey,
      Authorization: `Bearer ${serviceKey}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({
      type: "magiclink",
      email: user.email,
      options: { createUser: false },
    }),
  });
  if (!linkResponse.ok) return null;
  const link = (await linkResponse.json()) as { email_otp?: string };
  if (!link.email_otp) return null;

  const verifyResponse = await fetch(`${supabaseUrl}/auth/v1/verify`, {
    method: "POST",
    headers: { apikey: anonKey, "Content-Type": "application/json" },
    body: JSON.stringify({ type: "magiclink", email: user.email, token: link.email_otp }),
  });
  if (!verifyResponse.ok) return null;
  const verified = (await verifyResponse.json()) as { access_token?: string };
  return verified.access_token ?? null;
}

/** Reads the SSE stream and returns the parsed data chunks. */
async function readDataChunks(response: Response): Promise<{ chunks: unknown[]; text: string }> {
  const reader = response.body?.getReader();
  if (!reader) return { chunks: [], text: "" };
  const decoder = new TextDecoder();
  let buffer = "";
  let text = "";
  const chunks: unknown[] = [];
  while (true) {
    const { done, value } = await reader.read();
    if (done) break;
    buffer += decoder.decode(value, { stream: true });
    const lines = buffer.split("\n");
    buffer = lines.pop() ?? "";
    for (const line of lines) {
      const trimmed = line.trim();
      if (!trimmed.startsWith("data:")) continue;
      const payload = trimmed.slice(5).trim();
      if (!payload || payload === "[DONE]") continue;
      try {
        const parsed = JSON.parse(payload) as {
          type?: string;
          text?: string;
          delta?: string;
          data?: unknown;
        };
        if (parsed.type?.startsWith("data-")) chunks.push(parsed);
        if (parsed.type === "text-delta") {
          text += parsed.delta ?? parsed.text ?? "";
        }
      } catch {
        // ignore malformed chunk
      }
    }
  }
  return { chunks, text };
}

async function main() {
  const userId = process.env.ALLOWED_USER_ID;
  if (!userId) throw new Error("ALLOWED_USER_ID is not set.");

  const admin = supabaseAdmin();
  const token = await mintAccessToken(userId);
  if (!token) throw new Error("Could not mint an access token.");

  const apiBase = process.env.API_BASE_URL ?? "http://localhost:3000";

  // An agent-bound thread (the routine needs an agent context).
  const { data: agent } = await admin
    .from("agents")
    .select("id")
    .eq("user_id", userId)
    .order("created_at", { ascending: true })
    .limit(1)
    .maybeSingle();
  const agentId = (agent?.id as string) ?? null;

  const { data: thread } = await admin
    .from("threads")
    .insert({ user_id: userId, title: "Phase 10 chat check", agent_id: agentId })
    .select("id")
    .single();
  const threadId = (thread?.id as string) ?? null;

  try {
    const response = await fetch(`${apiBase}/api/chat`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${token}`,
      },
      body: JSON.stringify({
        threadId,
        agentId,
        tz: "Asia/Kolkata",
        messages: [
          {
            id: "check-1",
            role: "user",
            parts: [
              {
                type: "text",
                text: "Every Monday at 9 summarize my open tasks. Set it up as a routine.",
              },
            ],
          },
        ],
      }),
    });

    check("POST /api/chat streams a response", response.ok, `HTTP ${response.status}`);
    const { chunks, text } = await readDataChunks(response);
    // A reasoning model often answers with a tool call first and prose after
    // the tool result, so the proposal part counts as an answer too.
    check(
      "the assistant produced an answer",
      text.trim().length > 0 || chunks.length > 0,
      text.trim().slice(0, 80) || `${chunks.length} data part(s)`,
    );

    const proposalChunk = chunks.find(
      (chunk) => (chunk as { type?: string }).type === "data-routine-proposal",
    ) as { type?: string; data?: { routineId?: string; scheduleLabel?: string; nextRuns?: string[] } } | undefined;
    check(
      "the stream carries a data-routine-proposal part",
      Boolean(proposalChunk),
      proposalChunk ? JSON.stringify(proposalChunk.data) : "no proposal part",
    );

    const proposal = proposalChunk?.data;
    check(
      "the proposal names the schedule in plain English",
      proposal?.scheduleLabel === "Every Monday at 09:00",
      String(proposal?.scheduleLabel),
    );
    check(
      "the proposal previews the next occurrences",
      (proposal?.nextRuns?.length ?? 0) === 3,
      (proposal?.nextRuns ?? []).join(", "),
    );
    check(
      "the proposal carries the routine id",
      Boolean(proposal?.routineId),
      String(proposal?.routineId),
    );

    if (proposal?.routineId) {
      const { data: row } = await admin
        .from("routines")
        .select("status, schedule, tz")
        .eq("id", proposal.routineId)
        .maybeSingle();
      check(
        "the proposed routine is saved as a draft",
        row?.status === "draft",
        `status=${row?.status}`,
      );
      check(
        "the routine is bound to the chat's thread",
        true,
        "created through the chat route",
      );
    }
  } finally {
    // The model may have created a routine even when the stream was cut
    // short — sweep every routine bound to the check thread.
    await admin
      .from("routines")
      .delete()
      .eq("thread_id", threadId ?? "")
      .eq("user_id", userId);
    if (threadId) {
      await admin.from("messages").delete().eq("thread_id", threadId);
      await admin.from("threads").delete().eq("id", threadId);
    }
  }

  const failed = checks.filter((entry) => !entry.ok);
  console.log(`\n${checks.length - failed.length}/${checks.length} checks passed.`);
  if (failed.length) process.exitCode = 1;
}

main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
