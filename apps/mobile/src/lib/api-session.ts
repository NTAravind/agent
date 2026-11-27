import { apiFetch, ApiRequestError } from '@/lib/api';
import { supabase } from '@/lib/supabase';

/**
 * Shared session helpers for every API call.
 *
 * `supabase.auth.getSession()` returns the *stored* session. When the app has
 * been closed for a while (or the refresh token rotated), the stored access
 * token can be expired — the API then answers 401 and the screen shows an
 * error even though the user is signed in. These helpers refresh proactively
 * and retry once on a 401.
 */

/** Refresh the session a minute before the access token expires. */
const EXPIRY_MARGIN_MS = 60_000;

/**
 * Returns a usable access token.
 *
 * @param forceRefresh refresh the session even if the current token looks valid
 */
export async function getAccessToken(forceRefresh = false): Promise<string | null> {
  if (forceRefresh) {
    const { data, error } = await supabase.auth.refreshSession();
    if (error || !data.session) return null;
    // Strip ALL whitespace incl. newlines — OkHttp (Android) rejects 0x0a in
    // Authorization header values with IllegalArgumentException.
    return data.session.access_token?.replace(/\s/g, '') ?? null;
  }

  const { data, error } = await supabase.auth.getSession();
  if (error || !data.session) return null;

  const expiresAt = (data.session.expires_at ?? 0) * 1000;
  if (expiresAt && expiresAt <= Date.now() + EXPIRY_MARGIN_MS) {
    // The stored token is expired (or about to be) — refresh it.
    const refreshed = await supabase.auth.refreshSession();
    if (!refreshed.error && refreshed.data.session) {
      return refreshed.data.session.access_token?.replace(/\s/g, '') ?? null;
    }
  }

  return data.session.access_token?.replace(/\s/g, '') ?? null;
}

/**
 * Calls the API with the Supabase session attached.
 *
 * A 401 triggers one refresh + retry, so an expired access token never
 * surfaces as a failure. A 403 (the signed-in account is not the account the
 * API allows) is surfaced as-is — retrying cannot help there.
 */
export async function authedFetch<T>(path: string, init?: RequestInit): Promise<T> {
  const token = await getAccessToken();
  if (!token) {
    throw new ApiRequestError(401, 'unauthorized', 'No access token available. Please sign in again.');
  }

  try {
    return await apiFetch<T>(path, { token, init });
  } catch (error) {
    if (error instanceof ApiRequestError && error.status === 401) {
      const fresh = await getAccessToken(true);
      if (fresh && fresh !== token) {
        return await apiFetch<T>(path, { token: fresh, init });
      }
    }
    throw error;
  }
}
