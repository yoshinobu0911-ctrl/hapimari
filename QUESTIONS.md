# QUESTIONS.md（エージェントの質問置き場）

> SPEC.md §0-2 に従い、不明点はここに記録する。**ブロッカー**は実装を停止して人間の回答を待つ。
> **非ブロッカー**は暫定判断を記載して実装を継続し、レビュー時に確認してもらう。

## ブロッカー（回答待ち）

（現在なし）

## 非ブロッカー（暫定判断で継続中）

### Q1. profiles の年齢チェック（R1）の DB 制約について
- SPEC §3.1 のコメント「女性35歳/男性45歳未満を拒否（app側+DB制約）」に基づき、
  DB 側は `birth_date` と `current_date` を比較する CHECK 制約で実装した。
- CHECK 制約は「登録時点」でのみ評価されるため、既存行が誕生日経過で違反状態になることはない（挿入・更新時のみ評価）。
- **暫定判断**: この実装で問題ないか、レビュー時に確認。

### Q2. verifications の RLS と「審査待ち画面」（M2）の整合
- SPEC §3 RLS方針「verifications/reports の閲覧・更新は service_role（管理画面）のみ」に従い、
  申請者本人も自分の verifications 行を SELECT できない設計にした（INSERTのみ許可）。
- M2 の「審査待ち画面」で申請ステータスを表示する場合、
  (a) 本人のみSELECT可のポリシーを追加する、(b) Edge Function 経由で返す、のどちらかが必要。
- **暫定判断**: M2 実装時に (a) を提案予定。問題があればレビュー時に指摘してほしい。

### Q3. matches.call_unlocked の閾値
- §3.3 の generated column は `message_count >= 10`（5往復=10メッセージで通話解禁）。
- §4 R5「message_count>=10（5往復）で通話解禁、>=20（10往復）でデート打診」と整合しているため、そのまま実装。

### Q4. Supabaseローカルの既定GRANTが無効だった件（M1で発覚・解決済み）
- 現行のローカルスタック（npm supabase 2.109）では public テーブルに anon/authenticated/service_role への
  DML GRANT が自動付与されず、REST が 403 になった。
- `20260706010000_explicit_grants.sql` で RLS 設計に対応する最小権限を明示付与して解決。
- ホスト版 Supabase（本番）では既定GRANTが存在するが、明示GRANTは冪等なのでそのまま適用可能。
  むしろ本番では「既定で全許可」になるため、**本番移行時に不要な既定GRANTのREVOKEを検討**（M6の仕上げで再確認）。
