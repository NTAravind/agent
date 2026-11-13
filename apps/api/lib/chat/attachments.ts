import type { AttachmentRef } from "@agent/shared";
import { isSupportedAttachmentType } from "@agent/shared";
import type { FilePart } from "ai";

import { supabaseAdmin } from "@/lib/supabase/server";

const BUCKET = "attachments";

export type LoadedAttachment = {
  id: string;
  mediaType: string;
  name: string;
  /** Model file part (bytes inline). */
  part: FilePart;
  /** True when the model cannot handle this file type. */
  unsupported: boolean;
};

/**
 * Resolves attachment ids to bytes from Storage.
 *
 * Only the id crosses the wire — the client never sends a path, so it cannot
 * read another user's files. Rows are filtered by user_id explicitly.
 */
export async function loadAttachments(
  userId: string,
  refs: AttachmentRef[] | undefined,
): Promise<LoadedAttachment[]> {
  if (!refs || refs.length === 0) return [];

  const { data, error } = await supabaseAdmin()
    .from("documents")
    .select("id, storage_path, mime, name")
    .eq("user_id", userId)
    .in("id", refs.map((ref) => ref.id));

  if (error) {
    console.warn("[chat] could not read attachments:", error.message);
    return [];
  }

  const documents = (data ?? []) as Array<{
    id: string;
    storage_path: string;
    mime: string | null;
    name: string | null;
  }>;

  const loaded: LoadedAttachment[] = [];

  for (const document of documents) {
    const mediaType = document.mime ?? "application/octet-stream";
    const name = document.name ?? document.storage_path.split("/").pop() ?? "file";

    if (!isSupportedAttachmentType(mediaType)) {
      loaded.push({
        id: document.id,
        mediaType,
        name,
        part: { type: "file", mediaType, data: new Uint8Array(), filename: name },
        unsupported: true,
      });
      continue;
    }

    const { data: blob, error: downloadError } = await supabaseAdmin()
      .storage.from(BUCKET)
      .download(document.storage_path);

    if (downloadError || !blob) {
      console.warn(`[chat] could not download ${document.storage_path}:`, downloadError?.message);
      continue;
    }

    const bytes = new Uint8Array(await blob.arrayBuffer());

    loaded.push({
      id: document.id,
      mediaType,
      name,
      part: { type: "file", mediaType, data: bytes, filename: name },
      unsupported: false,
    });
  }

  return loaded;
}

/**
 * Appends the attachment parts to the last user message so the model sees them.
 */
export function withAttachmentParts<T extends { role: string; content: unknown }>(
  messages: T[],
  attachments: LoadedAttachment[],
): T[] {
  if (attachments.length === 0) return messages;

  const parts = attachments.filter((a) => !a.unsupported).map((a) => a.part);
  if (parts.length === 0) return messages;

  const lastIndex = messages.findLastIndex((message) => message.role === "user");
  if (lastIndex === -1) return messages;

  const last = messages[lastIndex]!;
  const content = Array.isArray(last.content)
    ? [...(last.content as unknown[])]
    : [{ type: "text", text: typeof last.content === "string" ? last.content : "" }];

  messages = [...messages];
  messages[lastIndex] = { ...last, content: [...content, ...parts] } as T;
  return messages;
}
