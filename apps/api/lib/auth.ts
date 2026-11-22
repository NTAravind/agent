import { apiError } from "@agent/shared";
import { supabaseAnon } from "@/lib/supabase/client";
import { supabaseAdmin } from "@/lib/supabase/server";

export class AuthError extends Error {
  constructor(
    readonly code: string,
    message: string,
    readonly status = 401,
  ) {
    super(message);
    this.name = "AuthError";
  }
}

export type AuthedUser = {
  id: string;
  email: string | null;
};

function bearerToken(request: Request): string | null {
  const header = request.headers.get("authorization") ?? request.headers.get("Authorization");
  if (!header) return null;
  const match = /^Bearer\s+(.+)$/i.exec(header.trim());
  return match ? match[1]!.trim() : null;
}

/** Header names that arrived, for diagnosing "missing Authorization" errors. */
function receivedHeaderNames(request: Request): string[] {
  try {
    return [...request.headers.keys()];
  } catch {
    return [];
  }
}

/** Where a header-less request came from (browser navigation vs. app fetch). */
function requestOrigin(request: Request): string {
  const referer = request.headers.get("referer") ?? "none";
  const agent = request.headers.get("user-agent") ?? "none";
  return `referer=${referer} user-agent=${agent}`;
}

/**
 * Verifies the Supabase JWT on the request. A database trigger enforces the
 * single-account policy; the API accepts any valid Supabase user.
 */
export async function requireUser(request: Request): Promise<AuthedUser> {
  const token = bearerToken(request);
  if (!token) {
    console.warn(
      "[auth] request without a usable Authorization header. Received headers:",
      receivedHeaderNames(request).join(", ") || "(none)",
      "|",
      requestOrigin(request),
    );
    throw new AuthError("unauthorized", "Missing Authorization: Bearer <token> header.");
  }

  const { data, error } = await supabaseAnon().auth.getUser(token);
  if (error || !data.user) {
    throw new AuthError("unauthorized", "Invalid or expired access token.");
  }

  return { id: data.user.id, email: data.user.email ?? null };
}

/** Returns the sole account for global GitHub-vault webhook events, if set up. */
export async function getSoleUserId(): Promise<string | null> {
  const { data, error } = await supabaseAdmin().auth.admin.listUsers({ page: 1, perPage: 2 });
  if (error) throw new Error(`Could not resolve the app account: ${error.message}`);
  return data.users.length === 1 ? data.users[0]!.id : null;
}

/** Wraps a route handler so auth/server errors become the shared error envelope. */
export function toErrorResponse(error: unknown): Response {
  if (error instanceof AuthError) {
    return apiError(error.code, error.message, error.status);
  }
  const message = error instanceof Error ? error.message : "Unexpected server error.";
  // Library errors may carry a deliberate HTTP status/code (e.g. MCP lib
  // user-facing failures like "An API key is required" → 400/403).
  const carried = error as { status?: unknown; code?: unknown } | null;
  if (error instanceof Error && typeof carried?.status === "number") {
    const status = carried.status;
    if (status >= 400 && status < 500) {
      return apiError(
        typeof carried.code === "string" ? carried.code : "bad_request",
        message,
        status,
      );
    }
  }
  console.error("[api]", error);
  return apiError("internal_error", message, 500);
}
