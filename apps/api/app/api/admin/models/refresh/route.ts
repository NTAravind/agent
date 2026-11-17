import { requireUser, toErrorResponse } from "@/lib/auth";
import { refreshProviderCatalog } from "@/lib/models/catalog";

export async function POST(request: Request) {
  try {
    await requireUser(request);
    return Response.json({ providers: await refreshProviderCatalog() });
  } catch (error) { return toErrorResponse(error); }
}
