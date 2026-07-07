/**
 * デート翌日のフィードバック通知（F-05 / docs/design/M4_design.md §5.2）
 *
 * ネイティブ: expo-notifications のローカル通知を「デート翌日の10:00(JST)」に予約する。
 * Web: ローカル通知非対応のため何もしない（アプリ内バナーが代替。chat/date画面の can_feedback 表示）。
 * 通知が使えない環境・権限拒否時は黙ってスキップする（フィードバック自体はアプリ内から可能）。
 */
import type { DateSlot } from '@hapimari/shared';
import { Platform } from 'react-native';

export async function scheduleFeedbackReminder(slot: DateSlot, partnerName: string): Promise<void> {
  if (Platform.OS === 'web') return;
  try {
    const Notifications = await import('expo-notifications');
    const { status } = await Notifications.requestPermissionsAsync();
    if (status !== 'granted') return;

    // デート当日10:00(JST) の24時間後 = 翌日10:00(JST)
    const fireAt = new Date(
      new Date(`${slot.date}T10:00:00+09:00`).getTime() + 24 * 60 * 60 * 1000,
    );
    if (fireAt.getTime() <= Date.now()) return;

    await Notifications.scheduleNotificationAsync({
      content: {
        title: 'ハピマリ',
        body: `${partnerName}さんとのデートはいかがでしたか？アプリからひとことお聞かせください。`,
      },
      trigger: {
        type: Notifications.SchedulableTriggerInputTypes.DATE,
        date: fireAt,
      },
    });
  } catch {
    // 通知不可の環境（権限・シミュレータ等）では静かに諦める
  }
}
