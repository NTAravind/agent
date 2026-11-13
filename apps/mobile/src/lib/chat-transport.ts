import { DefaultChatTransport, type ChatTransport, type UIMessage, type UIMessageChunk } from "ai";
import { fetch as expoFetch } from "expo/fetch";

import { API_BASE_URL } from "@/lib/api";

export type ChatTransportOptions = {
  threadId?: string | null;
  model?: string | null;
  /** Returns the current Supabase access token. */
  getToken: () => Promise<string | null>;
  /** Returns the attachments queued for the next message. */
  getAttachments?: () => { documentId: string; mediaType: string; name?: string }[];
};

function headersToObject(headers: HeadersInit | undefined): Record<string, string> {
  if (!headers) return {};
  if (typeof Headers !== "undefined" && headers instanceof Headers) {
    const out: Record<string, string> = {};
    headers.forEach((value, key) => {
      out[key] = value;
    });
    return out;
  }
  if (Array.isArray(headers)) return Object.fromEntries(headers);
  return headers as Record<string, string>;
}

/**
 * XHR-based streaming transport.
 *
 * Used as a fallback when expo/fetch cannot stream (the spec lists device
 * streaming as a known risk). Parses the server-sent events the API emits and
 * pushes them into a ReadableStream of UI message chunks.
 */
export class XhrChatTransport<UI_MESSAGE extends UIMessage> implements ChatTransport<UI_MESSAGE> {
  constructor(private readonly options: ChatTransportOptions) {}

  async sendMessages({
    messages,
    abortSignal,
    headers,
    body,
  }: {
    trigger: "submit-message" | "regenerate-message";
    chatId: string;
    messageId: string | undefined;
    messages: UI_MESSAGE[];
    abortSignal: AbortSignal | undefined;
  } & { headers?: HeadersInit; body?: object }): Promise<ReadableStream<UIMessageChunk>> {
    const token = await this.options.getToken();
    const requestHeaders: Record<string, string> = {
      "Content-Type": "application/json",
      Accept: "text/event-stream",
      ...headersToObject(headers),
      ...(token ? { Authorization: `Bearer ${token}` } : {}),
    };

    const payload = JSON.stringify({
      messages,
      threadId: this.options.threadId ?? undefined,
      model: this.options.model ?? undefined,
      attachments: this.options.getAttachments?.() ?? undefined,
      ...(body ?? {}),
    });

    return new Promise<ReadableStream<UIMessageChunk>>((resolve, reject) => {
      const xhr = new XMLHttpRequest();
      let offset = 0;
      let settled = false;

      const stream = new ReadableStream<UIMessageChunk>({
        start(controller) {
          const push = () => {
            const text = xhr.responseText ?? "";
            if (text.length <= offset) return;
            const chunk = text.slice(offset);
            offset = text.length;

            for (const line of chunk.split("\n")) {
              const trimmed = line.trim();
              if (!trimmed.startsWith("data:")) continue;
              const data = trimmed.slice(5).trim();
              if (!data || data === "[DONE]") continue;
              try {
                controller.enqueue(JSON.parse(data) as UIMessageChunk);
              } catch {
                // ignore malformed chunk
              }
            }
          };

          xhr.onreadystatechange = () => {
            if (xhr.readyState === 3) push();
            if (xhr.readyState === 4) {
              push();
              if (!settled) {
                settled = true;
                if (xhr.status >= 200 && xhr.status < 300) {
                  controller.close();
                } else {
                  controller.error(new Error(`Chat request failed (${xhr.status})`));
                }
              }
            }
          };

          xhr.onerror = () => {
            if (settled) return;
            settled = true;
            controller.error(new Error("Chat request failed (network)"));
          };

          xhr.onabort = () => {
            if (settled) return;
            settled = true;
            controller.error(new Error("Chat request aborted"));
          };
        },
        cancel() {
          xhr.abort();
        },
      });

      xhr.open("POST", `${API_BASE_URL}/api/chat`, true);
      for (const [key, value] of Object.entries(requestHeaders)) {
        xhr.setRequestHeader(key, value);
      }

      abortSignal?.addEventListener("abort", () => xhr.abort());

      xhr.send(payload);
      resolve(stream);
    });
  }

  async reconnectToStream(): Promise<ReadableStream<UIMessageChunk> | null> {
    return null;
  }
}

/**
 * Primary transport (expo/fetch streaming) with the XHR transport as a
 * fallback. The fallback only kicks in when the primary fails before any
 * chunk arrived.
 */
export class ResilientChatTransport<UI_MESSAGE extends UIMessage>
  implements ChatTransport<UI_MESSAGE>
{
  private readonly primary: DefaultChatTransport<UI_MESSAGE>;
  private readonly fallback: XhrChatTransport<UI_MESSAGE>;

  constructor(options: ChatTransportOptions) {
    this.primary = new DefaultChatTransport<UI_MESSAGE>({
      api: `${API_BASE_URL}/api/chat`,
      fetch: expoFetch as unknown as typeof globalThis.fetch,
      prepareSendMessagesRequest: async ({ messages }) => {
        const token = await options.getToken();
        return {
          body: {
            messages,
            threadId: options.threadId ?? undefined,
            model: options.model ?? undefined,
            attachments: options.getAttachments?.() ?? undefined,
          },
          headers: token ? ({ Authorization: `Bearer ${token}` } as Record<string, string>) : {},
        };
      },
    });

    this.fallback = new XhrChatTransport<UI_MESSAGE>(options);
  }

  async sendMessages(
    options: Parameters<ChatTransport<UI_MESSAGE>["sendMessages"]>[0],
  ): Promise<ReadableStream<UIMessageChunk>> {
    try {
      const stream = await this.primary.sendMessages(options);
      // If the primary transport fails before the first chunk, fall back.
      const reader = stream.getReader();
      const first = await reader.read();

      if (first.done || first.value?.type === "error") {
        void reader.cancel().catch(() => {});
        return this.fallback.sendMessages(options);
      }

      return new ReadableStream<UIMessageChunk>({
        start(controller) {
          if (first.value) controller.enqueue(first.value);
        },
        async pull(controller) {
          const { done, value } = await reader.read();
          if (done) {
            controller.close();
            return;
          }
          if (value) controller.enqueue(value);
        },
        cancel(reason) {
          void reader.cancel(reason);
        },
      });
    } catch (error) {
      console.warn("[chat] primary transport failed, using XHR fallback:", error);
      return this.fallback.sendMessages(options);
    }
  }

  async reconnectToStream(
    options: Parameters<ChatTransport<UI_MESSAGE>["reconnectToStream"]>[0],
  ): Promise<ReadableStream<UIMessageChunk> | null> {
    return this.primary.reconnectToStream(options);
  }
}
