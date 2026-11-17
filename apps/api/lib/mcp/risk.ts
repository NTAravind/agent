/**
 * Tool risk classification for MCP tools (Phase 6 plan 5.5 / API_SPEC 5).
 *
 * Spec rule: MCP tools default to approval-required. Classification can only
 * *lower* that for clearly read-only tools; it can never mark a destructive
 * tool as safe. We inspect (in order):
 *   1. MCP tool annotations (readOnlyHint / destructiveHint) when present.
 *   2. The tool name + description for write/destructive/read verbs.
 *
 * Remote descriptions are untrusted text - they are scanned, never obeyed,
 * and capped so a hostile server can't bloat the model's context.
 */

export type ToolRisk = {
  riskLevel: "low" | "medium" | "high";
  approvalRequired: boolean;
};

const DESTRUCTIVE_WORDS =
  /\b(delete|remove|destroy|drop|purge|revoke|ban|terminate|kill|shutdown|truncate|wipe|erase|invalidate)\b/i;
const WRITE_WORDS =
  /\b(create|update|write|post|send|publish|move|rename|share|invite|upload|insert|patch|upsert|execute|run|pay|purchase|order|submit|approve|reject|cancel|schedule|trigger|call|invoke|deploy|migrate|grant|moderate)\b/i;
const READ_WORDS =
  /\b(get|list|search|read|fetch|find|query|lookup|resolve|view|head|count|summarize|describe|check|status|inspect|preview|diff|compare|explain)\b/i;

/** Hard caps so an untrusted server can't flood the model context. */
export const MAX_TOOL_DESCRIPTION_CHARS = 1_000;
export const MAX_TOOL_SCHEMA_BYTES = 16_384;

export type ToolAnnotations = {
  readOnlyHint?: boolean;
  destructiveHint?: boolean;
  idempotentHint?: boolean;
  openWorldHint?: boolean;
  title?: string;
};

/**
 * Classifies one MCP tool. `name` and `description` come from the remote
 * server and are treated as untrusted input.
 */
export function classifyToolRisk(input: {
  name: string;
  description: string;
  annotations?: ToolAnnotations | null;
}): ToolRisk {
  const annotations = input.annotations;
  const haystack = `${input.name} ${input.description}`;

  if (annotations?.destructiveHint === true) {
    return { riskLevel: "high", approvalRequired: true };
  }
  if (annotations?.readOnlyHint === true) {
    // An explicit read-only claim still gets a sanity check against verbs -
    // a mislabeled "delete_all" should not slip through as low risk.
    if (DESTRUCTIVE_WORDS.test(haystack)) {
      return { riskLevel: "high", approvalRequired: true };
    }
    if (WRITE_WORDS.test(haystack)) {
      return { riskLevel: "medium", approvalRequired: true };
    }
    return { riskLevel: "low", approvalRequired: false };
  }

  if (DESTRUCTIVE_WORDS.test(haystack)) {
    return { riskLevel: "high", approvalRequired: true };
  }
  if (WRITE_WORDS.test(haystack)) {
    return { riskLevel: "medium", approvalRequired: true };
  }
  if (READ_WORDS.test(haystack)) {
    return { riskLevel: "low", approvalRequired: false };
  }
  // Unknown -> spec default for MCP tools: approval required.
  return { riskLevel: "medium", approvalRequired: true };
}

/** Strips control chars and caps an untrusted description. */
export function sanitizeDescription(raw: unknown): string {
  const text = typeof raw === "string" ? raw : "";
  const cleaned = text
    .replace(/[\x00-\x1f\x7f]/g, " ")
    .replace(/\s+/g, " ")
    .trim();
  if (cleaned.length <= MAX_TOOL_DESCRIPTION_CHARS) return cleaned;
  return `${cleaned.slice(0, MAX_TOOL_DESCRIPTION_CHARS - 1)}...`;
}
