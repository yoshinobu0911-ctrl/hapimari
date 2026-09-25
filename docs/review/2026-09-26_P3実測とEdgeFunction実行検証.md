# P3 実測（I12・I13・I16）と Edge Function 実行検証（2026-09-26 夜間作業）

作成: Claude Opus 5.5（夜間指示書キュー 9・10）。**DB・コードの変更はしていない**（計測はすべてローカル DB のロールバックするトランザクション内、または読み取りのみ）。

## 1. Edge Function の実行検証（キュー 9）

### 結論

- **5関数（like・agora-token・stripe-checkout・stripe-cancel・stripe-webhook）は、ローカルの Edge Runtime（supabase-edge-runtime 1.74.1 / Deno 2.1.4 互換）で起動し、応答することを初めて確認した。**
- ただし **現在の main のままでは `supabase functions serve` 自体が起動しない**。原因は `packages/shared/src/abuse_words.ts:8` の拡張子なし import（`from './fraud_words'`）。Deno は拡張子なしの相対 import を解決できず、`failed to read file: open packages/shared/src/fraud_words: no such file or directory` で全関数のバンドルが止まる。この1行を一時的に `./fraud_words.ts` にすると5関数とも起動した（一時変更はコミットしていない）。
- 本番の `functions deploy like` も同じ理由で失敗する見込み（**本番デプロイは未実施のため推定**）。`like` 以外の4関数は abuse_words を読まないので、個別デプロイなら影響しない可能性があるが未確認。

### 計測した応答（ダミー Agora キー・Stripe キーなし）

| 関数 | OPTIONS | GET | 不正な本文 | `{}` | 偽 JWT |
|---|---|---|---|---|---|
| like | 200＋CORS | 405 | 400 invalid_body | 400 invalid_body | 401 |
| agora-token | 200＋CORS | 405 | 400 invalid_body | 400 invalid_match | 401 |
| stripe-checkout | 200＋CORS | 405 | 400 invalid_body | 400 invalid_plan | 401 |
| stripe-cancel | 200＋CORS | 405 | 404 no_subscription | 404 no_subscription | 401 |
| stripe-webhook | 405＋CORS | 405 | 400 bad_request（署名なし） | 400 | 400 |

正常系: agora-token はダミーキーで 200（トークン `007…` を発行）、like は 200（004→018）。I09・I10・I28・I29 の受け入れ記録に個別の実測がある。

**未検証**: Stripe の実 API を呼ぶ経路（Checkout 作成・Webhook の署名付き処理・解約）。実キーが無いため。

### like 関数の起動不具合の直し方（試した結果・オーナー判断）

| 案 | 内容 | 試した結果 |
|---|---|---|
| A | `abuse_words.ts` の import を `./fraud_words.ts` にし、`allowImportingTsExtensions` を有効化 | shared だけ有効化すると **mobile と admin の tsc が各1件エラー**。3パッケージの tsconfig 変更が必要 |
| **B（推奨）** | 暴言辞書と `findAbuseWords` を `fraud_words.ts` に移し（同じ正規化関数を使うためファイル内で完結）、`abuse_words.ts` は再公開だけにする。like は `fraud_words.ts` から読む | 未実装（設定変更なし・挙動は同じ見込み。既存の暴言フィルタのテスト5件で確認できる） |
| C | 関数ごとの `deno.json` で `"unstable": ["sloppy-imports"]` | **効かない**（CLI のバンドル段階で失敗する。試して元に戻した） |

## 2. P3 実測（キュー 10・変更は提案止まり）

計測条件: ローカル DB に会員 5,000人（男女半々）・写真審査 50,000行を**トランザクション内で**作って計測し、rollback した。

### I13 photo_reviews に user_id の索引が無い

- `delete from photo_reviews where user_id = …`（匿名化で行う削除と同じ条件）: **Seq Scan（全件走査）**。50,010行を読んで10行を削除、実行 **6.8ms**。
- 評価: 5万行でも数 ms。匿名化は日次の少数件なので、**現在の規模で問題は無い**。行数に比例して伸びる。
- 提案（未実装・DB 変更）: `create index concurrently idx_photo_reviews_user_id on photo_reviews(user_id);` を、写真審査が数十万行に近づいた時点で追加する。

### I12 is_caller_active の行ごとの再実行

- 利用者として `profiles_public` の異性 2,512行を読む: **63ms**。実行計画の Filter に `is_caller_active()` と `is_blocked_between(auth.uid(), id)` が**行ごと**に入っている（InitPlan として1回だけの評価になっていない）。
- 評価: 指摘どおり、`is_caller_active()` は読んだ行数だけ呼ばれている。ただし現規模では検索は1回100件（`.limit(100)`）なので、1回あたりの増分は小さい。
- 提案（未実装・ビューの作り直し＝DB 変更）: ビューの条件を `(select public.is_caller_active())` に変えると InitPlan（文ごとに1回）になる。I11 の Storage ポリシーで同じ書き方を採用済み。会員数が増えた段階で、I14/I30（検索 RPC）と一緒に行うのが効率的。

### I16 メッセージの Realtime 購読

- **未計測**。Realtime の配信量は複数ブラウザでの同時接続が必要で、夜間の無人作業では再現できなかった。方針（match_id での filter と再取得の集約）は 2026-09-24 に承認済み。

## 3. 検証コマンドの記録

- Edge Runtime: `pnpm exec supabase functions serve --env-file <スクラッチ領域のダミー env>`（リポジトリ内に .env は作っていない）
- P3: 上記の計測 SQL はスクラッチ領域に置いた一時ファイル（リポジトリに入れていない）。再現する場合は「会員5,000人・写真5万行を作って EXPLAIN ANALYZE」の手順で同じ結果が得られる。
