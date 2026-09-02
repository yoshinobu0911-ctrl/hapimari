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

/** timeoutMs 以内に解決しなければ null（許可ダイアログ放置等で画面を止めない） */
function withTimeout<T>(p: Promise<T>, timeoutMs: number): Promise<T | null> {
  return Promise.race([
    p,
    new Promise<null>((resolve) => setTimeout(() => resolve(null), timeoutMs)),
  ]);
}

/** 現在地を取得して丸める。未許可・失敗・8秒超過は null（アプリは全機能そのまま使える） */
export async function fetchRoundedLocation(): Promise<RoundedLocation | null> {
  try {
    const Location = await import('expo-location');
    const perm = await withTimeout(Location.requestForegroundPermissionsAsync(), 8000);
    if (perm?.status !== 'granted') return null;
    const pos = await withTimeout(
      Location.getCurrentPositionAsync({ accuracy: Location.Accuracy.Balanced }),
      8000,
    );
    if (!pos) return null;
    return {
      lat: round2(pos.coords.latitude),
      lng: round2(pos.coords.longitude),
    };
  } catch {
    return null;
  }
}

/** 現在地を保存する（profile_locations へRPC経由・成功=true で距離機能が有効になる） */
export async function syncMyLocation(_myId: string): Promise<boolean> {
  const loc = await fetchRoundedLocation();
  if (!loc) return false;
  const { error } = await supabase.rpc('set_my_location', { p_lat: loc.lat, p_lng: loc.lng });
  if (!error) return true;
  // 更新制限（30分間隔・1日8回）による拒否は「座標がDBに保存済みで距離機能は使える」
  // 正常系。false にすると開き直しのたびに距離ソートが失われる（レビュー2回目 must#8）
  return /too_frequent|daily_limit/.test(error.message);
}
