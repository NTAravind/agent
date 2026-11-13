import { UploadRequestSchema, isSupportedAttachmentType } from "@agent/shared";

import { requireUser, toErrorResponse } from "@/lib/auth";
import { supabaseAdmin } from "@/lib/supabase/server";

const BUCKET = "attachments";
const MAX_BYTES = 20 * 1024 * 1024;

/**
 * POST /api/upload — creates a documents row and a signed upload URL.
 *
 * The app uploads the file straight to Supabase Storage with the returned
 * token, so the bytes never pass through the API.
 */
export async function POST(request: Request) {
  try {
    const user = await requireUser(request);

    const parsed = UploadRequestSchema.safeParse(await request.json().catch(() => null));
    if (!parsed.success) {
      return Response.json(
        { error: { code: "bad_request", message: "Invalid upload request." } },
        { status: 400 },
      );
    }

    const { fileName, mediaType, sizeBytes } = parsed.data;

    if (sizeBytes > MAX_BYTES) {
      return Response.json(
        { error: { code: "bad_request", message: "File is larger than 20 MB." } },
        { status: 413 },
      );
    }

    if (!isSupportedAttachmentType(mediaType)) {
      return Response.json(
        { error: { code: "bad_request", message: `Unsupported media type: ${mediaType}` } },
        { status: 415 },
      );
    }

    const extension = fileName.includes(".") ? fileName.split(".").pop() : "bin";
    const storagePath = `${user.id}/${crypto.randomUUID()}.${extension}`;

    const { data: document, error: insertError } = await supabaseAdmin()
      .from("documents")
      .insert({
        user_id: user.id,
        storage_path: storagePath,
        mime: mediaType,
        name: fileName,
        size_bytes: sizeBytes,
        status: "uploaded",
      })
      .select("id, storage_path")
      .single();

    if (insertError || !document) {
      return Response.json(
        { error: { code: "internal_error", message: insertError?.message ?? "Could not create document." } },
        { status: 500 },
      );
    }

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
      documentId: document.id,
      storagePath: document.storage_path,
      signedUrl: signed.signedUrl,
      token: signed.token,
    });
  } catch (error) {
    return toErrorResponse(error);
  }
}
