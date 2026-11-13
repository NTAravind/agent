import {
  convertToModelMessages,
  createUIMessageStream,
  createUIMessageStreamResponse,
  toUIMessageStream,
  type UIMessage,
} from "ai";
import { ChatRequestSchema } from "@agent/shared";

import { requireUser, toErrorResponse } from "@/lib/auth";
import { loadAttachments, withAttachmentParts } from "@/lib/chat/attachments";
import {
  createThread,
  getThread,
  insertMessage,
  titleFromParts,
} from "@/lib/chat/persist";
import { createChatStream } from "@/lib/chat/stream";
import { DEFAULT_FALLBACK_ORDER, DEFAULT_MODEL_ID, findRegistryEntry } from "@/lib/models";

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
    const requestedModel = body.model ?? DEFAULT_MODEL_ID;
    if (!findRegistryEntry(requestedModel)) {
      return Response.json(
        { error: { code: "bad_request", message: `Unknown model: ${requestedModel}` } },
        { status: 400 },
      );
    }

    // Thread: the client generates the id, so a new chat needs no round trip.
    // If the thread does not exist yet, create it with that id.
    let threadId = body.threadId ?? null;
    if (threadId) {
      const thread = await getThread(user.id, threadId);
      if (!thread) {
        const lastUser = [...body.messages].reverse().find((message) => message.role === "user");
        const created = await createThread(user.id, {
          id: threadId,
          title: titleFromParts((lastUser?.parts ?? []) as Record<string, unknown>[]),
          model: requestedModel,
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

    const chatStream = await createChatStream({
      messages: messagesWithFiles,
      modelIds,
      userId: user.id,
      required,
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
      },
    });

    return createUIMessageStreamResponse({
      stream: uiStream,
    });
  } catch (error) {
    return toErrorResponse(error);
  }
}
