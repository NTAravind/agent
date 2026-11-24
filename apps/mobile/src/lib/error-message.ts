import { ApiRequestError } from '@/lib/api';

export type FriendlyError = {
  title: string;
  message: string;
  details?: string;
};

const SECRET_PATTERNS = [
  /Bearer\s+[A-Za-z0-9._~+/-]+=*/gi,
  /(?:api[_-]?key|access[_-]?token|refresh[_-]?token|password|secret)\s*[:=]\s*[^\s,;]+/gi,
  /sk-[A-Za-z0-9_-]{12,}/g,
  /\b(?:ak_|ck_|ghp_|github_pat_|AIza)[A-Za-z0-9_-]{16,}\b/g,
  /\beyJ[A-Za-z0-9_-]{10,}\.[A-Za-z0-9_-]{10,}\.[A-Za-z0-9_-]{10,}\b/g,
];

function safeDetails(value: string): string {
  return SECRET_PATTERNS.reduce((text, pattern) => text.replace(pattern, '[hidden]'), value)
    .replace(/<[^>]*>/g, ' ')
    .replace(/\s+/g, ' ')
    .trim()
    .slice(0, 500);
}

function getStatus(error: unknown): number | undefined {
  if (error instanceof ApiRequestError) return error.status;
  if (error && typeof error === 'object') {
    const candidate = error as { status?: unknown; statusCode?: unknown };
    const status = candidate.statusCode ?? candidate.status;
    if (typeof status === 'number') return status;
  }
  return undefined;
}

export function describeError(error: unknown, fallbackTitle = 'Something went wrong'): FriendlyError {
  const raw = error instanceof ApiRequestError
    ? error.rawMessage
    : error instanceof Error
      ? error.message
      : String(error ?? '');
  const embeddedStatus = raw.match(/\b(503|502|504|429|408|401|403|404|409)\b/)?.[1];
  const status = getStatus(error) ?? (embeddedStatus ? Number(embeddedStatus) : undefined);
  const apiDetails = error instanceof ApiRequestError
    ? `HTTP ${error.status} · ${error.code}: ${raw}`
    : status !== undefined
      ? `HTTP ${status}: ${raw}`
      : raw;
  const details = safeDetails(apiDetails || 'No additional details were provided.');

  if (status === 0 || /network request failed|failed to fetch|network error|offline/i.test(raw)) {
    return { title: 'Connection problem', message: 'Check your internet connection and try again.', details };
  }
  if (status === 401 || status === 403) {
    return { title: 'Sign-in needed', message: 'Your session may have expired. Sign in again, then retry.', details };
  }
  if (status === 404) {
    return { title: 'Could not find that', message: 'This item may have been removed. Refresh the screen and try again.', details };
  }
  if (status === 409) {
    return { title: 'That change conflicts with existing data', message: 'Refresh the screen and try again.', details };
  }
  if (status === 408 || /timed? ?out|timeout/i.test(raw)) {
    return { title: 'That took too long', message: 'The service did not respond in time. Please try again.', details };
  }
  if (status === 429) {
    return { title: 'Please wait a moment', message: 'The service is handling too many requests. Try again shortly.', details };
  }
  if (status === 503) {
    return { title: 'Service temporarily unavailable', message: 'The service needed for this request is unavailable right now. Please try again shortly.', details };
  }
  if (status === 502 || status === 504) {
    return { title: 'A service could not respond', message: 'A service needed for this request did not respond. Please try again shortly.', details };
  }
  if (status !== undefined && status >= 500) {
    return { title: 'Service problem', message: 'Something went wrong on the service side. Please try again shortly.', details };
  }
  if (status === 400 || status === 422) {
    return { title: 'Could not complete that', message: 'Please check the information and try again.', details };
  }

  // Preserve concise, deliberately user-facing API messages. Avoid dumping
  // raw HTML, JSON, or stack traces into the dialogue.
  const isReadable = raw.length > 0 && raw.length <= 180 &&
    !/[<>]/.test(raw) && !/\b(at |Error:|SyntaxError|TypeError|\{\s*["'])/i.test(raw);
  return {
    title: fallbackTitle,
    message: isReadable ? raw : 'Please try again. If this keeps happening, share the details below.',
    details,
  };
}

/** Plain-language text for non-blocking inline notices (for example polling). */
export function errorMessageForDisplay(error: unknown): string {
  return describeError(error).message;
}
