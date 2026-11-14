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
  const payload = text ? JSON.parse(text) : {};

  if (!response.ok) {
    const error = (payload as { error?: { code: string; message: string } }).error;
    throw new ApiRequestError(
      response.status,
      error?.code ?? 'internal_error',
      `${error?.message ?? `Request failed with status ${response.status}`} [${response.status} ${text.slice(0, 200)}]`
    );
  }

  return payload as T;
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
