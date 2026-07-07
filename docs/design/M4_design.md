# M4 設計書: デート移行支援（差別化の核）

> **本書の使い方**: M3設計書と同様、本リポジトリの経緯を知らないエージェントでも実装完遂できる
> 自己完結ドキュメント。実装前に §1 と `docs/design/M3_design.md` §1.2（環境の落とし穴）を必読。
> SPEC.md と矛盾する場合は本書を優先（オーナー承認済みの変更を含むため）。
> **本書はオーナー承認後に実装着手する**（CLAUDE.md §4。§10の推奨案で承認された前提で書いてある）。

---

## 1. 前提と環境

- リポジトリ・環境・落とし穴は `docs/design/M3_design.md` §1 のとおり（日本語パス禁止 / PATH補正 /
  新規オブジェクトの明示GRANT / `migration up` / 型再生成 / typed routes / RN-webの癖）。
- M3完了時点の適用済みmigrationは6本（最新: `20260706200000_m3_social.sql`）。
- **いいね送信は Edge Function `like` が必要**（`pnpm exec supabase functions serve like`）。
  M4のE2Eでもマッチ作成に使う場合は起動しておく。
- テストペア: **seed01(たかし)×seed13(ようこ) が message_count=22** でデート打診可能状態（seed済み）。
  M3のE2Eで作成した ひろし(seed03)×みほ(seed15)（message_count=3）は「打診バナーが出ない」側の確認に使える。
- 再利用資産: `constants.ts` の `DATE_PROPOSAL_MESSAGE_COUNT = 20`（R5）、`AVAILABLE_TIMES`（R7の時間帯）、
  chat画面（バナー設置先）、`confirm.ts`、Realtime購読パターン。

### ターゲット前提（2026-07-06 オーナー指示）

中核ターゲットは**45〜65歳の男女**。文言はすべて日本語・大きく・丁寧に。
デート提案の文言も「無理のない、昼間の明るい時間帯から」という安心感を前面に出す。

---

## 2. スコープ

### 2.1 In Scope

| # | 機能 | 対応ルール |
|---|---|---|
| S1 | チャットに「デート打診バナー」（message_count>=20） | R5 |
| S2 | 「会ってみたい」意思の秘匿収集（両者trueまで相手に一切見せない） | R6 |
| S3 | 両想い成立 → 日程候補の提示（平日ランチ・週末午前を上位固定） | R7 |
| S4 | 日程の提案⇄承諾（または別候補の再提案）→ 確定 | - |
| S5 | エリア提案（県庁所在地ベースの簡易ロジック） | SPEC §3.5 |
| S6 | 確定翌日のフィードバック（また会いたい/今回で終わりに） | F-05 |
| S7 | 確定後のキャンセル（確認ダイアログ付き） | SPEC status |
| S8 | ネイティブはExpoローカル通知、Webはアプリ内バナーで翌日フィードバックを促す | F-05 |

### 2.2 Out of Scope（混ぜない）

プッシュ通知（リモート）/ 通話ボタン（M5）/ 課金ゲート（M6）/ カレンダー連携 /
日程候補の空き状況同期 / デート場所の店舗推薦（エリア名の提示まで）

### 2.3 受け入れ条件（SPEC §6 M4）

1. 10往復（20通）で**双方に**打診UIが出る
2. **片方が「今はまだ」でも相手に一切通知・表示されない**（R6）
3. 双方合意 → 日程候補 → 提案⇄承諾 → 確定まで通る
4. 確定翌日にフィードバック入力ができる（E2Eでは confirmed_slot をpsqlで前日に時間移動して検証）

---

## 3. データ設計（migration 1本: `20260707100000_m4_date_proposals.sql`）

### 3.1 既存 date_proposals の直接アクセス遮断（R6の核）

現状のRLS「当事者のみSELECT/INSERT/UPDATE可」では **intent_a/intent_b が相手に見えてしまい R6違反**
（SPEC §3.5 の注記どおり M4 で制御を実装する）。全アクセスをRPC経由に一本化する:

```sql
drop policy "当事者のみ閲覧可" on date_proposals;
drop policy "当事者のみ作成可" on date_proposals;
drop policy "当事者のみ更新可" on date_proposals;
revoke select, insert, update on table public.date_proposals from authenticated;
-- service_role は管理画面用に全権維持（既存GRANTのまま）
```

### 3.2 アクティブ提案は1マッチ1件（部分ユニークインデックス・SPECへの追加）

```sql
create unique index uniq_active_date_proposal
  on date_proposals (match_id) where status not in ('done','cancelled');
```

done/cancelled 後は同じマッチで新しい打診をやり直せる（「また会いたい」の再打診に使う）。

### 3.3 RPC群（すべて security definer・呼び出し元が当事者かを必ず検証）

| RPC | 入力 | 動作 |
|---|---|---|
| `get_date_status(p_match_id)` | - | 自分視点のマスク済み状態を返す（§3.4）。**相手のintentは両者true時以外決して返さない** |
| `set_date_intent(p_match_id, p_intent bool)` | R5検証: `message_count >= 20` | 行をupsertし自分側intentのみ更新。両者trueになったら status='matched' にし、**自動メッセージ**「🎉 お二人とも『会ってみたい』が一致しました。日程を選んでみましょう」を messages に挿入（送信者=操作した本人。既存のRealtimeで両者に届く） |
| `propose_date_slot(p_match_id, p_slot jsonb, p_area text)` | status='matched' or 'scheduling' | proposed_slots に追記・status='scheduling'・area_suggestion更新。slot には `proposed_by` を焼き込む |
| `respond_date_slot(p_match_id, p_accept bool)` | status='scheduling'・**提案者本人は承諾不可** | 承諾→ confirmed_slot=最新提案・status='confirmed'・自動メッセージ「📅 デートが確定しました: {日時}（{エリア}）」。拒否→ 最新提案を取り下げ status='matched' に戻す（別候補は propose を再度呼ぶ） |
| `cancel_date(p_match_id)` | status='confirmed' | status='cancelled' + 自動メッセージ「申し訳ありません、今回の予定は見送らせてください」 |
| `submit_date_feedback(p_match_id, p_feedback text)` | status='confirmed' かつ confirmed_slot の日付 < 今日(JST) | 自分側 feedback_a/b を更新。両者入力済みで status='done'。**相手のフィードバックは本人には返さない**（運営のみ） |

- 各RPCは `grant execute ... to authenticated` を明示（§1の落とし穴: 既定GRANTなし）。
- 自動メッセージは R8 詐欺ワードトリガ・message_count トリガを通常どおり通る（問題なし）。

### 3.4 get_date_status の返却形（jsonb）

```
{ "exists": bool, "status": text|null, "my_intent": bool|null,
  "both_agreed": bool,          -- 両者true時のみtrue。相手intentの単独開示はしない
  "pending_slot": jsonb|null,   -- 最新提案 {date, time_range, label, proposed_by}
  "i_am_proposer": bool,        -- 承諾ボタンの出し分け用
  "confirmed_slot": jsonb|null, "area_suggestion": text|null,
  "my_feedback": text|null, "can_feedback": bool }
```

### 3.5 Realtimeは追加しない（設計判断）

date_proposals はRLS遮断のためRealtime配信不可。相手側への更新伝搬は
**自動メッセージ（既存 messages のRealtime）**が担い、chat画面は messages のINSERTを受けたら
`['date-status', matchId]` も invalidate する。これで「成立」「確定」「キャンセル」は実質リアルタイムに伝わる。

---

## 4. 共有ロジック（packages/shared・Vitest対象）

### 4.1 `date_slots.ts` — 日程候補の生成（R7）

```
generateDateSlots(availA, availB, now, count=6): DateSlot[]
  - 対象: 明後日〜14日後
  - 時間帯: 両者の available_times の共通部分。共通が空なら R7 既定 [weekday_lunch, weekend_am]
  - 並び順: R7 上位固定 = weekday_lunch, weekend_am を先に、その後 weekend_pm, weekday_night
  - ラベル: 「7/12(日) 午前」「7/14(火) ランチ」等（JST・日本語曜日）
DateSlot = { date: 'yyyy-mm-dd', time_range: AvailableTime, label: string }
```

テスト: 共通時間帯の優先 / 共通なし→R7既定 / 並び順の上位固定 / 件数 / 週末・平日の判定境界。

### 4.2 `prefecture_capitals.ts` — エリア提案

47都道府県→県庁所在地の静的マップ + `suggestArea(prefA, prefB)`:
同一県→「{県庁所在地}周辺」/ 異なる県→「{A}〜{B}の間（例: {Aの県庁所在地}・{Bの県庁所在地}）」。
テスト: 同県 / 異県 / 全県マップの件数47。

---

## 5. フロントエンド（apps/mobile）

### 5.1 chat/[matchId] の変更

- `match.message_count >= DATE_PROPOSAL_MESSAGE_COUNT` かつ date status が
  confirmed/cancelled でないとき、メッセージ一覧上部に**打診バナー**:
  「💐 そろそろ会ってみませんか？ → [デートの相談へ]」→ `date/[matchId]` へ遷移
  - 自分が intent=false（今はまだ）でもバナーは小さく残す（文言「気が向いたら『デートの相談』からどうぞ」）
  - R6: バナーの表示は**自分の状態にのみ依存**し、相手の意思は一切反映しない
- status='confirmed' のとき: バナーの代わりに確定表示「📅 {label}・{エリア}」+（翌日以降）フィードバック導線
- `can_feedback=true` のとき: 「昨日のデートはいかがでしたか？」バナー → フィードバックUIへ

### 5.2 新規ルート `date/[matchId]`（デートの相談画面）

status に応じて1画面で出し分け（1画面1主要アクション）:

| 状態 | 表示 | 主要アクション |
|---|---|---|
| 未回答 | 「{相手}さんと会ってみたいですか？」+ 説明「お相手には、お二人の気持ちが一致するまで何も伝わりません」 | [会ってみたい] / [今はまだ]（副） |
| 自分true・相手未/false | 「お気持ちは保存されました。お二人の気持ちが一致したらお知らせします」 | （変更ボタンのみ） |
| matched | 日程候補6件（§4.1）をカードで表示 + エリア提案 | 候補をタップ→[この日程を提案する] |
| scheduling（相手の提案待ち＝自分が提案者） | 「{label} を提案中です」 | [提案を取り下げる]（respond相当は相手のみ） |
| scheduling（自分が承諾側） | 「{相手}さんの提案: {label}」 | [この日程でOK] / [別の日程を見る]（→matched表示に戻して再提案） |
| confirmed | 確定内容 + 注意文（初回は昼間の公共の場所を推奨・金銭の話が出たら通報 等） | [予定を取りやめる]（確認ダイアログ・副） |
| フィードバック可 | 「デートはいかがでしたか？」 | [また会いたい] / [今回で終わりに]（選択後「記録しました」） |

- 通知: 確定時、ネイティブでは `expo-notifications` のローカル通知を翌日10:00にスケジュール
  （Webは未対応のためアプリ内バナーのみ。E2EはWebなのでバナーで検証）。
- typed routes 再生成を忘れない（M3設計書 §1.2-5）。

### 5.3 文言のトーン（ターゲット45〜65）

絵文字は控えめ（💐📅程度）、「デート」を強要しない柔らかい表現、安全への配慮文
（「初回は昼間・人の多い場所がおすすめです」）をconfirmed画面に常設。

---

## 6. 管理画面

M4では**変更なし**（デート状況の管理画面はM6の透明性レポート（dates_confirmed集計）で扱う）。

---

## 7. セキュリティ設計（R6マトリクス）

| 情報 | 本人 | 相手 | 運営(service_role) |
|---|---|---|---|
| 自分のintent | ○（get_date_statusのmy_intent） | **×（両者一致まで完全秘匿）** | ○ |
| 相手のintent | ×（both_agreedでのみ間接的に判明） | - | ○ |
| 提案・確定スロット | ○ | ○（scheduling以降） | ○ |
| フィードバック | 自分の分のみ○ | **×** | ○ |

- date_proposals への直接DML: authenticated は**全面不可**（RPCのみ）。実装後にpsqlで
  `has_table_privilege` を検証すること（M3 §3.8と同じ手法）。
- 全RPCの冒頭で `is_match_participant` 相当の当事者チェック + R5条件を検証する。

---

## 8. テスト・受け入れ計画

### 8.1 単体テスト（Vitest）

- `date_slots`: §4.1の5ケース / `prefecture_capitals`: 3ケース

### 8.2 RLS/APIテスト（本人JWTのREST/RPC）

1. date_proposals への直接SELECT/INSERT → 403
2. 片方だけintent=true の状態で、**相手の get_date_status に痕跡が出ない**（R6の核）
3. 提案者本人が respond_date_slot(accept) を呼ぶ → エラー
4. message_count<20 のマッチで set_date_intent → エラー（R5）

### 8.3 E2E（たかし seed01 × ようこ seed13・message_count=22）

| 受け入れ条件 | 手順 | 期待 |
|---|---|---|
| 1. 打診UI | 両者のchatにバナー表示 | 20通以上のマッチのみ表示（ひろし×みほには出ない） |
| 2. R6秘匿 | ようこ=「今はまだ」→ たかし側のUI/get_date_status | たかし側に変化・通知が一切ない |
| 3. 成立〜確定 | 両者「会ってみたい」→ 自動メッセージ→候補→たかし提案→ようこ承諾 | confirmed + 確定自動メッセージ |
| 4. 翌日FB | confirmed_slot をpsqlで前日に変更 → 両者にFBバナー → 入力 | feedback保存・両者入力でdone。相手のFBは見えない |

### 8.4 完了時の成果物

`docs/acceptance/M4.md` / QUESTIONS.md追記 / 日本語論理コミット / Biome・tsc（mobile/admin）・Vitest全緑

---

## 9. 実装順序

| Phase | 内容 | 目安 |
|---|---|---|
| P1 | migration（RLS遮断・部分unique・RPC6本）+ psql検証 + 型再生成 | 中 |
| P2 | shared: date_slots / prefecture_capitals + Vitest | 小 |
| P3 | date/[matchId] 画面 + chatバナー + 通知 + typed routes | 大 |
| P4 | E2E（8.2/8.3）・受け入れ記録・コミット | 中 |

---

## 10. 設計判断（推奨案。オーナー承認を得てから実装）

| # | 論点 | 推奨案 | 代替案 |
|---|---|---|---|
| 1 | 成立・確定を相手に伝える方式 | **自動メッセージ**（既存Realtime再利用・会話ログにも残り自然） | date_proposalsのポーリングのみ（伝わりが遅い） |
| 2 | 「今はまだ」の扱い | **intent=falseとして保存・相手に完全秘匿・本人はいつでも変更可** | 一定期間再表示しない等の抑制（複雑化） |
| 3 | 確定後のキャンセル | **あり**（確認ダイアログ+自動メッセージ。中高年は予定変更が現実的にある） | MVPではなし |
| 4 | フィードバックの開示範囲 | **相手に見せない（運営のみ）**。「また会いたい」同士でも自動表示せず、再打診は通常フロー | 両者「また会いたい」なら相互表示（気まずさリスク） |
