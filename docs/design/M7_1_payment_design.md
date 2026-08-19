# M7.1 設計書 — Stripe決済の本実装（サーバー側）

> 承認: 2026-08-11 オーナー（中村さん）。判断①②③④すべて確定済み。
> スコープ: **サーバー側のみ**（DB + Edge Function）。画面（apps/mobile）は M7.2 で実施。
> 前提: Stripeアカウントは**テスト（Sandbox）のみ**。本番審査は未通過のため、本番キーは設定しない。
> 位置づけ: `docs/launch_checklist.md` ②-6 / ②-7 / ②-8 に対応。

---

## 1. 目的

現在の「モック課金」を実際の Stripe 決済に置き換え、あわせて**期間管理と解約**を実装する。

現状の問題（本設計で解消する）:

| 現状 | 問題 |
|---|---|
| `purchase_subscription` RPC を呼ぶと `profiles.subscription_active = true` になる | **お金を払わずに有料機能が使える** |
| フラグを false に戻す経路が存在しない | **一度有料になると永久に有料**。解約も期限切れもない |
| 期限・プラン・請求先の情報を持っていない | 更新・解約・返金対応・問い合わせに一切答えられない |

## 2. 確定した判断

| # | 論点 | 決定 | 理由 |
|---|---|---|---|
| ① | Webhookを受けるサーバー | **Supabase Edge Functions** | シークレットを端末外に置ける／新規契約・デプロイ先が増えない／レビュアー指摘「BEサーバーを一枚挟む」を実質的に満たす |
| ② | 課金形態 | **自動更新サブスクリプション** | LTV最大。ただし**解約導線と更新前通知をセットで実装することが条件** |
| ③ | 課金状態の持ち方 | **`subscriptions` テーブル新設**（Webhookのみ書き込み可） | boolean 1個では期限・プラン・解約予約を表現できない |
| ④ | 決済の起点 | **ブラウザで Stripe Checkout** | アプリ内課金だと Apple/Google に15〜30%徴収される（`launch_checklist` 注記） |

## 3. 料金プラン（2026-07-30 オーナー決定）

| plan ID | 表示名 | 金額（税込） | 請求間隔 | 実質月額 |
|---|---|---|---|---|
| `male_1m` | 1ヶ月プラン | 4,980円 | 1ヶ月ごと | 4,980円 |
| `male_3m` | 3ヶ月プラン | 11,940円 | 3ヶ月ごと | 3,980円 |
| `male_6m` | 6ヶ月プラン | 16,680円 | 6ヶ月ごと | 2,780円 |

- 表向きの推奨は3ヶ月、裏テーマは6ヶ月への誘導（`docs/decisions/2026-07-12_R3撤廃_通話即時解禁.md`）
- 女性は無料。女性プレミア（約500円/月）は将来枠で、本実装の対象外
- 金額は**税込の総額表示**。Stripe側の Price も同額を JPY で登録する（消費税の内税扱い）
- 金額そのものはコードに書かない。Stripe の **Price ID** を環境変数で受け取る（二重管理の防止）

## 4. データモデル

### 4.1 `subscriptions`（新規）

```
user_id                uuid   PK, → profiles.id
stripe_customer_id     text   NOT NULL          Stripeのお客様ID
stripe_subscription_id text   UNIQUE            Stripeの契約ID（決済完了後に確定）
plan                   text   male_1m|male_3m|male_6m
status                 text   Stripeの契約状態をそのまま保持
current_period_end     timestamptz              いつまで利用できるか
cancel_at_period_end   boolean                  解約予約されているか
created_at / updated_at
```

**アクセス制御（最重要）**

- RLS 有効。`select` は**本人の行のみ**、しかも `stripe_customer_id` / `stripe_subscription_id` は GRANT から除外（列単位 GRANT。既存 `profiles` と同じ手法）
- `insert` / `update` / `delete` は **authenticated に一切与えない**
  → **Stripeからの通知（Webhook）経由でしか有料になれない**。利用者が自分で期限を書き換えることは不可能

### 4.2 `stripe_events`（新規・冪等性のため）

処理済みのStripeイベントIDを記録する。Stripeは同じ通知を複数回送ることがある（ネットワーク再送・リトライ）ため、同じイベントを2回処理して二重に期間を延ばす事故を防ぐ。利用者からは完全に不可視（ポリシー無し＋service_roleのみGRANT）。

### 4.3 `profiles.subscription_active` の扱い

**残す。ただし派生値（キャッシュ）に降格する。**

- 既存の RLS・UI・admin が広く参照しているため削除しない
- `subscriptions` へのINSERT/UPDATE/DELETEトリガで**自動同期**する
- 「本当に有効か」の判定は必ず `public.is_subscription_active()` を通す（期限も見る）

### 4.4 課金判定の単一化

```sql
is_subscription_active(uid)
  = subscriptions に status ∈ (active, trialing) かつ current_period_end > now() の行がある
```

既存の `can_caller_message()`（M6.6で導入された単一認可ヘルパ）と messages の INSERT ポリシーを、
両方ともこの関数を参照するように差し替える。**判定ロジックはこの1関数だけ**になる。

> 注: 既存の messages INSERT ポリシーは `subscription_active` をインラインで参照していたため、
> ポリシー側も `can_caller_message()` 呼び出しに統一する。M6.6 のトリガ
> `_enforce_message_entitlement` は同じ関数を見ているので自動的に追従する。

### 4.5 期限切れの二重防御

1. **本命**: `is_subscription_active()` が `current_period_end > now()` を毎回評価する
   → Webhookを取りこぼしても、期限が切れれば自動的に送信不可になる（フェイルセーフ）
2. **補助**: pg_cron で1日1回 `expire_stale_subscriptions()` を実行し、
   期限切れ行の `status` と `profiles.subscription_active` を掃除する（表示用の整合）

## 5. Edge Function（3本）

| 関数 | 認証 | 役割 |
|---|---|---|
| `stripe-checkout` | JWT必須 | 決済ページのURLを発行する |
| `stripe-webhook` | **JWT無し**（署名検証） | Stripeからの決済結果を受けてDBを更新する |
| `stripe-cancel` | JWT必須 | 期間末での解約予約・取り消し |

### 5.1 `stripe-checkout`

入力 `{ plan: 'male_1m'|'male_3m'|'male_6m' }` → 出力 `{ ok: true, url: 'https://checkout.stripe.com/...' }`

事前チェック（**すべて満たさないと決済ページを出さない**）:

1. ログイン済み
2. `status = 'active'`（凍結・退会ユーザーは不可）
3. `gender = 'male'`（女性は無料のため課金させない）
4. **`is_verified = true`（本人確認済み）** ← §8 の暫定判断
5. すでに有効な契約がない（二重課金の防止）

Stripe Customer は初回に作成し `subscriptions.stripe_customer_id` に保存、以降は再利用する。
`client_reference_id` と `metadata.user_id` に Supabase のユーザーIDを載せ、Webhook側で本人を特定する。

### 5.2 `stripe-webhook`

1. 署名を検証（`STRIPE_WEBHOOK_SECRET`）。**検証前に本文を一切信用しない**
2. `stripe_events` に INSERT。すでにあれば「処理済み」として 200 を返して終了（冪等）
3. イベント別処理
   - `checkout.session.completed` … 契約を取得して `subscriptions` を更新
   - `customer.subscription.created / updated / deleted` … 状態・期限・解約予約を同期
   - `invoice.payment_failed` … 支払い失敗をログに残す（状態は subscription.updated が反映）
4. 例外時は 500 を返す → **Stripeが自動でリトライする**（取りこぼし対策）

> Stripe API `2025-03-31.basil` 以降、`current_period_end` は契約本体ではなく
> **契約明細（items）側**に移動している。両方を見るヘルパで吸収する。

### 5.3 `stripe-cancel`

入力 `{ resume?: boolean }`

- 既定（`resume` 無し）: `cancel_at_period_end = true` にする
  → **即座に使えなくなるのではなく、支払い済みの期間の終わりまで利用できる**（返金トラブルの回避）
- `resume: true`: 解約予約を取り消す（「解約したけどやっぱり続けたい」への対応）

## 6. シークレットの管理

Edge Function のシークレットとして設定する。**アプリ（apps/mobile）には1つも入れない。**

| 変数名 | 内容 |
|---|---|
| `STRIPE_SECRET_KEY` | **制限付きキー（`rk_test_...`）を推奨**。必要な権限のみ付与 |
| `STRIPE_WEBHOOK_SECRET` | Webhook署名シークレット（`whsec_...`） |
| `STRIPE_PRICE_MALE_1M` / `_3M` / `_6M` | 各プランの Price ID（`price_...`） |
| `APP_BASE_URL` | 決済後の戻り先URL |

**制限付きキー（Restricted API Key）に必要な権限**: Customers=書き込み / Checkout Sessions=書き込み /
Subscriptions=書き込み / Prices=読み取り。それ以外は「なし」。
万一漏れても返金や送金ができない状態にしておく（Stripe公式の推奨）。

設定手順は `supabase/functions/.env.example` に記載。**値そのものはGitに入れない。**

## 7. リスクと対策

| リスク | 対策 |
|---|---|
| 利用者が自分で有料状態に書き換える | `subscriptions` への書き込み権限を authenticated に与えない（RLS+GRANT） |
| 偽のWebhookで無料で有料化される | 署名検証を必ず通す。検証失敗は400で即終了 |
| 同じ通知を2回処理して期間が二重に伸びる | `stripe_events` による冪等処理 |
| Webhookの取りこぼしで入金済みなのに有料にならない | Stripeの自動リトライ（500を返す）＋ Stripeダッシュボードから手動再送可能 |
| Webhookの取りこぼしで期限切れ後も有料のまま | `is_subscription_active()` が毎回 `current_period_end` を見る（フェイルセーフ） |
| 二重課金 | checkout 発行前に有効契約の有無を確認 |
| 本人確認前に課金して使えない | checkout を `is_verified = true` に限定（§8） |

## 8. 暫定判断（オーナー確認事項・非ブロッカー）

1. **本人確認（is_verified）未完了の男性には決済ページを出さない**
   理由: 支払ってもメッセージを送れず（R2）、返金クレームに直結するため。
   → 逆に「先に課金させたい」方針なら1行で外せる。
2. **`purchase_subscription`（モック課金RPC）は削除する**
   理由: 残すと「無料で有料になれる裏口」がそのまま残るため。
   影響: 画面の「このプランに登録する」ボタンは M7.2 の改修まで一時的にエラーになる。
3. **開発用シードデータ**は `seed.sql` で `subscriptions` に有効行を作る（`seed_cus_*`）。
   Stripe とは無関係のダミーIDのため、本番には流れない。

## 9. M7.2（次スプリント）に送る項目

- `subscription.tsx` を3プラン表示 + Checkout起動 + 期限表示 + 解約ボタンに改修
- 更新3日前のメール事前通知（`launch_checklist` ②-21）
- 支払い方法の変更・領収書（Stripe カスタマーポータルの導入を推奨）
- admin に課金状況の閲覧画面
- 本番キーへの切り替え（Stripe本番審査の通過後）
- 特商法表記への金額・自動更新・解約条件の反映（法務レビューと合わせて）

## 10. レビュー段階（CLAUDE.md §9）

本変更は **(C) 本番公開前レビュー**の対象。委託エンジニアに必ず見てほしい点:

1. `subscriptions` の RLS・GRANT（利用者が書き込めないこと）
2. Webhook の署名検証と冪等処理
3. `is_subscription_active()` と messages RLS の接続（課金ゲートの迂回が無いこと）
4. Stripe の制限付きキーの権限範囲
