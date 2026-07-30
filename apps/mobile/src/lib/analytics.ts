/**
 * 行動ログ（イベントログ）の記録。
 *
 * サーバー側で起きる出来事（いいね・マッチ・メッセージ送信・通話・デート・通報・ブロック）は
 * DBトリガが自動で user_events に記録するため、ここから送るのは
 * 「クライアントしか知り得ない行動」＝閲覧・表示・絞り込みだけ。
 *
 * 記録は fire-and-forget（失敗しても本体機能を止めない）。
 * 行為者は常にサーバー側で auth.uid() を使うため、なりすましはできない。
 */
import type { Json } from '@hapimari/shared';
import { supabase } from './supabase';

type ClientEvent = 'profile_view' | 'discover_impression' | 'filter_applied';

export function logEvent(
  eventType: ClientEvent,
  targetUserId?: string,
  props?: Record<string, Json>,
): void {
  void supabase
    .rpc('log_user_event', {
      p_event_type: eventType,
      p_target_user_id: targetUserId,
      p_props: props ?? {},
    })
    .then(({ error }) => {
      if (error && __DEV__) {
        console.warn('[analytics]', eventType, error.message);
      }
    });
}
