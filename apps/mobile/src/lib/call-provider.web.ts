/**
 * 通話プロバイダの選択 — **Web用**（M8・docs/design/M8_call_design.md §4）
 * Agora 実装（実音声あり）を使う。ネイティブ側は call-provider.ts を参照。
 */
import { agoraCallProvider } from '@/lib/call-provider-agora';

export const callProvider = agoraCallProvider;

/** 実音声が流れる実装か（通話画面の「モック通話です」注記の出し分けに使う） */
export const callAudioEnabled = true;
