import { z } from "zod";

/**
 * Chat contracts shared by the API and the mobile app so they cannot drift.
 * The message shape mirrors the AI SDK's UIMessage, but stays dependency-free
 * (the shared package must not pull the AI SDK into the phone bundle).
 */

export const ChatRoleSchema = z.enum(["user", "assistant", "system", "tool"]);

export const ChatMessagePartSchema = z.looseObject({
  type: z.string(),
});

export const ChatMessageSchema = z.object({
  id: z.string(),
  role: ChatRoleSchema,
  parts: z.array(ChatMessagePartSchema),
});

export type ChatMessage = z.infer<typeof ChatMessageSchema>;

/** A file the user attached to a message (stored in Supabase Storage). */
export const AttachmentRefSchema = z.object({
  id: z.string().uuid(),
  mediaType: z.string(),
  name: z.string().optional(),
});

export type AttachmentRef = z.infer<typeof AttachmentRefSchema>;

export const ChatRequestSchema = z.object({
  /** Existing thread; omit to start a new one. */
  threadId: z.string().uuid().optional(),
  messages: z.array(ChatMessageSchema).min(1),
  /** Registry id, e.g. "google:gemini-3.6-flash". Defaults to the server default. */
  model: z.string().optional(),
  attachments: z.array(AttachmentRefSchema).optional(),
});

export type ChatRequest = z.infer<typeof ChatRequestSchema>;

export const ThreadSchema = z.object({
  id: z.string().uuid(),
  title: z.string().nullable(),
  model: z.string().nullable(),
  created_at: z.string(),
  updated_at: z.string(),
});

export type Thread = z.infer<typeof ThreadSchema>;

export const StoredMessageSchema = z.object({
  id: z.string().uuid(),
  thread_id: z.string().uuid(),
  role: ChatRoleSchema,
  model: z.string().nullable(),
  parts: z.array(ChatMessagePartSchema),
  created_at: z.string(),
});

export type StoredMessage = z.infer<typeof StoredMessageSchema>;

export const ThreadWithMessagesSchema = z.object({
  thread: ThreadSchema,
  messages: z.array(StoredMessageSchema),
});

export type ThreadWithMessages = z.infer<typeof ThreadWithMessagesSchema>;

/** Media types the app can send to a model. */
export const SUPPORTED_ATTACHMENT_TYPES = [
  "image/png",
  "image/jpeg",
  "image/webp",
  "image/gif",
  "application/pdf",
  "text/plain",
  "text/markdown",
] as const;

export type SupportedAttachmentType = (typeof SUPPORTED_ATTACHMENT_TYPES)[number];

export function isSupportedAttachmentType(mediaType: string): mediaType is SupportedAttachmentType {
  return (SUPPORTED_ATTACHMENT_TYPES as readonly string[]).includes(mediaType);
}

/** Uploads the app may request. */
export const UploadRequestSchema = z.object({
  fileName: z.string().min(1).max(200),
  mediaType: z.string().min(1),
  sizeBytes: z.number().int().nonnegative().max(20 * 1024 * 1024),
});

export type UploadRequest = z.infer<typeof UploadRequestSchema>;

export const UploadResponseSchema = z.object({
  documentId: z.string().uuid(),
  storagePath: z.string(),
  signedUrl: z.string(),
  token: z.string(),
});

export type UploadResponse = z.infer<typeof UploadResponseSchema>;
