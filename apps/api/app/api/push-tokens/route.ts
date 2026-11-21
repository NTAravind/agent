import { requireUser, toErrorResponse } from "@/lib/auth";
import { PushTokenRegisterSchema } from "@agent/shared";
import { supabaseAdmin } from "@/lib/supabase/server";
import { zodMessage } from "@/lib/zod-error";

export async function POST(request: Request) {
  try {
    const user = await requireUser(request);
    const parsed = PushTokenRegisterSchema.safeParse(await request.json().catch(() => null));
    if (!parsed.success) {
      return Response.json(
        { error: { code: "bad_request", message: zodMessage(parsed.error) } },
        { status: 400 },
      );
    }
    const { error } = await supabaseAdmin()
      .from("push_tokens")
      .upsert({
        user_id: user.id,
        expo_token: parsed.data.expoToken,
        platform: parsed.data.platform,
        last_seen: new Date().toISOString(),
      }, { onConflict: "expo_token" });
    if (error) throw new Error(`Could not register push token: ${error.message}`);
    return Response.json({ registered: true }, { status: 201 });
  } catch (error) {
    return toErrorResponse(error);
  }
}

export async function DELETE(request: Request) {
  try {
    const user = await requireUser(request);
    const url = new URL(request.url);
    const expoToken = url.searchParams.get("expoToken");
    if (!expoToken) {
      return Response.json(
        { error: { code: "bad_request", message: "expoToken query param required." } },
        { status: 400 },
      );
    }
    const { error } = await supabaseAdmin()
      .from("push_tokens")
      .delete()
      .eq("expo_token", expoToken)
      .eq("user_id", user.id);
    if (error) throw new Error(`Could not delete push token: ${error.message}`);
    return Response.json({ deleted: true });
  } catch (error) {
    return toErrorResponse(error);
  }
}