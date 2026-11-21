import * as DocumentPicker from "expo-document-picker";
import * as ImagePicker from "expo-image-picker";
import { Platform } from "react-native";

import { authedFetch } from "@/lib/api-session";
import { supabase } from "@/lib/supabase";

export type PendingAttachment = {
  /** Document id returned by /api/upload. */
  documentId: string;
  mediaType: string;
  name: string;
  /** Local preview (images only). */
  uri?: string;
};

type UploadResponse = {
  documentId: string;
  storagePath: string;
  signedUrl: string;
  token: string;
};

/** Uploads a local file to the private attachments bucket via a signed URL. */
async function uploadFile(
  uri: string,
  fileName: string,
  mediaType: string,
  sizeBytes: number,
): Promise<PendingAttachment> {
  const signed = await authedFetch<UploadResponse>("/api/upload", {
    method: "POST",
    body: JSON.stringify({ fileName, mediaType, sizeBytes }),
  });

  // React Native uploads local files as multipart form data.
  const form = new FormData();
  form.append("file", { uri, name: fileName, type: mediaType } as unknown as Blob);

  const { error } = await supabase.storage
    .from("attachments")
    .uploadToSignedUrl(signed.storagePath, signed.token, form, {
      contentType: mediaType,
      upsert: false,
    });

  if (error) {
    throw new Error(`Upload failed: ${error.message}`);
  }

  return { documentId: signed.documentId, mediaType, name: fileName };
}

/** Opens the photo library and uploads the chosen image(s). */
export async function pickAndUploadImages(): Promise<PendingAttachment[]> {
  const permission = await ImagePicker.requestMediaLibraryPermissionsAsync();
  if (!permission.granted) {
    throw new Error("Photo library access is required to attach images.");
  }

  const result = await ImagePicker.launchImageLibraryAsync({
    mediaTypes: ["images"],
    quality: 0.9,
    allowsMultipleSelection: true,
  });

  if (result.canceled) return [];

  const attachments: PendingAttachment[] = [];
  for (const asset of result.assets) {
    const mediaType = asset.mimeType ?? "image/jpeg";
    const name = asset.fileName ?? `image-${Date.now()}.jpg`;
    const sizeBytes = asset.fileSize ?? 0;
    const uploaded = await uploadFile(asset.uri, name, mediaType, sizeBytes);
    attachments.push({ ...uploaded, uri: asset.uri });
  }
  return attachments;
}

/** Opens the document picker and uploads the chosen PDF / text file. */
export async function pickAndUploadDocument(): Promise<PendingAttachment[]> {
  const result = await DocumentPicker.getDocumentAsync({
    type: Platform.OS === "ios" ? ["com.adobe.pdf", "public.plain-text"] : ["application/pdf", "text/plain"],
    copyToCacheDirectory: true,
    multiple: true,
  });

  if (result.canceled) return [];

  const attachments: PendingAttachment[] = [];
  for (const asset of result.assets) {
    const mediaType = asset.mimeType ?? "application/pdf";
    const name = asset.name;
    const sizeBytes = asset.size ?? 0;
    const uploaded = await uploadFile(asset.uri, name, mediaType, sizeBytes);
    attachments.push({ ...uploaded, uri: asset.uri });
  }
  return attachments;
}
