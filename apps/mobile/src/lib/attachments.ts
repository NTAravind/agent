import * as DocumentPicker from "expo-document-picker";
import * as ImagePicker from "expo-image-picker";
import { Platform } from "react-native";

import { apiFetch } from "@/lib/api";
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

async function accessToken(): Promise<string | null> {
  const { data, error } = await supabase.auth.getSession();
  if (error || !data.session) return null;
  return data.session.access_token;
}

/** Uploads a local file to the private attachments bucket via a signed URL. */
async function uploadFile(
  uri: string,
  fileName: string,
  mediaType: string,
  sizeBytes: number,
): Promise<PendingAttachment> {
  const token = await accessToken();
  if (!token) throw new Error("Not signed in.");

  const signed = await apiFetch<UploadResponse>("/api/upload", {
    token,
    init: {
      method: "POST",
      body: JSON.stringify({ fileName, mediaType, sizeBytes }),
    },
  });

  const response = await fetch(signed.signedUrl, {
    method: "PUT",
    headers: {
      "Content-Type": mediaType,
      Authorization: `Bearer ${signed.token}`,
      "x-upsert": "false",
    },
    body: uri as unknown as BodyInit,
  });

  if (!response.ok) {
    throw new Error(`Upload failed (${response.status}).`);
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
