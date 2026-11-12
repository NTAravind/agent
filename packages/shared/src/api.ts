import { z } from "zod";

/**
 * Error envelope shared by every API route.
 * Shape: { "error": { "code": string, "message": string } }
 */
export const ApiErrorSchema = z.object({
  error: z.object({
    code: z.string(),
    message: z.string(),
  }),
});

export type ApiError = z.infer<typeof ApiErrorSchema>;

export const API_ERROR_CODES = [
  "unauthorized",
  "forbidden",
  "not_found",
  "bad_request",
  "rate_limited",
  "provider_error",
  "internal_error",
] as const;

export type ApiErrorCode = (typeof API_ERROR_CODES)[number];

export function apiError(code: ApiErrorCode | string, message: string, status = 400): Response {
  return Response.json({ error: { code, message } } satisfies ApiError, { status });
}

/** Health payload returned by GET /api/health (protected route). */
export const HealthResponseSchema = z.object({
  status: z.literal("ok"),
  userId: z.string().uuid(),
  email: z.string().nullable(),
  serverTime: z.string().datetime(),
  version: z.string(),
});

export type HealthResponse = z.infer<typeof HealthResponseSchema>;
