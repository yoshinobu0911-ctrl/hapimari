/**
 * 通話プロバイダの選択（M8・docs/design/M8_call_design.md §4）
 *
 * このファイルは**ネイティブ（iOS/Android）用**。Web では call-provider.web.ts が
 * 代わりに読み込まれる（Metro の .web.ts 解決）。
 * ネイティブは当面モックのまま（§6-2 オーナー決定A: Web先行。
 * react-native-agora + Expo開発ビルドでの対応は後続スプリント）。
 */
import { mockCallProvider } from '@/lib/call-provider-mock';

export const callProvider = mockCallProvider;

/** 実音声が流れる実装か（通話画面の「モック通話です」注記の出し分けに使う） */
export const callAudioEnabled = false;
