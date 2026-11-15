import { createHash } from "node:crypto";

export type ParsedNote = {
  frontmatter: Record<string, unknown> | null;
  /** Note body without the frontmatter block. */
  body: string;
  title: string | null;
  /** [[wikilink]] targets, without the alias part. */
  links: string[];
  chunks: NoteChunk[];
};

export type NoteChunk = {
  idx: number;
  heading: string | null;
  content: string;
};

/**
 * Parses a small YAML-ish frontmatter block (key: value pairs, lists with
 * "- " items). Enough for Obsidian notes without pulling in a YAML parser.
 */
export function parseFrontmatter(source: string): {
  frontmatter: Record<string, unknown> | null;
  body: string;
} {
  if (!source.startsWith("---")) {
    return { frontmatter: null, body: source };
  }

  const end = source.indexOf("\n---", 3);
  if (end === -1) return { frontmatter: null, body: source };

  const raw = source.slice(3, end).trim();
  const body = source.slice(end + 4).replace(/^\r?\n/, "");
  const frontmatter: Record<string, unknown> = {};

  let currentKey: string | null = null;
  for (const line of raw.split("\n")) {
    if (!line.trim()) continue;

    if (/^\s*-\s+/.test(line) && currentKey) {
      const list = (frontmatter[currentKey] as unknown[] | undefined) ?? [];
      list.push(unquote(line.replace(/^\s*-\s+/, "")));
      frontmatter[currentKey] = list;
      continue;
    }

    const match = /^([^:]+):\s*(.*)$/.exec(line);
    if (!match) continue;

    const key = match[1]!.trim();
    const value = match[2]!.trim();
    currentKey = key;
    frontmatter[key] = value === "" ? "" : unquote(value);
  }

  return { frontmatter: Object.keys(frontmatter).length > 0 ? frontmatter : null, body };
}

function unquote(value: string): string {
  if (
    (value.startsWith('"') && value.endsWith('"')) ||
    (value.startsWith("'") && value.endsWith("'"))
  ) {
    return value.slice(1, -1);
  }
  return value;
}

/** Extracts [[wikilinks]] and [[wikilinks|aliases]]. */
export function extractWikilinks(source: string): string[] {
  const links: string[] = [];
  const pattern = /\[\[([^\]|#]+)(?:[#|][^\]]*)?\]\]/g;

  for (const match of source.matchAll(pattern)) {
    const target = match[1]?.trim();
    if (target) links.push(target);
  }

  return [...new Set(links)];
}

/** Splits a note into chunks, one per heading (or a single chunk). */
export function chunkByHeading(body: string, maxChars = 1800): NoteChunk[] {
  const lines = body.split("\n");
  const chunks: NoteChunk[] = [];

  let heading: string | null = null;
  let buffer: string[] = [];

  const flush = () => {
    const content = buffer.join("\n").trim();
    if (content) {
      chunks.push({ idx: chunks.length, heading, content });
    }
    buffer = [];
  };

  for (const line of lines) {
    const match = /^(#{1,6})\s+(.*)$/.exec(line);
    if (match) {
      flush();
      heading = match[2]!.trim();
      buffer.push(line);
      continue;
    }
    buffer.push(line);
  }
  flush();

  // Split oversized chunks so a single embedding stays in range.
  const result: NoteChunk[] = [];
  for (const chunk of chunks) {
    if (chunk.content.length <= maxChars) {
      result.push({ ...chunk, idx: result.length });
      continue;
    }

    const paragraphs = chunk.content.split(/\n{2,}/);
    let current = "";
    for (const paragraph of paragraphs) {
      if (current && current.length + paragraph.length > maxChars) {
        result.push({ idx: result.length, heading: chunk.heading, content: current.trim() });
        current = "";
      }
      current += `${paragraph}\n\n`;
    }
    if (current.trim()) {
      result.push({ idx: result.length, heading: chunk.heading, content: current.trim() });
    }
  }

  return result;
}

/** Parses a whole note file. */
export function parseNote(source: string): ParsedNote {
  const { frontmatter, body } = parseFrontmatter(source);
  const links = extractWikilinks(body);
  const chunks = chunkByHeading(body);
  const title =
    (typeof frontmatter?.title === "string" ? frontmatter.title : undefined) ??
    (/^#\s+(.+)$/m.exec(body)?.[1]?.trim() ?? null);

  return { frontmatter, body, title, links, chunks };
}

/** Stable content hash, used to skip unchanged notes. */
export function contentHash(content: string): string {
  return createHash("sha256").update(content).digest("hex");
}
