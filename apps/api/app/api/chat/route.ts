import {
  convertToModelMessages,
  createUIMessageStream,
  createUIMessageStreamResponse,
  toUIMessageStream,
  type UIMessage,
} from "ai";
import { ChatRequestSchema } from "@agent/shared";

import { ownedAgentId } from "@/lib/agents";
import { requireUser, toErrorResponse } from "@/lib/auth";
import { loadAttachments, withAttachmentParts } from "@/lib/chat/attachments";
import {
  createThread,
  getThread,
  insertMessage,
  titleFromParts,
} from "@/lib/chat/persist";
import { createChatStream } from "@/lib/chat/stream";
import { buildSystemPrompt } from "@/lib/chat/system-prompt";
import { inngest } from "@/lib/inngest/client";
import { chatCompleted } from "@/lib/inngest/events";
import { buildKnowledgeTools } from "@/lib/tools/knowledge";
import { buildWebTools } from "@/lib/tools/web-tools";
import { DEFAULT_FALLBACK_ORDER, DEFAULT_MODEL_ID, findRegistryEntry } from "@/lib/models";
import { defaultMobileModel, primeMobileModel } from "@/lib/models/catalog";

export const maxDuration = 300;

/**
 * POST /api/chat — streams a chat completion.
 *
 * Body: { threadId?, messages, model?, attachments? }
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
    const agentId = body.agentId ? await ownedAgentId(user.id, body.agentId) : null;
    let threadId = body.threadId ?? null;
    if (threadId) {
      const thread = await getThread(user.id, threadId);
      if (!thread) {
        const lastUser = [...body.messages].reverse().find((message) => message.role === "user");
        const created = await createThread(user.id, {
          id: threadId,
          title: titleFromParts((lastUser?.parts ?? []) as Record<string, unknown>[]),
          model: requestedModel,
          agentId,
        });
        threadId = created.id;
      }
    }

    // Attachments are resolved to bytes before the model call.
    const attachments = await loadAttachments(user.id, body.attachments);
    const needsVision = attachments.some((a) => a.mediaType.startsWith("image/"));
    const needsPdf = attachments.some((a) => a.mediaType === "application/pdf");

    const required = {
      ...(needsVision ? { vision: true } : {}),
      ...(needsPdf ? { pdf: true } : {}),
    };

    // Model messages.
    const modelMessages = await convertToModelMessages(
      body.messages as unknown as Parameters<typeof convertToModelMessages>[0],
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
    };

    const system = await buildSystemPrompt(
      user.id,
      canSeePrivate
        ? [...body.messages].reverse().find((message) => message.role === "user")?.parts
            .filter((part) => part.type === "text")
            .map((part) => String((part as { text?: unknown }).text ?? ""))
            .join(" ")
        : undefined,
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
        writer.merge(
          toUIMessageStream({
            stream: chatStream.stream,
            originalMessages: body.messages as unknown as UIMessage[],
            messageMetadata: () => ({
              model: chatStream.modelId,
              provider: chatStream.provider,
              threadId,
            }),
          }),
        );
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
