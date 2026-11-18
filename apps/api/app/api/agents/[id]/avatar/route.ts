import { z } from "zod";

import { ownedAgentId } from "@/lib/agents";
import { requireUser, toErrorResponse } from "@/lib/auth";
import { supabaseAdmin } from "@/lib/supabase/server";

const AvatarUploadSchema = z.object({
  mediaType: z.string().min(3).max(100),
  sizeBytes: z.number().int().positive().max(5 * 1024 * 1024).optional(),
});

const IMAGE_EXTENSIONS: Record<string, string> = {
  "image/png": "png",
  "image/jpeg": "jpg",
  "image/jpg": "jpg",
  "image/webp": "webp",
  "image/gif": "gif",
};

const BUCKET = "avatars";

/**
 * POST /api/agents/:id/avatar — returns a signed Storage upload URL for an
 * image avatar. The app uploads straight to Storage (bytes never pass through
 * the API); the stored avatar value is the Storage path, and every API
 * response converts it to a signed read URL via `resolveAvatar`.
 */
export async function POST(request: Request, ctx: { params: Promise<{ id: string }> }) {
  try {
    const user = await requireUser(request);
    const { id } = await ctx.params;

    const parsed = AvatarUploadSchema.safeParse(await request.json().catch(() => null));
    if (!parsed.success) {
      return Response.json(
        { error: { code: "bad_request", message: "mediaType is required." } },
        { status: 400 },
      );
    }

    const mediaType = parsed.data.mediaType.toLowerCase().split(";")[0].trim();
    const extension = IMAGE_EXTENSIONS[mediaType];
    if (!extension) {
      return Response.json(
        { error: { code: "unsupported_media", message: `Unsupported avatar image type: ${mediaType}` } },
        { status: 415 },
      );
    }

    const agentId = await ownedAgentId(user.id, id);
    if (!agentId) {
      return Response.json(
        { error: { code: "not_found", message: "Unknown agent." } },
        { status: 404 },
      );
    }

    // Folder = user id, matching the avatars bucket's RLS policies.
    const storagePath = `${user.id}/${crypto.randomUUID()}.${extension}`;
    const { data: signed, error: signError } = await supabaseAdmin()
      .storage.from(BUCKET)
      .createSignedUploadUrl(storagePath);
    if (signError || !signed) {
      return Response.json(
        { error: { code: "internal_error", message: signError?.message ?? "Could not sign upload." } },
        { status: 500 },
      );
    }

    return Response.json({
      storagePath,
      signedUrl: signed.signedUrl,
      token: signed.token,
    });
  } catch (error) {
    return toErrorResponse(error);
  }
}
