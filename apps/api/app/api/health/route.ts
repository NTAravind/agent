import { HealthResponseSchema } from "@agent/shared";
import { requireUser, toErrorResponse } from "@/lib/auth";

/**
 * Protected health check. Doubles as the Phase 0 acceptance probe:
 * a signed-in mobile app must be able to call this with its JWT.
 */
export async function GET(request: Request) {
  try {
    const user = await requireUser(request);
    const body = HealthResponseSchema.parse({
      status: "ok",
      userId: user.id,
      email: user.email,
      serverTime: new Date().toISOString(),
      version: process.env.npm_package_version ?? "0.1.0",
    });
    return Response.json(body);
  } catch (error) {
    return toErrorResponse(error);
  }
}
