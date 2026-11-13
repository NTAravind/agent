import { ModelsResponseSchema } from "@agent/shared";

import { requireUser, toErrorResponse } from "@/lib/auth";
import {
  DEFAULT_FALLBACK_ORDER,
  DEFAULT_MODEL_ID,
  isProviderConfigured,
  listRegistry,
  providersWithKeys,
  usageToday,
} from "@/lib/models";

/**
 * GET /api/models — registry, provider availability and today's usage.
 * The mobile composer uses this to build the model picker.
 */
export async function GET(request: Request) {
  try {
    const user = await requireUser(request);

    const models = listRegistry().map((entry) => ({
      ...entry,
      available: isProviderConfigured(entry.provider),
    }));

    const body = ModelsResponseSchema.parse({
      models,
      providersWithKeys: providersWithKeys(),
      defaultModel: DEFAULT_MODEL_ID,
      fallbackOrder: [...DEFAULT_FALLBACK_ORDER],
      usageToday: await usageToday(user.id),
    });

    return Response.json(body);
  } catch (error) {
    return toErrorResponse(error);
  }
}
