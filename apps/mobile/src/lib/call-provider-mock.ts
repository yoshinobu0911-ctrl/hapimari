/**
 * モック通話プロバイダ（docs/design/M5_design.md §4・オーナー承認済み判断#1）
 *
 * Supabase Realtime の broadcast チャネル `call-{matchId}` で
 * invite / accept / decline / hangup を送受信する。
 * シグナリング（発着信・応答・切断・タイマー）は本物、**音声は流れない**。
 * Agora 契約後は CallProvider の別実装に差し替える（このファイルだけが対象）。
 *
 * 既知の許容リスク（設計書§8-3）: broadcastチャネルはRLS対象外のため、
 * イベントの from を検査し当事者以外からのイベントは無視する。
 */
import {
  CALL_NO_ANSWER_TIMEOUT_SECONDS,
  type CallEndReason,
  type CallHandle,
  type CallListener,
  type CallListenHandlers,
  type CallProvider,
  type CallProviderEvents,
} from '@hapimari/shared';
import type { RealtimeChannel } from '@supabase/supabase-js';
import { supabase } from '@/lib/supabase';

type SignalEvent = 'invite' | 'accept' | 'decline' | 'hangup';

function topic(matchId: string): string {
  return `call-${matchId}`;
}

function send(channel: RealtimeChannel, event: SignalEvent, from: string): void {
  channel.send({ type: 'broadcast', event, payload: { from } });
}

function isFromPeer(payload: unknown, selfId: string): boolean {
  const from = (payload as { from?: unknown })?.from;
  return typeof from === 'string' && from.length > 0 && from !== selfId;
}

/** 送信が飛びきる猶予を置いてからチャネルを破棄する */
function removeSoon(channel: RealtimeChannel): void {
  setTimeout(() => {
    supabase.removeChannel(channel);
  }, 500);
}

function createSession(
  matchId: string,
  selfId: string,
  role: 'caller' | 'callee',
  events: CallProviderEvents,
): Promise<CallHandle> {
  return new Promise((resolve) => {
    let ended = false;
    let noAnswerTimer: ReturnType<typeof setTimeout> | null = null;
    const channel = supabase.channel(topic(matchId), {
      config: { broadcast: { self: false } },
    });

    const end = (reason: CallEndReason, notifyPeer: boolean) => {
      if (ended) return;
      ended = true;
      if (noAnswerTimer) clearTimeout(noAnswerTimer);
      if (notifyPeer) send(channel, 'hangup', selfId);
      events.onStateChange('ended');
      events.onEnded(reason);
      removeSoon(channel);
    };

    channel
      .on('broadcast', { event: 'accept' }, ({ payload }) => {
        if (!isFromPeer(payload, selfId) || ended) return;
        if (noAnswerTimer) clearTimeout(noAnswerTimer);
        events.onStateChange('connected');
      })
      .on('broadcast', { event: 'decline' }, ({ payload }) => {
        if (!isFromPeer(payload, selfId)) return;
        end('declined', false);
      })
      .on('broadcast', { event: 'hangup' }, ({ payload }) => {
        if (!isFromPeer(payload, selfId)) return;
        end('hangup', false);
      })
      .subscribe((status) => {
        if (status === 'CHANNEL_ERROR' || status === 'TIMED_OUT' || status === 'CLOSED') {
          end('error', false);
          return;
        }
        if (status !== 'SUBSCRIBED' || ended) return;
        if (role === 'caller') {
          events.onStateChange('calling');
          send(channel, 'invite', selfId);
          noAnswerTimer = setTimeout(
            () => end('no_answer', true),
            CALL_NO_ANSWER_TIMEOUT_SECONDS * 1000,
          );
        } else {
          // 応答側: 参加した瞬間に accept を送って通話中になる
          send(channel, 'accept', selfId);
          events.onStateChange('connected');
        }
        resolve({ hangup: () => end('hangup', true) });
      });
  });
}

export const mockCallProvider: CallProvider = {
  startCall(matchId, selfId, events) {
    return createSession(matchId, selfId, 'caller', events);
  },

  joinCall(matchId, selfId, events) {
    return createSession(matchId, selfId, 'callee', events);
  },

  listen(matchId, selfId, handlers: CallListenHandlers): CallListener {
    const channel = supabase.channel(topic(matchId), {
      config: { broadcast: { self: false } },
    });
    channel
      .on('broadcast', { event: 'invite' }, ({ payload }) => {
        if (!isFromPeer(payload, selfId)) return;
        handlers.onIncoming();
      })
      .on('broadcast', { event: 'hangup' }, ({ payload }) => {
        if (!isFromPeer(payload, selfId)) return;
        handlers.onCancelled();
      })
      .subscribe();

    return {
      stop: async () => {
        // leave完了まで待つ（直後に同名チャネルへjoinする通話画面との競合防止）
        await supabase.removeChannel(channel);
      },
      decline: () => {
        send(channel, 'decline', selfId);
      },
    };
  },
};
