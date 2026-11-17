import { z } from "zod";

import { requireUser, toErrorResponse } from "@/lib/auth";
import { providerKeyStatus, readProviderCatalog, setMobileModels, usageRecent } from "@/lib/models/catalog";

export async function GET(request: Request) {
  try {
    const user = await requireUser(request);
    const [models, usage] = await Promise.all([readProviderCatalog(), usageRecent(user.id)]);
    return Response.json({ models, providers: providerKeyStatus(), usage });
  } catch (error) { return toErrorResponse(error); }
}

export async function PATCH(request: Request) {
  try {
    await requireUser(request);
    const parsed = z.object({
      models: z.array(z.object({ id: z.string().regex(/^[a-z]+:[a-zA-Z0-9._\-/]+$/), enabled: z.boolean() })).max(500),
    }).safeParse(await request.json().catch(() => null));
    if (!parsed.success) return Response.json({ error: { code: "bad_request", message: "Provide up to 500 valid model availability updates." } }, { status: 400 });
    await setMobileModels(parsed.data.models);
    return Response.json({ ok: true });
  } catch (error) { return toErrorResponse(error); }
}
