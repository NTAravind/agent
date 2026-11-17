import { ModelsResponseSchema } from "@agent/shared";

import { requireUser, toErrorResponse } from "@/lib/auth";
import {
  DEFAULT_FALLBACK_ORDER,
  DEFAULT_MODEL_ID,
  isProviderConfigured,
  providersWithKeys,
  usageToday,
} from "@/lib/models";
import { enabledModels } from "@/lib/models/catalog";

/**
 * GET /api/models — dashboard-enabled models, provider availability and today's usage.
 * The mobile composer and agent task chooser use this as their model source.
 */
export async function GET(request: Request) {
  try {
    const user = await requireUser(request);

    const models = (await enabledModels()).map((entry) => ({
      ...entry,
      available: isProviderConfigured(entry.provider),
    }));
    const defaultModel = models.some((entry) => entry.id === DEFAULT_MODEL_ID)
      ? DEFAULT_MODEL_ID
      : models[0]?.id ?? DEFAULT_MODEL_ID;

    const body = ModelsResponseSchema.parse({
      models,
      providersWithKeys: providersWithKeys(),
      defaultModel,
      fallbackOrder: [...DEFAULT_FALLBACK_ORDER],
      usageToday: await usageToday(user.id),
    });

    return Response.json(body, { headers: { "Cache-Control": "no-store, max-age=0" } });
  } catch (error) {
    return toErrorResponse(error);
  }
}
