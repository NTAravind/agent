/**
 * Redacts credential material from anything that might be logged or returned
 * in an error (Phase 6 plan §5.6): tool arguments, transport errors, OAuth
 * redirects, Inngest payloads.
 *
 * Defense in depth: we also never put credentials into logs in the first
 * place — this catches the accidental paths (error.message containing a
 * header, an args object echoing a token the model saw).
 */

const PATTERNS: Array<[RegExp, string]> = [
  // Authorization headers of any scheme.
  [/\b(authorization|proxy-authorization)\s*[:=]\s*["']?([^\s"',;]+)/gi, "$1: [redacted]"],
  // Bearer tokens (JWTs and opaque).
  [/\b(bearer)\s+[A-Za-z0-9._~+/=-]{8,}/gi, "$1 [redacted]"],
  // Common API key shapes.
  [/\b(sk-[A-Za-z0-9_-]{8,})/g, "[redacted]"],
  [/\b(sk-or-v1-[A-Za-z0-9_-]{8,})/g, "[redacted]"],
  [/\b(xox[baprs]-[A-Za-z0-9-]{8,})/g, "[redacted]"],
  [/\b(gh[pousr]_[A-Za-z0-9]{8,})/g, "[redacted]"],
  [/\b(tsk_[A-Za-z0-9]{8,})/g, "[redacted]"],
  // JWTs anywhere.
  [/\b(ey[A-Za-z0-9_-]{10,}\.[A-Za-z0-9_-]{10,}\.[A-Za-z0-9_-]{5,})/g, "[redacted-jwt]"],
  // query-string credentials.
  [/\b(api[_-]?key|access[_-]?token|refresh[_-]?token|client[_-]?secret|code_verifier|password)=([^&\s"']+)/gi, "$1=[redacted]"],
];

/** Returns `text` with anything credential-shaped replaced. */
export function redactSecrets(text: string): string {
  let out = text;
  for (const [pattern, replacement] of PATTERNS) {
    out = out.replace(pattern, replacement);
  }
  return out;
}

/** Deep-redacts every string in a JSON-ish value (safe for logging payloads). */
export function redactDeep<T>(value: T): T {
  if (typeof value === "string") return redactSecrets(value) as unknown as T;
  if (Array.isArray(value)) return value.map((item) => redactDeep(item)) as unknown as T;
  if (value && typeof value === "object") {
    const out: Record<string, unknown> = {};
    for (const [key, val] of Object.entries(value)) {
      out[key] = redactDeep(val);
    }
    return out as T;
  }
  return value;
}
