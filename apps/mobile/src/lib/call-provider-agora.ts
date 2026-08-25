/**
 * Agora 通話プロバイダ（M8・docs/design/M8_call_design.md §4）— **Web専用**
 *
 * 役割分担:
 *   発着信の合図（invite/accept/decline/hangup・無応答30秒・切断通知）は
 *   従来どおり mockCallProvider（Supabase Realtime broadcast）をそのまま使い、
 *   「connected の区間だけ」Agora のチャネルに参加して実音声を流す。
 *   モックとの差分は音が出ることだけで、画面・タイマー・通話ログは無変更。
 *
 * このファイルは call-provider.web.ts からのみ import される。
 * ネイティブのバンドルには含まれない（Metro の .web.ts 解決による分離）。
 * Agora SDK 本体は通話開始時に動的 import し、初期ロードを重くしない。
 *
 * 順序（発信・応答とも）:
 *   1. マイク取得（拒否されたら相手を呼び出す前に mic_denied で終了）
 *   2. トークン取得（agora-token Edge Function。資格チェックはサーバー側）
 *   3. シグナリング開始 → connected で Agora チャネルへ join
 */
import type {
  CallEndReason,
  CallHandle,
  CallListener,
  CallListenHandlers,
  CallProvider,
  CallProviderEvents,
} from '@hapimari/shared';
import type { IAgoraRTCClient, IMicrophoneAudioTrack } from 'agora-rtc-sdk-ng';
import { mockCallProvider } from '@/lib/call-provider-mock';
import { supabase } from '@/lib/supabase';

/** 準備段階（マイク・トークン）の失敗。reason が画面の終了メッセージになる */
class CallSetupError extends Error {
  constructor(readonly reason: CallEndReason) {
    super(reason);
  }
}

interface TokenResponse {
  ok: true;
  appId: string;
  channel: string;
  uid: string;
  token: string;
  expiresAt: string;
}

async function fetchCallToken(matchId: string): Promise<TokenResponse> {
  const { data, error } = await supabase.functions.invoke('agora-token', {
    body: { matchId },
  });
  if (error) {
    // 資格エラー（非当事者・ブロック等）・未設定・通信断はすべて「接続できない」扱い
    console.warn('agora-token failed');
    throw new CallSetupError('error');
  }
  return data as TokenResponse;
}

function isMicDenied(e: unknown): boolean {
  const code = (e as { code?: unknown })?.code;
  const name = (e as { name?: unknown })?.name;
  return code === 'PERMISSION_DENIED' || name === 'NotAllowedError';
}

interface AudioSession {
  join(): Promise<void>;
  dispose(): Promise<void>;
}

/**
 * マイクとトークンを先に確保した音声セッションを作る。
 * onFatal は通話成立後の致命的イベント（トークン期限切れ等）で呼ばれる。
 */
async function createAudioSession(
  matchId: string,
  onFatal: (reason: CallEndReason) => void,
): Promise<AudioSession> {
  const AgoraRTC = (await import('agora-rtc-sdk-ng')).default;

  let mic: IMicrophoneAudioTrack;
  try {
    mic = await AgoraRTC.createMicrophoneAudioTrack();
  } catch (e) {
    throw new CallSetupError(isMicDenied(e) ? 'mic_denied' : 'error');
  }

  let grant: TokenResponse;
  try {
    grant = await fetchCallToken(matchId);
  } catch (e) {
    mic.close();
    throw e;
  }

  const client: IAgoraRTCClient = AgoraRTC.createClient({ mode: 'rtc', codec: 'vp8' });
  let disposed = false;

  client.on('user-published', (user, mediaType) => {
    if (mediaType !== 'audio') return;
    client
      .subscribe(user, 'audio')
      .then(() => user.audioTrack?.play())
      .catch(() => {
        // 購読失敗は次の user-published / 再接続で回復し得るため落とさない
        console.warn('agora: subscribe failed');
      });
  });

  // トークン期限切れ = 15分上限のサーバー側バックストップ（設計書 §3）
  client.on('token-privilege-did-expire', () => {
    if (!disposed) onFatal('timeout');
  });

  return {
    async join() {
      await client.join(grant.appId, grant.channel, grant.token, grant.uid);
      await client.publish([mic]);
    },
    async dispose() {
      if (disposed) return;
      disposed = true;
      client.removeAllListeners();
      mic.close();
      try {
        await client.leave();
      } catch {
        // 未joinのまま終了した場合など。無視してよい
      }
    },
  };
}

/**
 * シグナリング（モック実装）に音声セッションを重ねる共通処理。
 * 終了理由の上書きは call/[matchId].tsx の timedOutRef と同じ方式:
 * fatal時は理由を覚えてから hangup し、onEnded で差し替える。
 */
async function startWithAudio(
  role: 'caller' | 'callee',
  matchId: string,
  selfId: string,
  events: CallProviderEvents,
): Promise<CallHandle> {
  let handle: CallHandle | null = null;
  let overrideReason: CallEndReason | null = null;
  let finished = false;

  const fatal = (reason: CallEndReason) => {
    if (finished) return;
    overrideReason = reason;
    handle?.hangup();
  };

  let audio: AudioSession;
  try {
    audio = await createAudioSession(matchId, fatal);
  } catch (e) {
    // 相手を呼び出す前に終了（マイク拒否・トークン発行不可）
    const reason = e instanceof CallSetupError ? e.reason : 'error';
    events.onStateChange('ended');
    events.onEnded(reason);
    return { hangup: () => {} };
  }

  const wrappedEvents: CallProviderEvents = {
    onStateChange: (state) => {
      events.onStateChange(state);
      if (state === 'connected') {
        audio.join().catch(() => {
          console.warn('agora: join failed');
          fatal('error');
        });
      }
    },
    onEnded: (reason) => {
      finished = true;
      void audio.dispose();
      events.onEnded(overrideReason ?? reason);
    },
  };

  handle =
    role === 'caller'
      ? await mockCallProvider.startCall(matchId, selfId, wrappedEvents)
      : await mockCallProvider.joinCall(matchId, selfId, wrappedEvents);
  // handle 確定前に fatal が起きていた場合（応答直後の join 失敗等）はここで切断する
  if (overrideReason && !finished) handle.hangup();
  return handle;
}

export const agoraCallProvider: CallProvider = {
  startCall(matchId, selfId, events) {
    return startWithAudio('caller', matchId, selfId, events);
  },

  joinCall(matchId, selfId, events) {
    return startWithAudio('callee', matchId, selfId, events);
  },

  // 着信の監視はシグナリングのみ（Agora SDK を読み込まない）
  listen(matchId: string, selfId: string, handlers: CallListenHandlers): CallListener {
    return mockCallProvider.listen(matchId, selfId, handlers);
  },
};
