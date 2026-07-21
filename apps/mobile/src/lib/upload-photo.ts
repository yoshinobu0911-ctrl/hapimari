import type { ImagePickerAsset } from 'expo-image-picker';
import { base64ToUint8Array } from './base64';
import { supabase } from './supabase';

/**
 * プロフィール写真を Storage(photos) にアップロードし、バケット内パスを返す（M6.5改訂）。
 * パス規約: {user_id}/photo_{epoch}.{ext}（RLSで本人フォルダのみ書き込み可）
 *
 * アップロードと同時に写真審査キュー（photo_reviews）へ登録される。
 * 運営が承認するまで他のお相手には表示されない（本人にはすぐ見える）。
 * 表示時は usePhotoUrl / ProfilePhoto が署名付きURLへ変換する。
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

  // 審査キューに登録（未登録の写真は承認されず誰にも表示されないため、失敗はエラー扱い）
  const { error: reviewError } = await supabase.rpc('register_photo_for_review', { p_path: path });
  if (reviewError) throw new Error(`写真の審査登録に失敗しました: ${reviewError.message}`);

  return path;
}
