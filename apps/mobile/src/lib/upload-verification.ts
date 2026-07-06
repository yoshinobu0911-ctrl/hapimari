import type { ImagePickerAsset } from 'expo-image-picker';
import { base64ToUint8Array } from './base64';
import { supabase } from './supabase';

export type VerificationKind = 'identity' | 'income' | 'single_cert';

/**
 * 本人確認書類を非公開バケット(verifications)にアップロードし、
 * バケット内パスを返す（閲覧は管理画面が service_role の署名URLで行う）。
 * パス規約: {user_id}/{kind}_{epoch}.{ext}
 */
export async function uploadVerificationDocument(
  userId: string,
  kind: VerificationKind,
  asset: ImagePickerAsset,
): Promise<string> {
  const contentType = asset.mimeType ?? 'image/jpeg';
  const ext = contentType === 'image/png' ? 'png' : contentType === 'image/webp' ? 'webp' : 'jpg';
  const path = `${userId}/${kind}_${Date.now()}.${ext}`;

  let body: ArrayBuffer | Blob;
  if (asset.base64) {
    body = base64ToUint8Array(asset.base64).buffer as ArrayBuffer;
  } else {
    const res = await fetch(asset.uri);
    body = await res.blob();
  }

  const { error } = await supabase.storage
    .from('verifications')
    .upload(path, body, { contentType });
  if (error) throw new Error(`書類のアップロードに失敗しました: ${error.message}`);
  return path;
}
