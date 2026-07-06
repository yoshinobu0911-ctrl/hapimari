import type { ImagePickerAsset } from 'expo-image-picker';
import { base64ToUint8Array } from './base64';
import { supabase } from './supabase';

/**
 * プロフィール写真を Storage(photos) にアップロードし、公開URLを返す。
 * パス規約: {user_id}/photo_{epoch}.{ext}（RLSで本人フォルダのみ書き込み可）
 */
export async function uploadProfilePhoto(userId: string, asset: ImagePickerAsset): Promise<string> {
  const contentType = asset.mimeType ?? 'image/jpeg';
  const ext = contentType === 'image/png' ? 'png' : contentType === 'image/webp' ? 'webp' : 'jpg';
  const path = `${userId}/photo_${Date.now()}.${ext}`;

  let body: ArrayBuffer | Blob;
  if (asset.base64) {
    const bytes = base64ToUint8Array(asset.base64);
    body = bytes.buffer as ArrayBuffer;
  } else {
    // Webでは base64 が入らないことがあるため、URI(データURL/blob)から取得する
    const res = await fetch(asset.uri);
    body = await res.blob();
  }

  const { error } = await supabase.storage.from('photos').upload(path, body, { contentType });
  if (error) throw new Error(`写真のアップロードに失敗しました: ${error.message}`);

  return supabase.storage.from('photos').getPublicUrl(path).data.publicUrl;
}
