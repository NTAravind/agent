/**
 * Live acceptance check for the task/chat hardening (review findings 1-5).
 *
 *   npx tsx --env-file=.env.local scripts/check-task-hardening-live.ts
 *
 * Checks, against the running API and the real database:
 *  1. Task Mode start is idempotent: the same `idempotency-key` returns the
 *     same run, creates no second run and no second user turn.
 *  2. A task on an existing thread continues that conversation: the run row
 *     carries a bounded snapshot of the earlier turns.
 *  3. An ordinary-chat MCP approval is recorded as a server-side grant, bound
 *     to the user, thread, agent and MCP connection, and is consumed exactly
 *     once when the user approves it.
 *
 * It consumes provider quota (one chat turn that reaches the Gmail
 * integration).
 */
import { randomUUID } from "node:crypto";

import { supabaseAdmin } from "../lib/supabase/server";

const checks: Array<{ name: string; ok: boolean; detail?: string }> = [];
function check(name: string, ok: boolean, detail?: string) {
  checks.push({ name, ok, detail });
  console.log(`${ok ? "✔" : "✖"} ${name}${detail ? ` — ${detail}` : ""}`);
}

const baseUrl = (process.env.API_BASE_URL ?? "http://localhost:3000").replace(/\/$/, "");

async function request(
  path: string,
  init: RequestInit & { token?: string } = {},
): Promise<{ status: number; body: Record<string, unknown> }> {
  const { token, headers, ...rest } = init;
  const response = await fetch(`${baseUrl}${path}`, {
    ...rest,
    headers: {
      ...(rest.body ? { "Content-Type": "application/json" } : {}),
      ...(token ? { Authorization: `Bearer ${token}` } : {}),
      ...(headers ?? {}),
    },
  });
  const text = await response.text();
  let body: Record<string, unknown> = {};
  try {
    body = text ? (JSON.parse(text) as Record<string, unknown>) : {};
  } catch {
    body = { raw: text };
  }
  return { status: response.status, body };
}

/** Mints a short-lived access token for the check user. */
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

/** Reads the UI message stream and returns its chunks. */
async function readUiStream(response: Response): Promise<Array<Record<string, unknown>>> {
  const reader = response.body?.getReader();
  if (!reader) return [];
  const decoder = new TextDecoder();
  const chunks: Array<Record<string, unknown>> = [];
  let buffer = "";

  while (true) {
    const { done, value } = await reader.read();
    if (done) break;
    buffer += decoder.decode(value, { stream: true });
    const frames = buffer.split("\n\n");
    buffer = frames.pop() ?? "";
    for (const frame of frames) {
      for (const line of frame.split("\n")) {
        if (!line.startsWith("data:")) continue;
        const payload = line.slice(5).trim();
        if (!payload || payload === "[DONE]") continue;
        try {
          chunks.push(JSON.parse(payload) as Record<string, unknown>);
        } catch {
          // Ignore non-JSON frames.
        }
      }
    }
  }

  return chunks;
}

async function main() {
  const userId = process.env.CHECK_USER_ID;
  if (!userId) throw new Error("CHECK_USER_ID is not set.");
  const token = await mintAccessToken(userId);
  if (!token) throw new Error("Could not mint an access token for the check user.");

  const admin = supabaseAdmin();
  const threadId = randomUUID();
  const goal = `Reply with exactly: hardening check ${randomUUID().slice(0, 8)}`;

  // --- 1. Idempotent task start -------------------------------------------
  const idempotencyKey = randomUUID();
  const first = await request("/api/agents/run", {
    method: "POST",
    token,
    headers: { "idempotency-key": idempotencyKey },
    body: JSON.stringify({ goal, threadId, tz: "Asia/Kolkata" }),
  });
  const firstRunId = String(first.body.runId ?? "");
  check("task start accepted", first.status === 202 && Boolean(firstRunId), `status ${first.status}`);

  const second = await request("/api/agents/run", {
    method: "POST",
    token,
    headers: { "idempotency-key": idempotencyKey },
    body: JSON.stringify({ goal, threadId, tz: "Asia/Kolkata" }),
  });
  check(
    "a repeated start returns the same run",
    second.status === 202 && second.body.runId === firstRunId && second.body.idempotent === true,
    `status ${second.status}, run ${String(second.body.runId ?? "")}, idempotent ${String(second.body.idempotent)}`,
  );

  const { data: runs } = await admin
    .from("agent_runs")
    .select("id")
    .eq("user_id", userId)
    .eq("idempotency_key", idempotencyKey);
  check("only one run row exists for the key", (runs ?? []).length === 1, `${(runs ?? []).length} rows`);

  const { data: userMessages } = await admin
    .from("messages")
    .select("id")
    .eq("thread_id", threadId)
    .eq("user_id", userId)
    .eq("role", "user");
  check("only one user turn was stored", (userMessages ?? []).length === 1, `${(userMessages ?? []).length} rows`);

  // --- 2. Task Mode continues the thread ----------------------------------
  const followUpGoal = `Now reply with exactly: follow up ${randomUUID().slice(0, 8)}`;
  const followUp = await request("/api/agents/run", {
    method: "POST",
    token,
    headers: { "idempotency-key": randomUUID() },
    body: JSON.stringify({ goal: followUpGoal, threadId, tz: "Asia/Kolkata" }),
  });
  const followUpRunId = String(followUp.body.runId ?? "");
  check("follow-up task accepted", followUp.status === 202 && Boolean(followUpRunId), `status ${followUp.status}`);

  const { data: contextRow } = await admin
    .from("agent_runs")
    .select("thread_context")
    .eq("id", followUpRunId)
    .maybeSingle();
  const context = (contextRow?.thread_context ?? {}) as {
    turns?: Array<{ role?: string; text?: string }>;
  };
  const contextText = (context.turns ?? []).map((turn) => turn.text ?? "").join(" | ");
  check(
    "the follow-up run carries the earlier turns",
    contextText.includes(goal),
    contextText.slice(0, 120) || "empty context",
  );
  check(
    "the follow-up run does not carry its own turn",
    !contextText.includes(followUpGoal),
    contextText.slice(0, 120) || "empty context",
  );

  // --- 3. Ordinary-chat approval grant ------------------------------------
  // MCP tools are exposed for the conversation's agent, so the check binds
  // the chat to the user's agent (the app does the same).
  const { data: agents } = await admin
    .from("agents")
    .select("id")
    .eq("user_id", userId)
    .order("created_at", { ascending: true })
    .limit(1);
  const agentId = String(agents?.[0]?.id ?? "");
  check("the check user has an agent", Boolean(agentId), agentId);

  const chatThreadId = randomUUID();
  const chatPrompt =
    "You must call the Composio tool named mcp_composio_gmail_COMPOSIO_SEARCH_TOOLS. Do not use web_search. Call it with a query for 'gmail send email'.";
  const chatResponse = await fetch(`${baseUrl}/api/chat`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${token}`,
    },
    body: JSON.stringify({
      threadId: chatThreadId,
      agentId,
      ...(process.env.CHECK_MODEL ? { model: process.env.CHECK_MODEL } : {}),
      messages: [
        {
          id: randomUUID(),
          role: "user",
          parts: [{ type: "text", text: chatPrompt }],
        },
      ],
    }),
  });
  check("chat stream started", chatResponse.ok, `status ${chatResponse.status}`);
  const chunks = await readUiStream(chatResponse);
  const approvalChunk = chunks.find((chunk) => chunk.type === "tool-approval-request") as
    | { approvalId?: string; toolCallId?: string; signature?: string }
    | undefined;
  const inputChunk = chunks.find(
    (chunk) =>
      chunk.type === "tool-input-available" &&
      chunk.toolCallId === approvalChunk?.toolCallId,
  ) as { toolName?: string; input?: unknown } | undefined;

  if (!approvalChunk?.toolCallId) {
    check("an inline approval was requested", false, "no tool-approval-request in the stream");
  } else {
    check("an inline approval was requested", true, `tool call ${approvalChunk.toolCallId}`);

    const { data: grant } = await admin
      .from("chat_approval_grants")
      .select("*")
      .eq("tool_call_id", approvalChunk.toolCallId)
      .maybeSingle();
    check("the approval was recorded as a grant", Boolean(grant), grant?.status ?? "missing");
    check(
      "the grant is bound to the user, thread and agent",
      grant?.user_id === userId && grant?.thread_id === chatThreadId && Boolean(grant?.agent_id),
      `thread ${String(grant?.thread_id ?? "")}, agent ${String(grant?.agent_id ?? "")}`,
    );
    check(
      "the grant is bound to the MCP connection",
      Boolean(grant?.connection_id),
      String(grant?.connection_id ?? ""),
    );
    check("the grant is pending", grant?.status === "pending", String(grant?.status ?? ""));

    // Approve it: the client sends the complete history with the decision.
    const assistantId = randomUUID();
    const toolName = inputChunk?.toolName ?? String(grant?.tool_name ?? "");
    const history = [
      {
        id: randomUUID(),
        role: "user",
        parts: [{ type: "text", text: chatPrompt }],
      },
      {
        id: assistantId,
        role: "assistant",
        parts: [
          {
            type: `tool-${toolName}`,
            toolCallId: approvalChunk.toolCallId,
            state: "approval-responded",
            input: inputChunk?.input ?? {},
            approval: {
              id: approvalChunk.approvalId,
              approved: true,
              ...(approvalChunk.signature ? { signature: approvalChunk.signature } : {}),
            },
          },
        ],
      },
    ];
    const approveResponse = await fetch(`${baseUrl}/api/chat`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${token}`,
      },
      body: JSON.stringify({
        threadId: chatThreadId,
        agentId,
        ...(process.env.CHECK_MODEL ? { model: process.env.CHECK_MODEL } : {}),
        messages: history,
      }),
    });
    const approveChunks = await readUiStream(approveResponse);
    const toolRan = approveChunks.some((chunk) => chunk.type === "tool-output-available");
    check(
      "the approved tool ran",
      toolRan,
      approveChunks.map((chunk) => String(chunk.type)).join(", "),
    );

    const { data: consumed } = await admin
      .from("chat_approval_grants")
      .select("status")
      .eq("tool_call_id", approvalChunk.toolCallId)
      .maybeSingle();
    check("the grant was consumed", consumed?.status === "consumed", String(consumed?.status ?? "missing"));

    // A replay of the same approval must not run the tool again.
    const replayResponse = await fetch(`${baseUrl}/api/chat`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${token}`,
      },
      body: JSON.stringify({
        threadId: chatThreadId,
        agentId,
        ...(process.env.CHECK_MODEL ? { model: process.env.CHECK_MODEL } : {}),
        messages: history,
      }),
    });
    const replayChunks = await readUiStream(replayResponse);
    const replayRan = replayChunks.some(
      (chunk) => chunk.type === "tool-output-available",
    );
    check(
      "the replayed approval did not run the tool",
      !replayRan,
      replayChunks.map((chunk) => String(chunk.type)).join(", "),
    );
  }

  const failed = checks.filter((entry) => !entry.ok);
  console.log(`\n${checks.length - failed.length}/${checks.length} checks passed`);
  if (failed.length) process.exitCode = 1;
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
