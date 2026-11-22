import type { FetchPageResult, WebSearchResponse, WebSearchResult } from "@agent/shared";

import { optionalEnv } from "@/lib/env";
import { measurePerf } from "@/lib/perf";

const TAVILY_ENDPOINT = "https://api.tavily.com/search";
const MAX_PAGE_CHARS = 6_000;

/**
 * Web search via Tavily (1,000 free credits/month, no card — verified
 * 2026-11-14). Brave was the alternative but it requires a credit card.
 */
export function isWebSearchConfigured(): boolean {
  return Boolean(optionalEnv("TAVILY_API_KEY"));
}

export async function webSearch(query: string, maxResults = 5): Promise<WebSearchResponse> {
  const apiKey = optionalEnv("TAVILY_API_KEY");
  if (!apiKey) {
    throw new Error(
      "Web search is not configured. Set TAVILY_API_KEY (free tier: https://app.tavily.com).",
    );
  }

  const response = await measurePerf(
    "web_tool",
    "web_search",
    () =>
      fetch(TAVILY_ENDPOINT, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          api_key: apiKey,
          query,
          search_depth: "basic",
          max_results: maxResults,
          include_answer: true,
          include_raw_content: false,
        }),
      }),
    { provider: "tavily" },
  );

  if (!response.ok) {
    const body = await response.text();
    throw new Error(`Tavily search failed (${response.status}): ${body.slice(0, 200)}`);
  }

  const payload = (await response.json()) as {
    answer?: string;
    results?: Array<{ title?: string; url?: string; content?: string; score?: number }>;
  };

  const results: WebSearchResult[] = (payload.results ?? [])
    .filter((result) => typeof result.url === "string")
    .map((result) => ({
      title: result.title ?? result.url!,
      url: result.url!,
      snippet: (result.content ?? "").slice(0, 800),
      score: result.score,
    }));

  return {
    query,
    answer: payload.answer ?? null,
    results,
  };
}

/**
 * Fetches a page and extracts readable text.
 *
 * Everything fetched here is untrusted content: a page can contain prompt
 * injection. The caller must treat it as data, never as instructions.
 */
export async function fetchPage(url: string): Promise<FetchPageResult> {
  let parsed: URL;
  try {
    parsed = new URL(url);
  } catch {
    throw new Error(`Not a valid URL: ${url}`);
  }

  if (parsed.protocol !== "http:" && parsed.protocol !== "https:") {
    throw new Error("Only http and https URLs can be fetched.");
  }

  const response = await measurePerf(
    "web_tool",
    "fetch_page",
    () =>
      fetch(parsed.toString(), {
        redirect: "follow",
        headers: {
          "User-Agent": "agent-app/1.0 (+https://github.com/NTAravind/agent)",
          Accept: "text/html,text/plain,application/json;q=0.9,*/*;q=0.5",
        },
        signal: AbortSignal.timeout(15_000),
      }),
    { provider: "http", metadata: { protocol: parsed.protocol } },
  );

  if (!response.ok) {
    throw new Error(`Could not fetch ${url} (${response.status}).`);
  }

  const contentType = response.headers.get("content-type") ?? "";
  const raw = await response.text();

  const title = /<title[^>]*>([^<]*)<\/title>/i.exec(raw)?.[1]?.trim() ?? null;
  const text = contentType.includes("html") ? stripHtml(raw) : raw;
  const trimmed = text.replace(/\n{3,}/g, "\n\n").trim();

  return {
    url: parsed.toString(),
    title,
    content: trimmed.slice(0, MAX_PAGE_CHARS),
    truncated: trimmed.length > MAX_PAGE_CHARS,
  };
}

/** Removes scripts, styles and tags, keeping the readable text. */
function stripHtml(html: string): string {
  return html
    .replace(/<script[\s\S]*?<\/script>/gi, " ")
    .replace(/<style[\s\S]*?<\/style>/gi, " ")
    .replace(/<noscript[\s\S]*?<\/noscript>/gi, " ")
    .replace(/<!--[\s\S]*?-->/g, " ")
    .replace(/<\/(p|div|section|article|li|tr|h[1-6])>/gi, "\n")
    .replace(/<br\s*\/?>/gi, "\n")
    .replace(/<[^>]+>/g, " ")
    .replace(/&nbsp;/g, " ")
    .replace(/&amp;/g, "&")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'")
    .replace(/[ \t]{2,}/g, " ")
    .replace(/\n{3,}/g, "\n\n")
    .trim();
}
