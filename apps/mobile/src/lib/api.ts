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
 * Calls the Next.js API with the Supabase access token attached.
 */
export async function apiFetch<T>(path: string, options: ApiFetchOptions = {}): Promise<T> {
  if (!API_BASE_URL) {
    throw new ApiRequestError(0, 'not_configured', 'EXPO_PUBLIC_API_BASE_URL is not set.');
  }
  if (!options.token) {
    throw new ApiRequestError(401, 'unauthorized', 'No access token available.');
  }

  const response = await fetch(`${API_BASE_URL}${path}`, {
    ...options.init,
    headers: {
      'Content-Type': 'application/json',
      Authorization: `Bearer ${options.token}`,
      ...(options.init?.headers ?? {}),
    },
  });

  const text = await response.text();
  const payload = text ? JSON.parse(text) : {};

  if (!response.ok) {
    const error = (payload as { error?: { code: string; message: string } }).error;
    throw new ApiRequestError(
      response.status,
      error?.code ?? 'internal_error',
      error?.message ?? `Request failed with status ${response.status}`
    );
  }

  return payload as T;
}
