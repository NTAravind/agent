import { z } from "zod";

/**
 * Knowledge-layer contracts: notes, memories, web search and the tools the
 * agent can call. Kept in the shared package so the API and the phone agree
 * on shapes (the phone never imports provider SDKs).
 */

export const WebSearchResultSchema = z.object({
  title: z.string(),
  url: z.string(),
  snippet: z.string(),
  score: z.number().optional(),
});

export type WebSearchResult = z.infer<typeof WebSearchResultSchema>;

export const WebSearchResponseSchema = z.object({
  query: z.string(),
  answer: z.string().nullable(),
  results: z.array(WebSearchResultSchema),
});

export type WebSearchResponse = z.infer<typeof WebSearchResponseSchema>;

export const FetchPageResultSchema = z.object({
  url: z.string(),
  title: z.string().nullable(),
  content: z.string(),
  truncated: z.boolean(),
});

export type FetchPageResult = z.infer<typeof FetchPageResultSchema>;

export const CitationSchema = z.object({
  n: z.number(),
  title: z.string(),
  url: z.string(),
});

export type Citation = z.infer<typeof CitationSchema>;
