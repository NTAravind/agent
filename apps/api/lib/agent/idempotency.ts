/**
 * Idempotency for durable task starts.
 *
 * A retried "start task" request must not start a second task. The client
 * sends a UUID in the `idempotency-key` header; the server stores it with
 * the run and answers a retry with the run that already owns the key.
 */

/** Statuses that still have work left to do. */
const LIVE_RUN_STATUSES = new Set([
  "queued",
  "running",
  "awaiting_approval",
  "paused",
]);

const UUID_PATTERN =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

export type IdempotencyKeyResult =
  | { ok: true; key: string | null }
  | { ok: false; message: string };

/**
 * Validates the `idempotency-key` header.
 *
 * A missing header is fine — the request simply is not retry-safe. A header
 * that is not a UUID is rejected, so a client cannot use an arbitrary string
 * as a lookup key.
 */
export function parseIdempotencyKey(
  header: string | null | undefined,
): IdempotencyKeyResult {
  const value = header?.trim();
  if (!value) return { ok: true, key: null };
  if (!UUID_PATTERN.test(value)) {
    return {
      ok: false,
      message: "Invalid idempotency-key header (must be UUID).",
    };
  }
  return { ok: true, key: value };
}

/**
 * The HTTP status for a start-task answer.
 *
 * A run that is still working is reported as "accepted" (202) so the client
 * keeps polling; a finished run is reported as "ok" (200).
 */
export function runStartStatus(status: string): 200 | 202 {
  return LIVE_RUN_STATUSES.has(status) ? 202 : 200;
}
