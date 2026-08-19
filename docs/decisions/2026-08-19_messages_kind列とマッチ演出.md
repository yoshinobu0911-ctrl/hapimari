# 2026-08-19 残タスクの一括実施（messages.kind 列・マッチ成立の演出ほか）

> 経緯: M7.2 実装完了の報告に対し、オーナーが
> 「オーナーの承認・登録待ち以外のタスクは、全部消化してしまってください」と包括指示。
> progress.md の TODO に記録済みで仕様が明確なものを実施した。

## 1. messages.kind 列（運営の自動メッセージ判定の正式化）

- **判断**: `messages` に `kind text not null default 'user' check (kind in ('user','system'))` を追加し、
  トーク画面の判定を本文接頭辞（🎉 / 📅）のヒュリスティックから列参照に置き換えた。
- **選択肢**: A=kind列（採用） / B=接頭辞判定の継続（文言変更で壊れるため却下） /
  C=専用テーブル分離（自動メッセージは2種のみで過剰なため却下）
- **安全性（重要）**: `messages` の INSERT 権限は列単位 GRANT（match_id, sender, body）のため、
  **利用者は kind を書けず常に 'user' になる**。'system' を書けるのは security definer の
  RPC（set_date_intent / respond_date_slot）だけ。偽装 INSERT が permission denied になることを
  ローカルDBで実測確認済み。
- 既存データは接頭辞基準で system へ移行（移行後の行数一致を確認）。
- migration: `20260819110000_m7_2b_message_kind.sql`

## 2. マッチ成立の演出（progress TODO・designer_brief §3.3）

- **判断**: OS標準の confirmDialog を、専用モーダル `components/match-celebration.tsx` に置き換えた。
  写真2枚＋ハート＋「マッチが成立しました」＋「メッセージを送る／あとで」。
- designer_brief §7.2 の禁止事項（ゲーム風・ギラつき・派手なアニメーション）に従い、
  動きはフェード表示のみ。外部デザイナー納品時に差し替える前提の暫定実装。
- ローカルE2Eで実確認: いいね返し → like関数 → マッチ成立 → 演出表示 → トークへ遷移。

## 3. あわせて実施した小修正

- `packages/shared/src/compatibility.ts` の既存型エラー1件を修正
  （`tsc --noEmit` が shared 単体でも 0 エラーに）。
- 認証後画面の実描画確認（progress TODO）を実施。ローカルAuth APIでセッションを発行して
  ブラウザに注入する方式（パスワードの画面入力なし）で、M7.2 の全状態＋マイページ＋
  ペイウォール＋マッチ演出を確認。結果は `docs/acceptance/M7_2.md` §A2。

## 実施しなかったもの（待ちの理由つき）

| タスク | 待ちの内容 |
|---|---|
| 実決済テスト（M7.2 §11-7〜15） | Stripeアカウント登録・テストキー（オーナー） |
| 特商法リンク設置 | BYYコーポサイトのページ公開（オーナー） |
| 残り14画面のUI刷新横展開 | 代表8画面のオーナー確認待ち |
| 音声通話の本実装 | 通話サービス契約（オーナー） |
| admin本格認証・保持ジョブ自動化 | センシティブ領域のため設計提案→承認が先（未提案） |
