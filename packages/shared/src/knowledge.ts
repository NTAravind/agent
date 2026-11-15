import { z } from "zod";

/** Notes (the second brain) — mirrors db/migrations/0003_notes.sql. */

export const NoteSchema = z.object({
  id: z.string().uuid(),
  path: z.string(),
  title: z.string().nullable(),
  frontmatter: z.record(z.string(), z.unknown()).nullable(),
  content_hash: z.string(),
  updated_at: z.string(),
});

export type Note = z.infer<typeof NoteSchema>;

export const NoteChunkSchema = z.object({
  chunk_id: z.string().uuid(),
  note_id: z.string().uuid(),
  path: z.string(),
  heading: z.string().nullable(),
  content: z.string(),
  score: z.number(),
});

export type NoteChunk = z.infer<typeof NoteChunkSchema>;

export const NoteWithContentSchema = z.object({
  note: NoteSchema,
  content: z.string(),
  links: z.array(z.string()),
  backlinks: z.array(z.object({ path: z.string(), title: z.string().nullable() })),
});

export type NoteWithContent = z.infer<typeof NoteWithContentSchema>;

export const MemoryKindSchema = z.enum(["fact", "preference", "decision", "task"]);

export const MemorySchema = z.object({
  id: z.string().uuid(),
  kind: MemoryKindSchema,
  content: z.string(),
  source_thread_id: z.string().uuid().nullable(),
  created_at: z.string(),
});

export type Memory = z.infer<typeof MemorySchema>;

export const VaultStatusSchema = z.object({
  repo: z.string(),
  configured: z.boolean(),
  notes: z.number(),
  chunks: z.number(),
  lastSyncAt: z.string().nullable(),
});

export type VaultStatus = z.infer<typeof VaultStatusSchema>;
