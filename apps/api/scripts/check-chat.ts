/**
 * Live check for the chat stream (Phase 1).
 *
 *   npx tsx --env-file=.env.local scripts/check-chat.ts
 *
 * Streams a real completion through the fallback chain and prints the parts.
 * Does not touch the database (the API route does that).
 */
import { createChatStream } from "../lib/chat/stream";
import { DEFAULT_FALLBACK_ORDER, DEFAULT_MODEL_ID } from "../lib/models";

async function main() {
  const models = [DEFAULT_MODEL_ID, ...DEFAULT_FALLBACK_ORDER];

  const chat = await createChatStream({
    messages: [{ role: "user", content: "Reply with exactly: ok" }],
    modelIds: models,
    userId: process.env.ALLOWED_USER_ID ?? "00000000-0000-0000-0000-000000000000",
  });

  console.log("model:", chat.modelId, "provider:", chat.provider);
  console.log("attempts:", JSON.stringify(chat.attempts));

  const reader = chat.stream.getReader();
  let text = "";
  let parts = 0;

  while (true) {
    const { done, value } = await reader.read();
    if (done) break;
    parts += 1;
    if (value.type === "text-delta") text += value.text ?? "";
    if (value.type === "error") {
      console.log("stream error part:", String(value.error));
      break;
    }
  }

  console.log("parts:", parts);
  console.log("reply:", JSON.stringify(text.trim()));
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
