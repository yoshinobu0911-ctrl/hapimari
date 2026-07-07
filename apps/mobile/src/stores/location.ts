import { create } from 'zustand';

/**
 * 位置情報の許可状態（M6 B6）。
 * null = 未確認 / true = 取得済み（距離機能が使える） / false = 未許可・取得失敗
 * 距離順ソートの有効/無効判定と、フィルタ画面の案内表示に使う。
 */
interface LocationState {
  gpsAvailable: boolean | null;
  setGpsAvailable: (v: boolean) => void;
}

export const useLocationStore = create<LocationState>((set) => ({
  gpsAvailable: null,
  setGpsAvailable: (v) => set({ gpsAvailable: v }),
}));
