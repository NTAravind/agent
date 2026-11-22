import {
  convertToModelMessages,
  createUIMessageStream,
  createUIMessageStreamResponse,
  toUIMessageStream,
  type UIMessage,
  type UIMessageChunk,
} from "ai";
import { ChatRequestSchema } from "@agent/shared";

import { ownedAgentId } from "@/lib/agents";
import { requireUser, toErrorResponse } from "@/lib/auth";
import { loadAttachments, withAttachmentParts } from "@/lib/chat/attachments";
import {
  bindThreadToAgent,
  createThread,
  getThread,
  insertMessage,
  titleFromParts,
} from "@/lib/chat/persist";
import { resolveChatAgentScope } from "@/lib/chat/agent-scope";
import { createChatStream } from "@/lib/chat/stream";
import { buildSystemPrompt } from "@/lib/chat/system-prompt";
import { inngest } from "@/lib/inngest/client";
import { chatCompleted } from "@/lib/inngest/events";
import { buildKnowledgeTools } from "@/lib/tools/knowledge";
import { buildWebTools } from "@/lib/tools/web-tools";
import { DEFAULT_FALLBACK_ORDER, DEFAULT_MODEL_ID, findRegistryEntry } from "@/lib/models";
import { defaultMobileModel, primeMobileModel } from "@/lib/models/catalog";
import { buildSkillTools } from "@/lib/skills/load";
import { buildRoutineTools, routineProposalPayload } from "@/lib/routines/tools";
import { DEFAULT_TIMEZONE } from "@/lib/routines/schedule";

export const maxDuration = 300;

/**
 * POST /api/chat — streams a chat completion.
 *
 * Body: { threadId?, agentId?, messages, model?, attachments? }
 * Auth: Bearer <supabase JWT>
 */
export async function POST(request: Request) {
  try {
    const user = await requireUser(request);

    const parsed = ChatRequestSchema.safeParse(await request.json().catch(() => null));
    if (!parsed.success) {
      return Response.json(
        { error: { code: "bad_request", message: "Invalid chat request body." } },
        { status: 400 },
      );
    }
    const body = parsed.data;

    // Group threads are durable group conversations: their messages are group
    // runs (route → agent_turn → … → finalize), never an ordinary chat stream.
    // Rejected before any model priming, tool building or message persisting.
    let threadId = body.threadId ?? null;
    let knownThread: Awaited<ReturnType<typeof getThread>> = null;
    if (threadId) {
      knownThread = await getThread(user.id, threadId);
      if (knownThread?.group_id) {
        return Response.json(
          {
            error: {
              code: "group_thread",
              message:
                "This conversation belongs to an agent group. Send group messages through the group run endpoint instead.",
            },
          },
          { status: 409 },
        );
      }
    }

    // Agent scope: a thread's persisted owner is authoritative. The request
    // may repeat that owner (or omit it), but it may not move the thread to a
    // different agent. This prevents one agent's transcript from being used
    // as another agent's context.
    const requestedAgentId = body.agentId ?? null;
    if (requestedAgentId && !(await ownedAgentId(user.id, requestedAgentId))) {
      return Response.json(
        { error: { code: "agent_not_found", message: "Unknown agent." } },
        { status: 404 },
      );
    }

    let agentId: string | null = null;
    if (knownThread) {
      const scope = resolveChatAgentScope(requestedAgentId, knownThread.agent_id);
      if (!scope.ok) {
        return Response.json(
          { error: { code: scope.code, message: scope.message } },
          { status: 409 },
        );
      }

      agentId = scope.agentId;
      if (scope.bindToThread && agentId) {
        const effectiveAgentId = await bindThreadToAgent(user.id, threadId!, agentId);
        if (effectiveAgentId !== agentId) {
          return Response.json(
            {
              error: {
                code: "agent_mismatch",
                message: "This conversation belongs to a different agent.",
              },
            },
            { status: 409 },
          );
        }
        agentId = effectiveAgentId;
      }
    } else {
      agentId = requestedAgentId;
    }

    // Model selection: request -> default. Unknown ids are rejected loudly.
    const requestedModel = body.model ?? await defaultMobileModel() ?? DEFAULT_MODEL_ID;
    if (!(await primeMobileModel(requestedModel))) {
      return Response.json(
        { error: { code: "model_unavailable", message: `Model ${requestedModel} is not enabled for mobile. Enable a model in the provider dashboard.` } },
        { status: 400 },
      );
    }

    // Thread: the client generates the id, so a new chat needs no round trip.
    // If the thread does not exist yet, create it with that id.
    if (threadId && !knownThread) {
      const lastUser = [...body.messages].reverse().find((message) => message.role === "user");
      const created = await createThread(user.id, {
        id: threadId,
        title: titleFromParts((lastUser?.parts ?? []) as Record<string, unknown>[]),
        model: requestedModel,
        agentId,
      });
      threadId = created.id;
    }

    // Attachments are resolved to bytes before the model call.
    const attachments = await loadAttachments(user.id, body.attachments);
    const needsVision = attachments.some((a) => a.mediaType.startsWith("image/"));
    const needsPdf = attachments.some((a) => a.mediaType === "application/pdf");

    const required = {
      ...(needsVision ? { vision: true } : {}),
      ...(needsPdf ? { pdf: true } : {}),
    };

    // Model messages — window to the last MAX_CHAT_MESSAGES to cap input tokens.
    const MAX_CHAT_MESSAGES = 16;
    const windowedMessages = body.messages.length > MAX_CHAT_MESSAGES
      ? body.messages.slice(-MAX_CHAT_MESSAGES)
      : body.messages;
    const modelMessages = await convertToModelMessages(
      windowedMessages as unknown as Parameters<typeof convertToModelMessages>[0],
    );
    const messagesWithFiles = withAttachmentParts(modelMessages, attachments);

    if (!threadId) {
      const lastUser = [...body.messages].reverse().find((message) => message.role === "user");
      const thread = await createThread(user.id, {
        title: titleFromParts((lastUser?.parts ?? []) as Record<string, unknown>[]),
        model: requestedModel,
        agentId,
      });
      threadId = thread.id;
    }
    // Persist the user message (the last one in the request).
    const lastUserMessage = [...body.messages].reverse().find((message) => message.role === "user");
    if (lastUserMessage) {
      await insertMessage(
        user.id,
        threadId,
        "user",
        lastUserMessage.parts as Record<string, unknown>[],
        requestedModel,
      );
    }

    const modelIds = [requestedModel, ...DEFAULT_FALLBACK_ORDER.filter((id) => id !== requestedModel)];

    // Tools + system prompt. Notes/memories are only sent to models that are
    // allowed to see private context.
    const entry = findRegistryEntry(requestedModel);
    const canSeePrivate = entry?.privateOk ?? false;

    const tools = {
      ...buildKnowledgeTools({ userId: user.id, threadId }),
      ...buildWebTools(),
      // Progressive disclosure: only when this chat is bound to an agent.
      ...(agentId ? buildSkillTools({ userId: user.id, agentId }) : {}),
      // Routines (Phase 10): the model proposes a schedule, the app confirms it.
      ...buildRoutineTools({
        userId: user.id,
        threadId,
        agentId,
        timeZone: body.tz ?? DEFAULT_TIMEZONE,
      }),
    };

    const system = await buildSystemPrompt(
      user.id,
      canSeePrivate
        ? [...body.messages].reverse().find((message) => message.role === "user")?.parts
            .filter((part) => part.type === "text")
            .map((part) => String((part as { text?: unknown }).text ?? ""))
            .join(" ")
        : undefined,
      agentId,
      body.tz ?? DEFAULT_TIMEZONE,
    );

    const chatStream = await createChatStream({
      messages: messagesWithFiles,
      modelIds,
      userId: user.id,
      required,
      system,
      tools,
      maxSteps: 6,
    });

    const uiStream = createUIMessageStream({
      originalMessages: body.messages as unknown as UIMessage[],
      execute: async ({ writer }) => {
        const chunks = toUIMessageStream({
          stream: chatStream.stream,
          originalMessages: body.messages as unknown as UIMessage[],
          messageMetadata: () => ({
            model: chatStream.modelId,
            provider: chatStream.provider,
            threadId,
          }),
        });

        // Every routine proposal also emits a `data-routine-proposal` part,
        // so the app can render the confirmation card (the tool part alone
        // carries no affordance).
        const toolNames = new Map<string, string>();
        const withProposals = chunks.pipeThrough(
          new TransformStream<UIMessageChunk, UIMessageChunk>({
            transform(chunk, controller) {
              controller.enqueue(chunk);
              if (chunk.type === "tool-input-available" && chunk.toolName) {
                toolNames.set(chunk.toolCallId, chunk.toolName);
              }
              if (chunk.type === "tool-output-available") {
                if (toolNames.get(chunk.toolCallId) !== "create_routine") return;
                controller.enqueue({
                  type: "data-routine-proposal",
                  data: routineProposalPayload(chunk.toolCallId, chunk.output),
                } as UIMessageChunk);
              }
            },
          }),
        );

        writer.merge(withProposals);
      },
      onError: (error) =>
        error instanceof Error ? error.message : "The provider failed to answer.",
      onFinish: async ({ messages }) => {
        const assistant = [...messages].reverse().find((message) => message.role === "assistant");
        if (!assistant) return;

        await insertMessage(
          user.id,
          threadId!,
          "assistant",
          assistant.parts as unknown as Record<string, unknown>[],
          chatStream.modelId,
        );

        // Memory extraction runs in the background (Inngest), never in the request.
        try {
          await inngest.send(
            chatCompleted.create({
              threadId: threadId!,
              userId: user.id,
              messageId: assistant.id,
            }),
          );
        } catch (error) {
          console.warn("[chat] could not queue memory extraction:", error);
        }
      },
    });

    return createUIMessageStreamResponse({
      stream: uiStream,
    });
  } catch (error) {
    return toErrorResponse(error);
  }
}
