import { fetch as expoFetch } from 'expo/fetch';

export const API_BASE_URL = (process.env.EXPO_PUBLIC_API_BASE_URL ?? '').replace(/\/$/, '');

export class ApiRequestError extends Error {
  constructor(
    readonly status: number,
    readonly code: string,
    message: string
  ) {
    super(message);
    this.name = 'ApiRequestError';
  }
}

type ApiFetchOptions = {
  token?: string | null;
  init?: RequestInit;
};

/**
 * expo/fetch is Expo's native fetch: it is the implementation the AI SDK
 * documents for React Native and it handles headers/streaming consistently on
 * device. Falls back to the global fetch if expo/fetch is unavailable.
 */
const nativeFetch: typeof globalThis.fetch =
  typeof expoFetch === 'function' ? (expoFetch as unknown as typeof globalThis.fetch) : globalThis.fetch;

/**
 * Calls the Next.js API with the Supabase access token attached.
 */
export async function apiFetch<T>(path: string, options: ApiFetchOptions = {}): Promise<T> {
  if (!API_BASE_URL) {
    throw new ApiRequestError(0, 'not_configured', 'EXPO_PUBLIC_API_BASE_URL is not set.');
  }
  if (!options.token) {
    throw new ApiRequestError(401, 'unauthorized', 'No access token available.');
  }

  const headers: Record<string, string> = {
    'Content-Type': 'application/json',
    Accept: 'application/json',
    ...((options.init?.headers as Record<string, string> | undefined) ?? {}),
    // Set last so it can never be shadowed by a spread above.
    Authorization: `Bearer ${options.token}`,
  };

  const response = await nativeFetch(`${API_BASE_URL}${path}`, {
    ...options.init,
    headers,
  });

  const text = await response.text();
  const payload = parseJson(text);
  const contentType = response.headers.get('content-type') ?? '';

  if (!response.ok) {
    const error = (payload as { error?: { code: string; message: string } }).error;
    throw new ApiRequestError(
      response.status,
      error?.code ?? 'internal_error',
      error?.message ?? describeFailure(response.status, contentType, text)
    );
  }

  return payload as T;
}

/**
 * Parses a response body as JSON, tolerating bodies that are not JSON.
 *
 * A non-JSON body is common in practice: Vercel's HTML 404 page for a route
 * that does not exist in the deployed build, proxy/edge error pages, or an
 * empty body. Parsing those with `JSON.parse` throws a bare SyntaxError
 * ("Unexpected token '<'") that hides the actual status code.
 */
function parseJson(text: string): unknown {
  const trimmed = text.trim();
  if (!trimmed) return {};
  try {
    return JSON.parse(trimmed);
  } catch {
    return { __raw: trimmed };
  }
}

/** Human-readable explanation for a failed response without a JSON error body. */
function describeFailure(status: number, contentType: string, text: string): string {
  const snippet = text.slice(0, 200).replace(/\s+/g, ' ').trim();
  if (contentType.includes('text/html')) {
    return (
      `The API returned an HTML page (HTTP ${status}), not JSON. ` +
      `The route may not exist in the deployed build yet — redeploy the API. ` +
      `First 200 chars: ${snippet}`
    );
  }
  if (!snippet) {
    return `Request failed with status ${status} and an empty response body.`;
  }
  return `Request failed with status ${status}: ${snippet}`;
}

export type ApiDebugInfo = {
  url: string;
  tokenLength: number;
  headerNames: string[];
  status: number;
  body: string;
};

/**
 * Same request as apiFetch, but returns what was actually sent and received so
 * the UI can show it. Used by the health check to make failures obvious.
 */
export async function apiFetchDebug(
  path: string,
  options: ApiFetchOptions = {}
): Promise<ApiDebugInfo> {
  const url = `${API_BASE_URL}${path}`;
  const headers: Record<string, string> = {
    'Content-Type': 'application/json',
    Accept: 'application/json',
    ...((options.init?.headers as Record<string, string> | undefined) ?? {}),
    Authorization: `Bearer ${options.token ?? ''}`,
  };

  const response = await nativeFetch(url, { ...options.init, headers });
  const body = await response.text();

  return {
    url,
    tokenLength: options.token?.length ?? 0,
    headerNames: Object.keys(headers),
    status: response.status,
    body: body.slice(0, 600),
  };
}
