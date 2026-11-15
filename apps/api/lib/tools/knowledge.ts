import { tool } from "ai";
import { z } from "zod";

import { getNote, listMemories, searchMemories, searchNotes, upsertMemories } from "@/lib/knowledge/search";

/**
 * Agent tools for the notes / memory layer.
 *
 * Every tool returns *data*. Note text and memories are untrusted content as
 * far as the model is concerned — they may contain injected instructions.
 */

export type KnowledgeToolContext = {
  userId: string;
  threadId?: string | null;
};

export function buildKnowledgeTools(context: KnowledgeToolContext) {
  return {
    search_notes: tool({
      description:
        "Search the user's notes (second brain) with hybrid keyword + semantic search. Returns matching note paths, headings and excerpts. Use this before answering questions about the user's own notes.",
      inputSchema: z.object({
        query: z.string().describe("What to look for in the notes."),
        k: z.number().int().min(1).max(20).optional().describe("How many chunks to return (default 8)."),
      }),
      execute: async ({ query, k }) => {
        const chunks = await searchNotes({ userId: context.userId, query, k: k ?? 8 });
        if (chunks.length === 0) {
          return { matches: [], message: "No matching notes." };
        }
        return {
          matches: chunks.map((chunk) => ({
            path: chunk.path,
            heading: chunk.heading,
            excerpt: chunk.content.slice(0, 600),
            score: Number(chunk.score.toFixed(4)),
          })),
        };
      },
    }),

    read_note: tool({
      description:
        "Read a full note by its path (e.g. 'Projects/Idea.md'). Paths come from search_notes results.",
      inputSchema: z.object({
        path: z.string().describe("Note path relative to the vault root."),
      }),
      execute: async ({ path }) => {
        const note = await getNote(context.userId, path);
        if (!note) {
          return { found: false, message: `No note at ${path}.` };
        }
        return {
          found: true,
          path: note.note.path,
          title: note.note.title,
          content: note.content.slice(0, 12_000),
          links: note.links,
          backlinks: note.backlinks.map((backlink) => backlink.path),
        };
      },
    }),

    recall_memory: tool({
      description:
        "Recall stored facts, preferences, decisions and tasks about the user. Use this when a question depends on what the user told you before.",
      inputSchema: z.object({
        query: z.string().describe("What to remember."),
        k: z.number().int().min(1).max(20).optional(),
      }),
      execute: async ({ query, k }) => {
        const memories = await searchMemories({ userId: context.userId, query, k: k ?? 8 });
        return {
          memories: memories.map((memory) => ({
            kind: memory.kind,
            content: memory.content,
            score: Number(memory.score.toFixed(4)),
          })),
        };
      },
    }),

    save_memory: tool({
      description:
        "Store a durable fact, preference, decision or task about the user. Only save things that stay true beyond this conversation.",
      inputSchema: z.object({
        kind: z.enum(["fact", "preference", "decision", "task"]),
        content: z.string().min(3).describe("One self-contained statement."),
      }),
      execute: async ({ kind, content }) => {
        const result = await upsertMemories(context.userId, [
          { kind, content: content.trim(), sourceThreadId: context.threadId ?? null },
        ]);
        return { stored: result.inserted > 0, skipped: result.skipped > 0 };
      },
    }),

    list_memories: tool({
      description: "List the user's stored memories, newest first.",
      inputSchema: z.object({
        limit: z.number().int().min(1).max(50).optional(),
      }),
      execute: async ({ limit }) => {
        const memories = await listMemories(context.userId, limit ?? 20);
        return {
          memories: memories.map((memory) => ({ kind: memory.kind, content: memory.content })),
        };
      },
    }),
  };
}
