# M7.2 設計書 — 決済の画面側（apps/mobile）

> 状態: **承認済み（2026-08-19 オーナー）・実装済み**。
> 承認結果: §13 の 1・2・4・5 は A案で承認。3（法定表示）は**保留**＝アプリ内画面は作らず、
> BYYコーポレートサイトに特商法ページを掲載する方針（アプリ内リンクは公開前に必ず設置）。
> 4 は「課金の有無に限らず、利用者が他の利用者の個人情報を照会できる経路を残さない」という
> より広い方針としてオーナーが指示（点検結果は §7 の追記）。
> 実装時の暫定判断・差分は §15 実装メモを参照。
> 前提: **M7.1（サーバー側）は実装済み**。本書は実コード
> （`supabase/functions/stripe-*/`・`supabase/migrations/20260811100000_m7_1_stripe_subscriptions.sql`）を
> 読み合わせて書いており、§1 のインターフェースはコードから転記した確定値。
> 参照: `docs/design/M7_1_payment_design.md` ／ `docs/legal/tokushoho.md`
> 位置づけ: `docs/launch_checklist.md` ②-6 / ②-8 の画面部分
> リスクレベル: **高**（決済＝センシティブ領域。CLAUDE.md §6）

---

## 0. ゴールと規模感

現在の `subscription.tsx` はモック課金のままで、M7.1 がモックRPC
`purchase_subscription` を削除したため、**登録ボタンを押すとエラーになる**。
これを実際の Stripe Checkout につなぐ。

完成状態:

1. 未契約の男性: 3プランを選んで Stripe の決済ページへ進める
2. 契約中: プラン名・次回更新日・解約ボタンが見える
3. 解約（期間末）と、その取り消しができる
4. 決済から戻ったとき、結果が正しく表示される（Webhook遅延も破綻しない）
5. 特商法の法定表示（総額・自動更新・解約条件・返金不可・表記へのリンク）を満たす

規模感: **M**（画面1つの全面改修＋API薄層＋法定表示画面3つ＋導線修正2箇所）。
**やらないこと**（M7.3以降）: 支払い方法の変更／領収書（カスタマーポータル）／更新3日前メール通知／adminの課金閲覧／本番キー切り替え。

---

## 1. サーバー側の実インターフェース（実コードから転記・確定）

### 1.1 Edge Function（`supabase.functions.invoke` で呼ぶ。JWTは自動で付く）

| 関数 | 入力 | 成功時 |
|---|---|---|
| `stripe-checkout` | `{ plan: 'male_1m' \| 'male_3m' \| 'male_6m' }` | `{ ok: true, url: string }` |
| `stripe-cancel` | `{}`＝解約予約 ／ `{ resume: true }`＝予約取り消し | `{ ok: true, cancelAtPeriodEnd: boolean, currentPeriodEnd: string \| null }` |

失敗時は共通で `{ ok: false, error: string, message: string }`。
**`message` はそのまま利用者に見せてよい日本語**（画面側で独自文言を作らない）。
エラー取り出しは `lib/like-api.ts` と同じ `FunctionsHttpError.context` 方式で行う。

`stripe-checkout` のエラーコード（`stripe-checkout/index.ts` で確認済みの実文字列）:

| HTTP | error | 意味 | 画面での扱い |
|---|---|---|---|
| 401 | `unauthorized` | 未ログイン | ログインへ誘導 |
| 400 | `invalid_plan` / `invalid_body` | 不正入力 | 通常起きない。message表示 |
| 403 | `not_registered` | プロフィール未登録 | オンボーディングへ誘導 |
| 403 | `not_active` | 凍結・退会 | message表示のみ |
| 403 | `not_required` | 女性 | 到達させない導線にする（§5.4）。万一来たらmessage表示 |
| 403 | **`not_verified`** | 本人確認未完了 | 事前に画面側でも判定し、本人確認へ誘導（§5.3） |
| 409 | `already_subscribed` | 有効契約あり | 契約状態を再取得して契約中表示へ切り替え |
| 500 | `internal` | 予期しない失敗 | message表示 |

`stripe-cancel`: `unauthorized`(401) / `no_subscription`(404) / `already_canceled`(409) / `internal`(500)。

### 1.2 DBから読めるもの（RLS・列単位GRANTで制限済み）

`subscriptions` は**本人の行だけSELECT可**。読める列は次の7つのみ。
`stripe_customer_id` / `stripe_subscription_id` は権限がなく、**`select('*')` は403になる**ため列を必ず明示する。

```
user_id, plan, status, current_period_end, cancel_at_period_end, created_at, updated_at
```

`status` は Stripe の値をそのまま保持:
`incomplete / incomplete_expired / trialing / active / past_due / canceled / unpaid / paused`

> `is_subscription_active` RPC も存在するが、**画面からは使わない**（§7-3 の照会穴のため。
> 判定は上記の行から §2 の導出関数で行う）。

### 1.3 プラン定義・戻りURL

- プランは `packages/shared/src/subscription-plans.ts` の **`PAID_PLANS`** を使う
  （金額・実質月額・`recommended`＝3ヶ月が入っている。金額の正は常にStripeのPrice）。
  旧 `SUBSCRIPTION_PLANS`（`payment-provider.ts`・モック用）は本スプリントで削除する。
- 決済後の戻り先（`stripe-checkout/index.ts` が設定している実URL）:
  - 成功: `${APP_BASE_URL}/subscription?checkout=success&session_id={CHECKOUT_SESSION_ID}`
  - 中断: `${APP_BASE_URL}/subscription?checkout=cancel`
  - `session_id` は**画面では使わない**（シークレット無しには検証できず、検証しない値を信用してはいけないため。§6-4）

---

## 2. 画面の状態モデル（この設計の中心）

`subscriptions` の自分の行（無ければ null）から、画面状態を**1つの純関数**で導出する。
判定ロジックの分散を防ぐため、この関数は `packages/shared` に置いてテストする（§10）。

```
deriveSubscriptionView(row, now) → SubscriptionView

行なし / status ∈ {incomplete, incomplete_expired, canceled}
  → 'none'（未契約）
status ∈ {active, trialing} かつ period_end > now かつ !cancel_at_period_end
  → 'active'（契約中）
status ∈ {active, trialing} かつ period_end > now かつ cancel_at_period_end
  → 'cancel_scheduled'（解約予約済み）
status ∈ {active, trialing} かつ period_end <= now
  → 'none'（期限切れ。Webhook遅延中でもDBの is_subscription_active と同じ判定になる）
status ∈ {past_due, unpaid, paused}
  → 'payment_trouble'（支払いが確認できていない）
```

**`payment_trouble` は既存ドラフトに無かった状態**だが、自動更新がある以上、
カード期限切れ等で更新決済に失敗した会員は必ず発生する（中高年ではむしろ頻出）。
この状態の扱いはサーバー側の1点修正が要るため §9-1 のA/B判断とする。

---

## 3. 画面設計（`subscription.tsx` 全面改修）

共通制約: **16pt未満の文字を作らない／ボタン高さ48pt以上／タップ領域44pt以上**
（theme.ts の `typography` プリセットと `sizes` を使い、fontSize直書きをしない）。
カードは新設の共通部品 `components/ui/` の **Card / Badge / Banner / Section / ListItem** を使う。素の`View`でカードを組まない。

### 3.1 `none`（未契約・プラン選択）

```
[ヘッダー] 有料プラン

┌──────────────────────────────┐
│ 3ヶ月プラン            〔おすすめ〕│ ← recommended:true にBadge
│ 月あたり 3,980円                  │ ← typography.title 相当で大きく
│ 総額 11,940円（3ヶ月ごとに自動更新）│ ← 総額と請求間隔を必ず併記
└──────────────────────────────┘
┌──────────────────────────────┐
│ 6ヶ月プラン                       │
│ 月あたり 2,780円                  │
│ 総額 16,680円（6ヶ月ごとに自動更新）│
└──────────────────────────────┘
┌──────────────────────────────┐
│ 1ヶ月プラン                       │
│ 月あたり 4,980円                  │
│ 総額 4,980円（1ヶ月ごとに自動更新） │
└──────────────────────────────┘

〔このプランで進む〕                 ← 選択中プランで stripe-checkout へ

・料金はすべて税込です。
・契約期間の満了日に自動更新され、同日に決済されます。
・解約はこの画面からいつでも手続きできます（次回更新日の24時間前まで）。
・お客様都合による返金・中途解約はできません。
                                   ↑ 4行は法定表示に直結。省略・要約しない
[特定商取引法に基づく表記] [利用規約] [プライバシーポリシー]  ← §3.5 の画面へ
```

- **表示順は 3ヶ月 → 6ヶ月 → 1ヶ月**、初期選択は3ヶ月
  （表の推奨は3ヶ月・裏テーマは6ヶ月への誘導。並び順がその誘導装置なので変えない）。
- プランカードはラジオボタン相当（`accessibilityRole="radio"`）。カード全体をタップ領域にする。
- 本人確認が未完了の男性には、決済ボタンの代わりに §5.3 の誘導を出す。

### 3.2 `active`（契約中）

```
┌──────────────────────────────┐
│ ご利用中: 3ヶ月プラン              │
│ 次回更新日: 2026年11月14日         │ ← current_period_end をJSTで表示
│ 月あたり 3,980円（総額 11,940円）   │
└──────────────────────────────┘

〔プランを解約する〕      ← variant="secondary"。目立たせない
・解約しても、2026年11月14日まではご利用いただけます。
[特定商取引法に基づく表記] [利用規約] [プライバシーポリシー]
```

### 3.3 `cancel_scheduled`（解約予約済み）

```
┌──────────────────────────────┐
│ ご利用中: 3ヶ月プラン              │
│ 2026年11月14日で終了します         │ ← 「次回更新日」とは言わない
└──────────────────────────────┘

〔解約を取り消す〕        ← { resume: true } を呼ぶ
・2026年11月14日までは、これまでどおりご利用いただけます。
```

### 3.4 `payment_trouble`（支払いが確認できていない）

```
Banner(tone="warning")
  お支払いが確認できませんでした
  カードの有効期限・残高をご確認ください。ご利用を続けるには、
  あらためてプランへの登録が必要です。

（以下、§3.1 と同じプラン選択UI）
```

※ この状態から再登録できるかはサーバー側の挙動に依存する。**§9-1 の判断が必要**。

### 3.5 法定表示の画面（新規3画面）

`docs/legal/` の3書面をアプリ内の静的画面として追加する（§9-3 で判断）。

- `app/legal/tokushoho.tsx` — 特定商取引法に基づく表記
- `app/legal/terms.tsx` — 利用規約
- `app/legal/privacy.tsx` — プライバシーポリシー

内容の正は `docs/legal/*.md`（弁護士レビュー前・`{{ }}` プレースホルダあり）。
画面はそれを写した静的テキスト（ScrollView・16pt以上）。**公開前にプレースホルダを
埋めるのはオーナーのタスク**（launch_checklist 済みの認識どおり）で、M7.2では文面を変えない。

### 3.6 日付の表示

`current_period_end`（UTCのISO文字列）は **JSTの「YYYY年M月D日」** で表示する。
Hermes の `Intl` 差異を踏まないよう、ISO文字列に+9時間して自前整形する小関数を
`subscription-api.ts` に置く（テスト対象）。

---

## 4. 決済フロー

### 4.1 Checkout への遷移

1. プラン選択 →「このプランで進む」
2. **押した瞬間にボタンを無効化**（連打で決済ページを2枚作らせない。§6-1）
3. `stripe-checkout` を invoke → `url` を受け取る
4. ブラウザで開く:
   - **Web: `window.location.href = url`（同一タブ遷移）**。`window.open` はポップアップブロックされるため使わない
   - ネイティブ: `Linking.openURL(url)`（§9-4。新規依存を増やさない。ネイティブの決済動線の仕上げはWeb公開後）
5. エラー時はボタンを再度有効化し、サーバーの `message` を表示

### 4.2 決済から戻ってきたとき（`useLocalSearchParams` で受ける）

| クエリ | 挙動 |
|---|---|
| `checkout=success` | 「お手続きを確認しています…」を表示し、**契約状態をポーリング**（下記） |
| `checkout=cancel` | 「お手続きは完了していません。料金は発生していません。」（Banner・info）を出してプラン選択へ戻す |
| なし | 通常表示 |

**ポーリング**: `subscriptions` を **2秒間隔・最大5回** 再取得し、`view` が
`active` になった時点で成功表示に切り替える。5回で反映されない場合は
「反映まで数分かかる場合があります。しばらくしてからご確認ください」（**エラー扱いにしない**。
課金自体は成功しており、Webhookの遅延・取りこぼしはStripeの自動リトライが埋める）。

処理後は `router.replace('/subscription')` で**クエリを消す**（再読込のたびに
「確認しています」が再発火するのを防ぐ。§6-3）。

成功が確認できたら **`['my-subscription']` と `['my-profile']` の両方を invalidate** する
（チャットのペイウォールは `profiles.subscription_active` を見ているため。§8-1）。

### 4.3 解約・解約の取り消し

1. 「プランを解約する」→ `lib/confirm.ts` の `confirmDialog`:
   「解約すると次回の更新は行われません。{終了日}まではこれまでどおりご利用いただけます。よろしいですか？」
2. `stripe-cancel` を `{}` で invoke
3. 成功したら**レスポンスの `cancelAtPeriodEnd` / `currentPeriodEnd` で即座に画面を更新**し、
   その後にクエリを invalidate（Webhookの同期を待たない。関数側が先にDBへ書き戻す実装であることを確認済み）

取り消しは `{ resume: true }`。確認ダイアログ不要。ボタンはいずれも実行中無効化。

---

## 5. 他画面からの導線

### 5.1 チャットのペイウォール（既存動作の維持）

`chat/[matchId].tsx` は `myProfile.subscription_active !== true` の男性に
「プランを見る」→ `/subscription` を出している（testID: `chat-paywall`）。**変更しない**。
決済成功後にこの画面が送信可能に切り替わることを受け入れ条件に含める（§11-18）。

### 5.2 マイページ

- 男性・契約中: 「有料プラン」の行に**次回更新日をサブテキスト表示**
- 男性・未契約: 現状どおり「有料プランについて」
- **女性: この行を出さない**（§5.4）

### 5.3 本人確認が未完了の男性

`stripe-checkout` は `is_verified=false` を `not_verified` で弾く（サーバー確認済み）。
無駄な往復とエラー表示を避けるため、**画面側でも** `myProfile.is_verified` を見て、
未完了なら決済ボタンの代わりに出す:

```
プランのご登録には、本人確認の完了が必要です。
〔本人確認に進む〕   → /upload
```

サーバー側の弾きはそのまま最後の砦として残る（画面判定はUXのため、防御はサーバーのまま）。

### 5.4 女性

女性は課金対象外のため、この画面へ**到達させない**（マイページの導線を §5.2 で消す）。
万一URL直打ち等で到達した場合は「女性は無料でご利用いただけます」カードのみ表示（現行踏襲）。
決済ボタンは描画しない。サーバーも `not_required` で弾くため二重に安全。

---

## 6. 決済で起きうる事故と防ぎ方（自分で洗い出した結果）

| # | 事故 | 経路 | 防ぎ方（本設計での対応） |
|---|---|---|---|
| 1 | **二重課金（連打）** | 「進む」を連打→Checkoutセッションが複数枚できる | 押下直後にボタン無効化（§4.1）。サーバーも有効契約があれば `already_subscribed` で拒否 |
| 2 | **二重課金（複数タブ・残存セッション）** | 未払いのCheckoutページを2枚開き、両方で支払う／古いセッションを後から支払う | 画面だけでは防げない**残存リスク**。Checkoutセッションは既定で24時間有効なため、`expires_at`（最短30分）をサーバー側で設定して窓を狭める（§9-2・要承認）。発生時はStripeダッシュボードから手動返金 |
| 3 | **戻りURLの取りこぼし** | 支払い後、リダイレクト前にブラウザを閉じる／通信断 | **戻りURLを課金反映に使っていない**ため実害なし（反映は常にWebhook）。次回アプリを開けば契約中と表示される。§4.2のポーリングは表示の遅延を埋めるだけ |
| 4 | **`checkout=success` の偽装** | URL直打ちで成功画面を出す | クエリは**表示のきっかけに過ぎず、権利判定に一切使わない**。最終表示は必ずDBの行から導出（§2）。メッセージ送信可否はDBのRLSが判定するため、画面を騙しても何も得られない |
| 5 | **Webhook遅延で「払ったのに未反映」に見える** | Webhook処理が数秒〜数分遅れる | §4.2 のポーリング＋「反映まで数分」の非エラー表示。恒久的な取りこぼしはStripeの自動リトライ（webhook 500応答時）と日次 `expire_stale_subscriptions` が回収 |
| 6 | **更新決済の失敗（past_due）** | カード期限切れ等。放置すると「払えていないのに使える」or「復帰できない」 | §2 の `payment_trouble` 状態で明示。送信可否は `is_subscription_active()` が期限で自動遮断するため課金ゲートは破れない。再登録の可否は §9-1 |
| 7 | **past_due中の再登録で契約が二重になる** | 現行サーバーは past_due を「有効契約なし」と扱い新規Checkoutを許すため、**旧契約（請求リトライ中）＋新契約の2本がStripe上に併存**し、DBは新しい方で上書きされ旧契約が不可視のまま課金し続ける | **画面だけでは防げない。§9-1 のサーバー1点修正が必要**（本設計で最重要の指摘） |
| 8 | **解約したのに更新された（に見える）** | 解約APIの応答とWebhook同期の競合／画面キャッシュ | 解約はレスポンス値で即時画面更新（§4.3）。特商法表記の「24時間前まで」と画面文言を一致させ、期待値をずらさない |
| 9 | **成功画面の出しっぱなし** | `checkout=success` 付きURLをブックマーク・再読込 | 処理後に `router.replace` でクエリ除去（§4.2） |

## 7. 権限の穴の点検結果（利用者が自分で有料になれる経路の残り）

M7.1 の実コード・migrationを読み合わせて確認した。

| # | 点検箇所 | 結果 |
|---|---|---|
| 1 | `subscriptions` への書き込み | **穴なし**。INSERT/UPDATE/DELETE は authenticated にGRANTされていない。書けるのは service_role（Webhook）のみ |
| 2 | `profiles.subscription_active` の直接更新 | **穴なし**。列単位GRANTにより利用者がUPDATEできる列に含まれない（`init.sql` §grant update で確認）。`gender` も更新不可のため「女性と偽って無料化」も不可 |
| 3 | `is_subscription_active(uuid)` RPC | **小さな穴あり**。authenticated が**任意のuuid**で実行でき、他会員の課金状態（boolean）を照会できる。課金を得る穴ではないが、他人の支払い状況が推測できるプライバシー上の緩み。→ 画面からはこのRPCを使わず、**引数を本人に限定する1行の後続migrationを提案**（§9-5・要承認） |
| 4 | モックRPC `purchase_subscription` | **削除済み**（migration §6）。ただし呼び出し側コード（`lib/payment.ts`・旧`SUBSCRIPTION_PLANS`）が残っており、エラーになるだけとはいえ「無料で有料化するコード」が残置されている。**本スプリントで完全削除**（§10） |
| 5 | Edge Function の認証 | 問題なし。checkout/cancel はJWT必須＋プロフィール資格チェック。webhook のみ `verify_jwt=false` だが署名検証＋冪等処理あり（config.toml・実装で確認） |

**2026-08-19 追加点検（オーナー指示「他の利用者の個人情報を一切照会させない」の拡大確認）**

authenticated が実行できる関数20件（全migrationの `grant execute ... to authenticated` を列挙）を
全件確認した。任意の他人IDを渡して個人情報を引き出せるものは **`is_subscription_active` のみ**で、
これは §9-5 のとおり修正済み（本人以外は行があっても false。ローカルDBで実測確認）。
他のID引数を取る関数は次のとおり照会に使えない:

- `get_profile_distances(uuid[])` … 距離は5km四方に量子化済み（M6.6で三点測位対策を実測検証済み）
- `get_date_status` / date系RPC / `is_match_blocked` … match単位で、当事者チェック・ブロック検証を内蔵（M6.5）
- `is_photo_visible_to` / `is_photo_approved` … 写真パス単位。可視性判定そのものが目的で、M6.6監査済み
- ほかは自分自身への操作のみ（`withdraw_account`・`set_my_location`・`log_user_event` 等）

なお他人のプロフィール項目は M6.5 以降 `profiles_public` ビュー（公開項目＋計算済み年齢のみ・
ブロック相手は非表示）経由でしか取得できず、`profiles` 本体のSELECTは本人の行のみ。

## 8. 既存のRLS・ペイウォールとの接続で壊れうる箇所

| # | 箇所 | 何が起きるか | 対応 |
|---|---|---|---|
| 1 | チャットのペイウォール表示 | ペイウォールは `profiles.subscription_active`（react-queryキャッシュ）を見る。決済成功後に invalidate しないと**払ったのに送信欄が出ない** | §4.2 で `['my-profile']` も必ず invalidate。受け入れ条件 §11-18 |
| 2 | 送信のRLS本体 | `messages` INSERT は `can_caller_message()` → `is_subscription_active()`（期限を毎回評価）。画面の表示状態と食い違っても**最終判定はDB側が正**。期限切れの瞬間は「送信欄は見えるが送るとエラー」があり得る | 送信エラー時にプロフィールを invalidate する既存挙動を確認し、必要なら追随（軽微） |
| 3 | 期限切れの表示 | `subscription_active` フラグの掃除は日次cron。**フラグが最大3日遅れる**設計のため、`deriveSubscriptionView` は期限を自前で評価し（§2）、フラグに依存しない | 実装で担保。§2 の導出テストに期限切れケースを含める |
| 4 | シードデータ | `seed.sql` は `subscriptions` に `seed_cus_*` の有効行を作る。`stripe_subscription_id` がダミーのため**解約ボタンを押すとStripe APIで失敗**する | 検証手順に明記（シードユーザーで解約検証をしない。実Checkoutで作った契約で検証する） |
| 5 | 旧モック定義の削除 | `SUBSCRIPTION_PLANS` は `m6_matching.test.ts` からも参照されており、消すとテストが落ちる | 該当テストを `PAID_PLANS` の検証（§10のテスト）へ置き換え |

---

## 9. 判断が分かれる点（A/B案と推奨）

### 9-1. `past_due`（更新決済の失敗）からの復帰 【サーバー1点修正・要承認】

| 案 | 内容 | 利点 | 欠点 |
|---|---|---|---|
| A | `stripe-checkout` の資格チェックに「既存契約が past_due/unpaid/paused なら**先にStripe上で旧契約をキャンセルしてから**新規Checkoutを作る」を追加（約10行） | 二重契約（§6-7）を根絶しつつ、利用者が自力で復帰できる。失敗した更新請求は支払われていないため、キャンセルで失われる支払い済み期間はない | サーバー側に踏み込む（M7.2の名目スコープ外） |
| B | past_due 中は新規Checkoutをブロックし「お支払いを確認中です。数日後にあらためてお試しください」と表示（Stripeのリトライ失敗→自動キャンセルを待つ） | 変更が最小 | 復帰まで数日〜2週間待たせる。カードを替えたい人が詰む。**現状コードは past_due でも新規Checkoutを許すため、ブロック自体も結局サーバー修正が必要** |
| **推奨: A** | 「画面だけ直しても §6-7 の二重課金経路が残る」ため。restricted key の権限（Subscriptions=書き込み）内で実装可能 | | |

### 9-2. 残存Checkoutセッションの窓（§6-2）【サーバー1行修正・要承認】

| 案 | 内容 |
|---|---|
| A | セッション作成時に `expires_at`＝30分（Stripeの最短）を設定。二重支払いの窓を24時間→30分に縮める。発生時はダッシュボードから手動返金（restricted keyに返金権限を付けない方針は維持） |
| B | Webhook側で「既存の有効契約と異なるsubscription idが来たら新しい方を自動キャンセル」する防御を足す |
| **推奨: A** | Bは「お金を動かすコード」が増えレビュー負担が大きい。発生確率（30分内に2枚のCheckoutを両方支払う）は極小で、手動返金の運用で足りる |

### 9-3. 特商法・規約・ポリシーの掲載方法

| 案 | 内容 |
|---|---|
| A | アプリ内の静的画面3つ（§3.5）。`docs/legal/*.md` を正として写す |
| B | 外部ホスト（取得予定の hapimari.jp 配下）へのリンク |
| **推奨: A** | ドメイン取得・サイト構築を待たずに法定要件「課金画面から1タップ」を満たせる。ドメイン取得後にBへ移すのは容易 |

> **2026-08-19 オーナー判断: 保留（B寄り）**。特商法ページは**BYYコーポレートサイト側に作る**方針。
> M7.2 では §3.1 の法定4行（税込・自動更新・解約期限・返金不可）のみ実装し、リンク行は設置していない。
> **公開前に「課金画面から1タップで表記に到達」できるリンクの設置が法定で必須**
> （`docs/launch_checklist.md` ②-11 に記録済み。BYYサイトのページ公開が前提）。

### 9-4. 決済ページの開き方（ネイティブ）

| 案 | 内容 |
|---|---|
| A | Web: `location.href`／ネイティブ: `Linking.openURL`（外部ブラウザ）。**新規依存なし** |
| B | `expo-web-browser` の `openBrowserAsync`（アプリ内ブラウザ・依存は既にpackage.jsonに存在） |
| **推奨: A** | 公開はWeb先行であり、ネイティブの決済仕上げ（戻りのディープリンク `hapimari://` 対応含む）は後続スプリントでまとめてやる。今はプラットフォーム分岐1行の最小対応に留める |

### 9-5. `is_subscription_active` RPC の照会穴（§7-3）【1行migration・要承認】

| 案 | 内容 |
|---|---|
| A | `p_user = auth.uid()` でない呼び出しは false を返す（service_role は除外）migrationを1本追加 |
| B | 今回は放置し、委託エンジニアレビューの指摘事項リストに載せるだけ |
| **推奨: A** | 修正が数行で終わり、婚活アプリで「誰が課金しているか」は他会員に知られたくない情報のため |

---

## 10. 実装するファイル

| ファイル | 作業 |
|---|---|
| `apps/mobile/src/lib/subscription-api.ts` | **新規**。`fetchMySubscription`（列明示SELECT）／`startCheckout(plan)`／`cancelSubscription()`／`resumeSubscription()`／`formatJstDate`。エラー整形は like-api と同型 |
| `apps/mobile/src/hooks/use-my-subscription.ts` | **新規**。queryKey `['my-subscription', uid]` |
| `packages/shared/src/subscription-view.ts` | **新規**。§2 の `deriveSubscriptionView`（純関数） |
| `apps/mobile/src/app/subscription.tsx` | **全面改修**。§3 の5状態＋§4 のフロー |
| ~~`apps/mobile/src/app/legal/tokushoho.tsx` ほか3画面~~ | **作らない**（§9-3 保留。BYYサイト掲載方針・リンクは公開前に設置） |
| （承認時）`supabase/functions/stripe-webhook/index.ts` | §15-1 の巻き戻し防止ガード（§9-1 の随伴修正） |
| `apps/mobile/src/app/(tabs)/mypage.tsx` | §5.2（女性は行を非表示・契約中は更新日表示） |
| `apps/mobile/src/lib/payment.ts` | **削除**（モック呼び出しの残置をなくす） |
| `packages/shared/src/payment-provider.ts` | **削除**。`index.ts` の再エクスポートから除去 |
| `packages/shared/test/m6_matching.test.ts` | 旧 `SUBSCRIPTION_PLANS` 検証を除去 |
| `packages/shared/test/subscription-view.test.ts` | **新規**。§2 の全分岐＋期限切れ境界＋`PAID_PLANS` の金額整合（総額=月額×月数の検算） |
| （承認時）`supabase/functions/stripe-checkout/index.ts` | §9-1A・§9-2A の追加 |
| （承認時）`supabase/migrations/2026xxxx_m7_2_rpc_hardening.sql` | §9-5A |

## 11. 受け入れ条件

表示: (1) 未契約男性に3プラン・順序3→6→1・初期選択3ヶ月・おすすめBadge
(2) 各プランに月あたり＋総額＋請求間隔 (3) 税込・自動更新・解約期限・返金不可の4行
(4) ~~特商法/規約/ポリシーへのリンクが機能~~（§9-3 保留により対象外。公開前に必須） (5) 契約中: プラン名・次回更新日・解約ボタン
(6) 解約予約済み: 「◯月◯日で終了します」＋取り消しボタン (7) 全文字16pt以上・タップ44pt以上

動作: (8) 選択→Stripeテスト決済ページが開く (9) `4242…` で決済→戻り後ポーリングで契約中表示
(10) Webhook反映前に戻ってもエラーにならない (11) 解約→ §3.3 表示、取り消し→ §3.2 に戻る
(12) 契約中の再決済は `already_subscribed` で止まる (13) 本人確認未完了の男性は本人確認へ誘導
(14) 決済ボタン連打でセッションが2枚できない (15) `checkout=success` 直打ちで契約中にならない
(16) 女性のマイページに有料プラン行が出ない

回帰: (17) shared テスト全緑・biome 0・mobile/admin とも tsc 0
(18) 未課金男性のチャットが従来どおり止まり、**決済成功→invalidate 後に送信欄が出る**

## 12. 検証手順（非エンジニアのオーナー向け）

1. `pnpm exec supabase start` → `supabase/functions/.env` を用意（`.env.example` 参照。値はGitに入れない）
2. `pnpm exec supabase functions serve --env-file supabase/functions/.env`
3. 別ターミナル: `stripe listen --forward-to localhost:54321/functions/v1/stripe-webhook`
4. `pnpm -F mobile exec expo start --web --port 8081`
5. 本人確認済みの男性ユーザーで §11 の 8〜15 を実施。テストカードは `4242 4242 4242 4242`
   （**実在のカード番号は絶対に使わない**。他パターンは `/stripe:test-cards`）
6. 解約系（11）は**実際にテスト決済して作った契約**で行う（シードの `seed_cus_*` はStripeに実体がなく解約APIが失敗する。§8-4）

## 13. オーナー承認が必要な項目（承認の返事だけで進められる形）

| # | 項目 | 推奨 | 承認がないとどうなるか |
|---|---|---|---|
| 1 | §9-1 past_due 復帰（サーバー約10行） | A（旧契約をキャンセルして再登録可に） | 二重課金経路 §6-7 が残る。却下ならBの「ブロックのみ」に縮小 |
| 2 | §9-2 セッション有効期限30分（サーバー1行） | A | 二重支払いの窓が24時間のまま |
| 3 | §9-3 法定表示をアプリ内画面で | A | 特商法の「1タップ到達」を満たす手段が無くなる（何らかの形で必須） |
| 4 | §9-5 RPC照会穴の1行migration | A | 他会員の課金状態を照会できる緩みが残る（レビュー指摘には記載する） |
| 5 | 上記以外の画面実装一式（§3〜§5・§10） | — | 本体。1〜4と独立に承認可 |

金額・プラン構成（2026-07-30決定）と本人確認ゲート（M7.1 §8-1)は**変更しない**。
`expo-web-browser` 等の新規依存追加は**行わない**。

**承認結果（2026-08-19 オーナー）**: 1 = A承認 ／ 2 = A承認 ／ 3 = 保留（§9-3 の追記どおり
BYYサイト掲載方針。アプリ内リンクは公開前に設置） ／ 4 = A承認（「個人情報全般を照会させない」
方針として拡大。§7 追記の全件点検を実施） ／ 5 = 承認。1・2・4・5 は同日実装済み。

## 15. 実装メモ（2026-08-19・設計からの差分と暫定判断）

1. **Webhookに「契約置き換え時の巻き戻し防止」を追加**（`stripe-webhook/index.ts`・暫定判断）。
   §9-1 で旧契約をキャンセルしてから新契約を作るため、「旧契約の終了通知」が「新契約の反映」の
   **後に**届くと、有効な新契約を canceled で上書きし**支払った人が使えなくなる**競合が生まれる。
   行が別の契約IDを指しているとき、無効化系イベントは古い契約の残響として捨てる
   （有効化 active/trialing だけは置き換えとして通す）。§9-1 実装に必然的に伴う修正のため
   停止せず実装し、ここに記録する。別契約IDへの置き換え時は警告ログを残し、
   二重契約の疑い（§6-2）を後から追跡できるようにした。
2. **`formatJstDate` は `packages/shared/src/subscription-view.ts` に置いた**（§10 では
   subscription-api.ts 予定）。mobile にテスト実行環境が無く、shared の vitest でテストするため。
3. **Checkoutの有効期限は「30分＋60秒」**。Stripe の下限がちょうど30分のため、
   サーバー時計のずれで作成時に拒否されないよう60秒の余裕を足した。
4. **法定表示のリンク行は未設置**（§9-3 保留の判断による）。法定4行の脚注のみ実装。
   該当箇所にコードコメントで「BYYサイト公開後に設置・公開前必須」と明記した。
5. **マイページの更新日表示は ListItem の既存 `value` プロップで実装**（部品の改変なし）。
   解約予約中は「◯月◯日で終了」、支払いトラブル中は「お支払いの確認が必要」を出す。
6. **M7.1 のマイグレーションはローカル未適用だった**（`subscriptions` テーブル・型が無い状態）。
   本作業で `migration up` により M7.1 と §9-5 の2本を適用し、型を再生成した。
7. 受け入れ条件 §11-(4)（リンクが機能）は §9-3 保留により**対象外に変更**。
   §11-(7)〜(15) の実決済系は Stripe テストキー未設定（`supabase/functions/.env` 不在）のため
   **未実施**。実施手順は §12 のとおりで、キー設定後にオーナーまたは次セッションで行う。

## 14. レビュー段階（CLAUDE.md §9）

本変更は **(C) 本番公開前レビュー**の対象。委託エンジニアに必ず見てほしい点:

1. 画面が権利判定をしていないこと（表示はDB行の導出のみ・クエリ文字列を信用しない）
2. §9-1 の旧契約キャンセル処理（お金に触る唯一の追加コード）
3. 特商法表示の文言と `docs/legal/tokushoho.md` の一致（弁護士レビューと合わせて）
4. `is_subscription_active` RPC の引数制限（§9-5）
