/**
 * 現在地の取得と保存（M6設計書 B6・プライバシー原則）
 *
 * - 取得はexpo-location（Webではブラウザの位置情報APIにマップされる）。許可は任意
 * - 保存前にクライアント側でも約1km単位（小数第2位）へ丸める（DBトリガでも二重に強制）
 * - 他ユーザーへは座標を渡さない（DBのカラム遮断+距離RPC）。この関数は自分の行の更新のみ
 */
import { supabase } from '@/lib/supabase';

export interface RoundedLocation {
  lat: number;
  lng: number;
}

function round2(v: number): number {
  return Math.round(v * 100) / 100;
}

/** 現在地を取得して丸める。未許可・失敗は null（アプリは全機能そのまま使える） */
export async function fetchRoundedLocation(): Promise<RoundedLocation | null> {
  try {
    const Location = await import('expo-location');
    const { status } = await Location.requestForegroundPermissionsAsync();
    if (status !== 'granted') return null;
    const pos = await Location.getCurrentPositionAsync({
      accuracy: Location.Accuracy.Balanced,
    });
    return {
      lat: round2(pos.coords.latitude),
      lng: round2(pos.coords.longitude),
    };
  } catch {
    return null;
  }
}

/** 現在地を自分のプロフィールに保存する。成功=true（距離機能が有効になる） */
export async function syncMyLocation(myId: string): Promise<boolean> {
  const loc = await fetchRoundedLocation();
  if (!loc) return false;
  const { error } = await supabase
    .from('profiles')
    .update({ loc_lat: loc.lat, loc_lng: loc.lng })
    .eq('id', myId);
  return !error;
}
