# ハピマリ 独立レビュー（2026-09-20・Claude Sonnet 5）

Claude Sonnet 5 (claude-sonnet-5) / Claude Code CLI

> 本レビューは `docs/review/2026-09-20_他モデルレビュー依頼プロンプト.md` の指示に従い、
> §4（カバレッジ・指摘一覧・見送った候補・オーナー向けサマリ）を書き終えるまで
> `2026-09-20_AIレビュー原文.md` 他の既存レビュー成果物を一切開かずに実施した（ルール2順守）。
> §5 の突き合わせのみ、原文を読んだ後に追記した。

---

## 4-1. カバレッジ

### 読んだドキュメント
- `CLAUDE.md`（ハピマリ開発憲法。特に §3 Edge Function応答規約、§6 センシティブ領域、§7 禁止事項）
- `SPEC.md`（全文。データモデル §3、ビジネスルール R1〜R10 §4）
- `docs/status-diagnosis-2026-09.md`（2026-09-16時点の全体診断）
- `docs/review/2026-09-02_指摘棚卸し.md`（PR#1 39件の対応状況・意図的見送り一覧）
- `supabase/schema.generated.sql`（4,345行・全文の該当箇所を精読。テーブル定義・RLS・GRANT・関数定義）

### 実装コードで読んだファイル
**A. 決済（優先度A）**
- `supabase/functions/stripe-webhook/index.ts`（全文）
- `supabase/functions/stripe-checkout/index.ts`（全文）
- `supabase/functions/stripe-cancel/index.ts`（全文）
- `supabase/functions/_shared/stripe.ts`（全文）
- `supabase/migrations/20260811100000_m7_1_stripe_subscriptions.sql`（全文）
- `apps/mobile/src/lib/subscription-api.ts`（全文）

**B. 認証・RLS・個人情報（優先度B）**
- `apps/admin/middleware.ts`（全文）
- `apps/admin/lib/admin-auth.ts`（全文）
- `apps/admin/app/{photos,reports,retention,transparency,users,verifications}/actions.ts`（`assertAdminAuth()` 呼び出し箇所を全ファイル確認）
- `supabase/migrations/20260706000000_storage_photos.sql`（初期Storageポリシー）
- `supabase/migrations/20260721100000_m6_5_security_p2.sql`（写真バケット非公開化の該当箇所）
- `supabase/migrations/20260902100000_review2_security_fixes.sql`（全文。写真なりすまし対策・位置情報行ロック・音声URL遮断・エリア名検証・関数ACL総点検・相互いいね競合対策）
- `supabase/schema.generated.sql` の全 `CREATE POLICY` / `ENABLE ROW LEVEL SECURITY` / `GRANT` 行

**C. いいね・マッチ・通話ゲート（優先度C）**
- `supabase/functions/like/index.ts`（全文）
- `supabase/functions/agora-token/index.ts`（全文）
- `packages/shared/src/like_rules.ts`（全文）
- `apps/mobile/src/lib/call-provider-agora.ts`（全文）
- `apps/mobile/src/lib/like-api.ts`（全文）
- `apps/mobile/src/app/call/[matchId].tsx`（全文）
- `supabase/migrations/20260706200000_m3_social.sql`（相互いいねトリガの初期実装）

**D. テストの実効性（気づいた範囲）**
- `scripts/run_sql_tests.sh`（全文。2026-09-20改訂でON_ERROR_STOP・PASS件数突合を追加した経緯を確認）
- `scripts/test_review2_fixes.sql`（冒頭〜T3。実際の例外種別・ACL関数で判定しており恒真アサーションではないことをサンプル確認）

**E. 性能（気づいた範囲）**
- `apps/mobile/src/lib/discover-query.ts`（全文）
- `apps/mobile/src/app/(tabs)/discover.tsx`（呼び出し箇所のみ）
- `supabase/migrations/20260712130000_m6_5_security_p1.sql` の `get_profile_distances`

### 実行したコマンドと結果
| コマンド | 結果 |
|---|---|
| `pnpm run lint`（biome check .） | ✅ 142ファイル、指摘0件 |
| `pnpm -F @hapimari/shared exec tsc --noEmit` | ✅ エラー0件 |
| `pnpm -F @hapimari/mobile exec tsc --noEmit` | ✅ エラー0件 |
| `pnpm -F @hapimari/admin exec tsc --noEmit` | ✅ エラー0件 |
| `pnpm -F @hapimari/shared test`（Vitest） | ✅ 12ファイル・93件全PASS |
| `npx supabase status` → 既に起動済みを確認 | ✅ ローカルSupabase稼働中 |
| `bash scripts/run_sql_tests.sh` | ✅ 4スイート全PASS（test_m65_p1:18件, test_m66_audit_fixes:17件, test_m67_retention:24件, test_review2_fixes:23件。いずれも期待件数と一致・FAIL 0・ERROR 0） |

いずれもドキュメント記載のベースラインと一致した（新規の型エラー・テスト失敗なし）。

### コミット状態の確認
- `git log --oneline -5` の現HEAD: `b5c75dd`（依頼文書記載の `95a4776` より6コミット進んでいる。差分は `git diff --stat 95a4776 HEAD` で確認済みで、SPEC.md微修正・法定ページ更新・SQLテスト基盤の信頼性強化（`run_sql_tests.sh`／`test_m66_audit_fixes.sql`等）・レビュー依頼文書自体の追加のみで、決済・認証・いいね/通話ロジックのコードには変更なし。以下のレビューは現HEAD `b5c75dd` を対象に行った）
- `git status --short`: 未コミットは `.agents/`, `AGENTS.md`（プロジェクト直下）, 他モデルの成果物ファイルのみ。レビュー対象のソースコードに未コミット差分はない

### 見なかった領域・時間の都合で浅く終えた箇所
- **F（文書と実装の整合）**: `docs/launch_checklist.md` / `docs/legal/` / `.env.example` は未確認。`docs/status-diagnosis-2026-09.md` に「`docs/release_web.md`・`docs/launch_checklist.md` が古い」との既存指摘があり、重複調査を避けるためスキップした
- D領域は `run_sql_tests.sh` とテストファイル1本の冒頭のみサンプル確認。全SQLテストファイルの全アサーションは読んでいない
- E領域は discover 画面のみ。いいね一覧・メッセージ一覧のクエリ・Realtime購読の絞り込みは未確認
- Edge Functionの共有コード（`packages/shared`）がホスト環境の `functions deploy` で正しくバンドルされるかは、既知の未対応事項（棚卸し#24）であり、ローカル環境では検証不可能なため再検証していない
- 通話・決済ともに実キー未設定のため、実音声・実決済は検証していない（既知の制約。ルール5によりバグとして報告しない）

---

## 4-2. 指摘一覧

| # | 種別 | 領域 | ファイル:行 | 指摘（1文） | 失敗シナリオ | 根拠 | 修正案 | 確度 |
|---|---|---|---|---|---|---|---|---|
| S1 | must | C（通話） | `apps/mobile/src/lib/call-provider-agora.ts:47-57`, `apps/mobile/src/app/call/[matchId].tsx:21-29` | 【既存ID 4055523953 と一致】通話開始時、Edge Function `agora-token` が返す利用者向け日本語メッセージが握りつぶされ、常に固定の汎用文言に置き換わる | 本人確認未了のユーザーが発信→`agora-token`は403 `not_verified`「本人確認の完了後にご利用いただけます。」を返す→`fetchCallToken`のcatchが理由を捨てて`CallSetupError('error')`に一律変換→画面は`END_REASON_LABEL.error`＝「接続できませんでした。時間をおいてお試しください」のみ表示。ブロック中・相手が確認未了/退会中でも同じ文言になる | 下記#S1参照（コード引用） | `like-api.ts`/`subscription-api.ts`と同じ「`error.context.json()`からmessageを取り出す」パターンを`fetchCallToken`にも適用し、`CallSetupError`にメッセージを持たせて画面表示に使う | 高 |
| S2 | must | E（性能・discover） | `apps/mobile/src/lib/discover-query.ts:28-44,55-72` | discover検索は作成日時降順で先着100件を取得した後にクライアント側で距離フィルタを適用しており、会員数が増えると本来近い候補が無言で検索結果から漏れる | 該当条件の異性が500人存在する状態で「30km以内」検索→まずDBから作成日時順で直近100人だけ取得→その100人だけに距離判定→実際にはもっと近い101人目以降の候補は最初から画面に来ない。エラーも警告も出ないためユーザー・運営双方が気づけない | 下記#S2参照（コード引用） | 距離条件をDB側（緯度経度レンジ or PostGIS）でWHERE句に含めるか、カーソルページネーションを実装する。最低限、100件で打ち切っていることをログに残す | 高（コードは確定。実際に問題化するのは会員数増加後） |
| S3 | suggestion | A（決済） | `supabase/functions/stripe-webhook/index.ts:76-120` | 【既存ID 4055523940 と一致】同一Stripe subscriptionに対する複数Webhookイベントの到着順序が入れ替わった場合、古い状態が新しい状態を上書きしうる | 「past_due→(支払成功)active」の順にStripeが発行したイベントが、ネットワーク遅延で「active→past_due」の順に届くと、実際は有効な契約なのにDBはpast_dueのまま`is_subscription_active()`がfalseになり、課金しているのにメッセージ送信不可になる（逆方向は`current_period_end`の自然失効で最終的に閉じるためフェイルオープンにはならない） | 下記#S3参照（コード引用） | `stripe_events`に`event.created`を保存し、対象行に反映済みの最新`event.created`より古いイベントの適用を防ぐガードを追加する | 中 |
| S4 | suggestion | C（通話ログ） | `supabase/schema.generated.sql:3536` | `calls`テーブルへの直接INSERTを許すRLSポリシーが`is_verified`を検査しておらず、`agora-token`の資格要件より緩い | 本人確認未了のユーザーが`supabase.from('calls').insert(...)`を直接呼べば、実際に音声接続していなくても「通話した」というログ（started_at/duration_seconds）を作れる。実音声への到達経路にはならないが、通話ログ・集計の信頼性が下がる | 下記#S4参照（コード引用） | `calls`のINSERTポリシーにも`is_verified`チェックを追加する | 高 |
| S5 | suggestion | A（決済） | `supabase/functions/stripe-checkout/index.ts:104-161` | チェックアウト開始のTOCTOU（既存契約チェック→Customer作成→DB insert）により、二重送信でStripe Customerが重複作成されうる | ボタン二度押し等でほぼ同時に2リクエストが飛ぶと、両方が`existing===null`を観測しStripe Customerを2つ作成。2件目のDB insertは`user_id`主キー重複で失敗し500を返すが、1件目は正常にCheckout URLを返しうる。実害はStripe側に孤立Customerが残る程度 | 下記#S5参照（コード引用） | 画面側で送信中はボタンを無効化する。またはDB側で`user_id`行を先にupsertしてからCustomer作成に進む順序に変更する | 中 |
| S6 | imo | B（写真審査） | `supabase/migrations/20260902100000_review2_security_fixes.sql:169-186` | `register_photo_for_review`がStorageへの実在確認をしないため、存在しないパスでも審査待ちレコードを作れる | 自分のフォルダ配下の架空パスを指定して呼び出すと、実体のない画像が`photo_reviews`にpending登録される。なりすまし等の実害はなく、審査キューが荒れる程度 | 下記#S6参照（コード引用） | 優先度低。実装するなら`storage.objects`の存在チェックを追加 | 中 |
| S7 | nits | B（DB権限衛生） | `supabase/schema.generated.sql:4315-4316`（および各テーブルのGRANT行、例:4001-4002messages, 3995-3996likes） | `ALTER DEFAULT PRIVILEGES`によりPostgreSQLの`MAINTAIN`権限が`anon`/`authenticated`ロールへ全21テーブルでデフォルト付与されたままになっている | PostgRESTのREST API経由ではVACUUM/ANALYZE/REINDEX等のMAINTAIN系操作は呼び出せないため、標準的なSupabase構成（Data API経由のみ）では実害の到達経路がない。直接Postgres接続や将来のプーラー/レプリカ露出時の防御網としては穴 | 下記#S7参照（コード引用） | `REVOKE MAINTAIN ON ALL TABLES IN SCHEMA public FROM anon, authenticated;`と対応する`ALTER DEFAULT PRIVILEGES ... REVOKE`を追加する | 高（権限の存在は確実）／実害の確度は低 |

### 補足

#### #S1
`agora-token/index.ts` は `not_active`・`not_verified`・`blocked`・`partner_unavailable` の4種類で個別の日本語メッセージを`fail()`で返す設計になっている（CLAUDE.md §3が要求する応答規約どおり）。しかし呼び出し側:
```ts
// apps/mobile/src/lib/call-provider-agora.ts
async function fetchCallToken(matchId: string): Promise<TokenResponse> {
  const { data, error } = await supabase.functions.invoke('agora-token', { body: { matchId } });
  if (error) {
    console.warn('agora-token failed');
    throw new CallSetupError('error');   // ← ここでmessageを一切見ずに捨てている
  }
  return data as TokenResponse;
}
```
```ts
// apps/mobile/src/app/call/[matchId].tsx
const END_REASON_LABEL: Record<CallEndReason, string> = {
  ...
  error: '接続できませんでした。時間をおいてお試しください',   // ← 固定文言
  ...
};
```
同じ「Edge Functionのエラーメッセージをそのまま画面に出す」責務を負う `like-api.ts`（sendLike）と `subscription-api.ts`（invokeStripeFunction）はどちらも `error.context.json()` からmessageを取り出して呼び出し元に返す実装になっており、`call-provider-agora.ts`だけがこのパターンから外れている。

#### #S2
```ts
// apps/mobile/src/lib/discover-query.ts
export function buildDiscoverQuery(filter, me) {
  ...
  return query.order('created_at', { ascending: false }).limit(100);  // ← まず100件に絞る
}
export async function fetchDiscoverProfiles(filter, me) {
  const { data, error } = await buildDiscoverQuery(filter, me);
  const profiles = (data ?? []) as PublicProfile[];
  const distances = await fetchDistances(profiles.map((p) => p.id));  // ← 100件についてのみ距離取得
  const visible = filter.area.mode === 'distance'
    ? applyDistanceFilter(profiles, distances, limitKm, me.prefecture)  // ← 100件の中だけでフィルタ
    : profiles;
  return { profiles: visible, distances };
}
```
`apps/mobile/src/app/(tabs)/discover.tsx` はこの関数を1回呼ぶだけで、ページネーション（「もっと見る」等）は実装されていない。県フィルタ・結婚歴フィルタ等はDBのWHERE句に含まれているため会員数が増えても機能するが、距離フィルタだけは「直近登録100件」という母集団に閉じ込められる。会員1万人規模を想定したレビュー観点（優先度E）に照らすと、検索の中核機能が静かに劣化する設計になっている。

#### #S3
```ts
// supabase/functions/stripe-webhook/index.ts
const entitledIncoming = status === 'active' || status === 'trialing';
const { data: currentRow } = await admin.from('subscriptions')
  .select('stripe_subscription_id').eq('user_id', userId).maybeSingle();
if (currentRow?.stripe_subscription_id && currentRow.stripe_subscription_id !== sub.id && !entitledIncoming) {
  return; // 別契約IDへの置き換え済みなら古いイベントを捨てる
}
// ↑ここは「契約IDが変わった」場合のみ守っている。同一契約IDに対する複数イベントの
//   到着順序（Stripeは順序を保証していない）は検査されず、常に最後に処理した内容で上書きする。
```
`current_period_end`によるフェイルセーフ（期限が切れれば自動的に送信不可へ戻る）があるため「無料なのに使えてしまう」方向の実害はないが、「有料なのに使えなくなる」方向の実害は起こりうる。

#### #S4
```sql
CREATE POLICY "当事者・active・非ブロックのみ記録作成可" ON "public"."calls"
  FOR INSERT TO "authenticated"
  WITH CHECK (("public"."is_match_participant"("match_id")
    AND (NOT "public"."is_match_blocked"("match_id"))
    AND "public"."is_caller_active"()));
```
`is_caller_active()`は`status='active'`だけを見ており`is_verified`は見ていない。一方`agora-token`は本人確認済みであることを必須条件にしている（設計書M8 §3）。

#### #S5
```ts
// supabase/functions/stripe-checkout/index.ts
let customerId = existing?.stripe_customer_id ?? null;
if (!customerId) {
  const customer = await stripe.customers.create({ ... });   // ここが2回同時実行されうる
  customerId = customer.id;
  const { error: insertError } = await admin.from('subscriptions').insert({ user_id: user.id, ... });
  if (insertError) { return internalError(); }               // 2件目はここで失敗するが、Stripe Customerは既に2つ作成済み
}
```

#### #S6
```sql
create or replace function public.register_photo_for_review(p_path text)
returns void
language plpgsql volatile security definer set search_path = public as $$
begin
  if auth.uid() is null then raise exception 'unauthorized'; end if;
  if position(auth.uid()::text || '/' in p_path) <> 1 then raise exception 'invalid_path'; end if;
  insert into photo_reviews (path, user_id) values (p_path, auth.uid())
  on conflict (path) do update set status = 'pending', reviewed_at = null, ai_verdict = null, ai_detail = null;
end;
$$;
```
パスの所有者チェックはあるが、`storage.objects`にその`path`が実在するかは確認していない。

#### #S7
```sql
GRANT MAINTAIN ON TABLE "public"."messages" TO "anon";
GRANT SELECT,MAINTAIN ON TABLE "public"."messages" TO "authenticated";
...
ALTER DEFAULT PRIVILEGES FOR ROLE "postgres" IN SCHEMA "public" GRANT MAINTAIN ON TABLES TO "anon";
ALTER DEFAULT PRIVILEGES FOR ROLE "postgres" IN SCHEMA "public" GRANT MAINTAIN ON TABLES TO "authenticated";
```
`subscriptions`・`stripe_events`のように明示的に`revoke all on table ... from anon, authenticated`を実行したテーブルにはこの権限が残っていない（実測済み）ことから、他の21テーブルはSupabaseの初期デフォルト権限（`GRANT ALL`相当）を個別のREVOKE/GRANTで部分的にしか上書きしていないことが分かる。

---

## 4-3. 見送った候補

- **いいねのレートリミット無し（女性は表示繰越で吸収、男性側は無制限）**: `docs/review/2026-09-02_指摘棚卸し.md` #14で「意図的見送り（レビュアー自身がMVPは許容と明言）」と記録済み。新しい反証根拠はないため再提起しない
- **`prefecture`列にCHECK制約が無い**: 同棚卸し#22で「未対応（enum化と同時に対応予定）」と既に把握・記録済み。新規指摘としては扱わない
- **Realtime購読・Edge Function共有コードのdeploy実測**: 同棚卸し#24/#25で「本番Supabase作成後の実測待ち」と明記済み。ローカル環境では再現できないため見送り
- **`message_count`が往復を保証しない**: 同棚卸し#23で「前提（通話即時解禁・デート20通条件撤廃）が消滅したため実質未使用」と説明済み。実装を読んでも矛盾する新事実は見つからなかった
- **`get_profile_distances`が呼び出し元から任意個数のuser_id配列を受け取れる（バッチでの一括距離取得）**: 三点測位対策（ペア固定ジッター・帯域丸め）はリクエスト回数に依存しない決定的な値を返す設計になっており、バッチ化してもリピート測定による絞り込みが効かないことをコード上確認した。新たな脆弱性とは判断せず見送り
- **Stripe Webhookの`event.livemode`未検証**: テスト/本番キーの混在チェックだが、実キー未設定の現状では検証不能かつ影響が小さいため、見送り候補にとどめた（`must`にはしない）

---

## 4-4. オーナー向けサマリ（非エンジニア向け）

1. 決済・認証・管理画面のセキュリティ設計は全体として堅牢で、今回も致命的な抜け穴は見つかりませんでした。lint・型検査・単体テスト93件・SQL攻撃再現テスト82件はすべて成功しています。
2. 一番気になったのは**通話機能のエラー表示**です。本人確認が済んでいない人が通話しようとすると、本来は「本人確認を先に済ませてください」と表示すべきところが、常に「接続できませんでした」という汎用メッセージになってしまいます（原因は分かってもユーザーには伝わらない状態）。
3. もう一つは**会員が増えたときの検索の見えない不具合**です。今は問題になりませんが、会員数が数百〜数千人規模になると、「近い順」で探しているつもりでも実際には「最近登録した人100人の中」でしか距離を見ておらず、本来もっと近い候補が黙って検索結果から漏れる可能性があります。エラーが出ないため、気づきにくいタイプの不具合です。
4. 決済（Stripe）の仕組みは「払っていないのに有料になる」抜け道は塞がれています。ただし稀に「Webhookの通知が前後して届く」と、払っているのに一時的に使えなくなる可能性がある設計上の細部を見つけました（お金を取りすぎる方向のリスクではありません）。
5. 上記4件はいずれも**すぐに公開を止めるべき水準ではありません**が、1と2は「非エンジニアが気づきにくい静かな不具合」なので、次のスプリントで直すことを推奨します。
6. 残り3件は軽微な改善提案（DB権限の後片付け・二重送信対策など）で、優先度は低いです。

---

## 5. 突き合わせ（§4 完了後に実施）

ここから先は `docs/review/2026-09-20_AIレビュー原文.md`（satoman0703さん・AIレビュー、コメントID付き22件）を読んだ上で追記した。

### 5-1. 既存22件との対応表

| 既存ID | 既存の要点 | あなたの判定 | 理由 |
|---|---|---|---|
| 4055523936 | stripe-webhookは`stripe_events`に「見た」ことしか記録せず「処理済み」を記録していない。`handleEvent`実行中にJS例外を投げずにプロセスごと打ち切られると（実行時間超過等）、行だけ残って処理未完のまま再送が23505で弾かれ続ける | 同意 | 自分も同ファイルを全文読了。209行の`stripe_events` insertはevent.idの存在だけを記録し、`catch`節での`delete`（224行）は「JS例外を投げて`catch`に到達したケース」でしか機能しない。タイムアウト等の強制終了では`delete`が走らずイベントが「処理済み」のまま永続的にストールしうる。`expire_stale_subscriptions()`（m7_1移行173-192行）もStripe側の実データとは突き合わせないため、運用者が気づく手段が無いという指摘は妥当 |
| 4055523940 | stripe-webhookの残響チェックは契約ID置き換え時のみ有効で、同一契約への複数イベントの到着順序（Stripeは保証しない）は検査されず、古い状態が新しい状態を上書きしうる | 補強 | 自分も独立に同じ箇所を発見した（本レビューのS3）。追加情報: `current_period_end`による自動失効のフェイルセーフがあるため、この不具合はフェイルクローズ（無料化・情報漏えいにはならない）であることをコードで確認した |
| 4055523941 | `run_sql_tests.sh`は行頭`FAIL`しか数えず、`ERROR`で全アサーションが空振りしても「全PASS」と表示していた | 補強 | 現HEADの`run_sql_tests.sh`を全文読み、まさにこの指摘ID（4055523941）を名指しした改訂コメントが冒頭にあり、`ON_ERROR_STOP=1`・ERROR行数の計上・スイートごとの期待PASS件数突合が実装済みであることをコードと実行結果（4スイート全PASS・期待件数一致）の両方で確認した。95a4776時点の指摘は正しかったが、現HEAD(b5c75dd)では`e9f4f67`で対応済み |
| 4055523946 | `test_m66_audit_fixes.sql` T3-aは帯域化ロジックを手計算で再実装しており、本番の`get_profile_distances()`を呼んでいないため恒真だった | 補強 | 現在の`test_m66_audit_fixes.sql`143・211行目で実際に本番関数`get_profile_distances()`を呼ぶ形に修正され、158行目に「手計算していたため恒真だった」という修正理由のコメント自体が残っていることを確認した。現HEADでは対応済み |
| 4055523950 | `messages.tsx`に`limit`が無く、`max_rows=1000`到達で古いマッチのプレビューが無言で「マッチしました。挨拶してみましょう」に化ける | 未確認 | `apps/mobile/src/app/(tabs)/messages.tsx`は今回読んでいない。ただし自分は`discover-query.ts`（本レビューS2）で同種の「無言打ち切り」パターンを別画面で独立に発見しており、リポジトリ内に同傾向の箇所が複数あることは示唆される |
| 4055523953 | `call-provider-agora.ts`が`agora-token`の日本語メッセージを捨て、常に固定文言「接続できませんでした。時間をおいてお試しください」になる | 同意（完全一致） | 自分も独立に全く同じ箇所を発見した（本レビューのS1）。`fetchCallToken`のcatch節・`END_REASON_LABEL.error`の固定文言・`like-api.ts`との実装差分まで一致 |
| 4055523959 | `storage.objects`の読み取りポリシーが`is_photo_of_profile`に統一されておらず、旧関数`is_photo_visible_to`を呼ぶポリシーが残っている（3世代の関数が共存） | 未確認 | `storage.objects`の現行ポリシー本文と`is_photo_visible_to`の現存状況を個別に突き合わせていない |
| 4055523963 | `subscription.tsx`からリンクする法定3ページ（特商法・利用規約・プライバシーポリシー）が仮文面のまま公開前チェックから漏れそうに見える | 未確認 | F領域（文書と実装の整合）は時間配分の都合で対象外にした。`docs/status-diagnosis-2026-09.md`にも同種の指摘があり方向性は整合的だが、自分では未検証 |
| 4055523971 | `test_m67_retention.sql`の`count(*) >= 0`は常に真で、対象0件でもPASSになり「本文は消去された」を一度も検証しない | 補強 | 現在の`test_m67_retention.sql`89行目に「count(*) = 0 then 'FAIL: 検証対象のメッセージが0件＝テストが空振りしている'」という明示的なガードが入っており、対象0件は空振りとしてFAILになるよう修正済みであることを確認した |
| 4055523975 | `test_review2_fixes.sql` T6は許可リストとの実際の突合が無く、"一覧を出すだけ"だった | 補強 | 現在の`test_review2_fixes.sql` 176-223行目にT6-b/T6-cとして許可リストとの実突合ロジック（許可リスト外でauthenticated実行可能な関数が0件／許可リスト19本全てが実行可能）が実装されていることを確認した |
| 4055523978 | `test_m66_audit_fixes.sql`の`exception when others`が広すぎ、課金ゲートと無関係な理由での失敗もPASSにしてしまう | 補強 | 現在の該当箇所（60・88行目付近）で`sqlerrm`の値を明示的に検査する形（`if sqlerrm = 'inactive_account' then ...`）に修正済みであることを確認した |
| 4055523986 | `like/index.ts`のis_verifiedゲートが`validateLike`（純粋関数・テスト対象）の外にあり、テストが無い | 同意 | `like/index.ts`と`like_rules.ts`を全文読み、is_verifiedチェックが`LikeRuleUser`/`validateLike`の外（Edge Function本体186-192行付近）に直接書かれておりテスト対象外であることを確認した。ただし`likes`テーブルへの直接INSERT経路が無い（GRANTはSELECTのみ）ため迂回はできないという指摘者自身の評価にも同意する |
| 4055523990 | `likes.tsx`が受信いいねを全件取得してからクライアント側で100件に絞っており、件数が増えるほど重くなる | 未確認 | `apps/mobile/src/app/(tabs)/likes.tsx`は読んでいない |
| 4055523994 | `profiles_public`ビューで`is_caller_active()`がスカラサブクエリに包まれておらず、行ごとに再実行されている可能性がある | 未確認 | ビュー定義（`is_caller_active()`が直接呼ばれている箇所）は確認したが、実際のクエリプラン（EXPLAIN ANALYZE）は検証しておらず判断材料がない |
| 4055524006 | retentionジョブの`photo_reviews`の`user_id`削除に索引が無くseq scanになる | 未確認 | `retention_and_anonymization.sql`のDELETE文と`photo_reviews`の索引一覧を突き合わせていない |
| 4055524014 | `discover-query.ts`の年齢フィルタは`profiles_public`ビューの計算列`age`に対する比較になり、`idx_profiles_status_gender_birth`の`birth_date`列側の索引が効かない | 同意 | `discover-query.ts`で`.gte('age', ...)`/`.lte('age', ...)`が`profiles_public`ビュー相手に発行されていることと、同ビューの`age`列が`(date_part('year', age(birth_date)))::int`という計算式であることの両方を自分で読んで確認した。技術的な筋は妥当と判断する（実際のクエリプラン確認はしていない） |
| 4055524015 | `SPEC.md`のR9（モック課金）・R5（本人確認不要）の記述が実装（Stripe本実装・双方本人確認必須）と食い違ったまま | 同意 | `is_subscription_active()`の実装（m7_1移行）と`agora-token`の双方本人確認チェックの両方を自分で読んでおり、指摘内容と実装の食い違いを確認した |
| 4055524018 | `_shared/stripe.ts`・`agora-token/index.ts`・`like/index.ts`でCORS/JSON応答等の汎用ヘルパが3重に重複しており、`authenticate`の戻り値にも差異がある | 同意 | 3ファイルすべてを全文読んでおり、`corsHeaders`/`json`/`fail`/`internalError`/`requiredEnv`/`adminClient`/`authenticate`の重複と、`authenticate`の戻り値の差（`_shared`は`{id,email}`、`agora-token`は`{id}`のみ）を自分でも確認した |
| 4055524024 | `messages.tsx`のRealtime購読に`filter`が無く、自分が関わるどのマッチに1通入っても一覧全体が再取得される | 未確認 | `messages.tsx`のRealtime購読部分は読んでいない |
| 4055524027 | `admin-auth.ts`と`middleware.ts`に`timingSafeEqual`とBasic認証デコードが実質同一のコードとして重複している | 同意 | 両ファイルを全文読んでおり、指摘どおりの重複を確認した |
| 4055524031 | `docs/review/2026-09-02_指摘棚卸し.md` #37が「意図的見送り」のままだが、`server-only`は`0596540`で既に導入済み | 補強 | `2026-09-02_指摘棚卸し.md`を全文読んだところ、#37の行自体がこの指摘（4055524031）を踏まえて「対応済み（2026-09-08 `0596540`）」に更新され、指摘ID自体への参照コメントまで残っていることを確認した。現HEADでは解消済み |
| 4055524034 | `apps/admin/.env.example`に`PHOTO_MODERATION_API_KEY`が載っていない | 未確認 | `apps/admin/.env.example`の内容を確認していない（F領域は対象外にしたため） |

**集計**: 同意 7件（4055523936, 4055523953, 4055523986, 4055524014, 4055524015, 4055524018, 4055524027）／ 補強 7件（4055523940, 4055523941, 4055523946, 4055523971, 4055523975, 4055523978, 4055524031）／ 未確認 8件（4055523950, 4055523959, 4055523963, 4055523990, 4055523994, 4055524006, 4055524024, 4055524034）／ 反論 0件。

**自分の指摘のうち既存と重複するもの**: S1（4055523953と完全一致）、S3（4055523940と一致）。
**新規指摘**: S2・S4・S5・S6・S7 の5件（discoverの無言打ち切り／callsテーブルのis_verified未検査／stripe-checkoutのCustomer重複作成／写真審査registerの実在チェック欠如／MAINTAIN権限の残置）。

### 5-2. 反論・補強の詳細

**反論**: 該当なし（既存22件のうち、コードと明確に食い違うと判断したものは無かった）。

**補強の詳細**（7件。いずれも「95a4776時点の指摘は妥当だったが、現HEAD b5c75dd では既に修正されている」という同じパターン）:
- 4055523940（stripe-webhookのイベント順序問題）: 唯一「現HEADでも未修正」の補強。フェイルクローズである（無料化・漏えいにはならない）という性質を追加した
- 4055523941 / 4055523946 / 4055523971 / 4055523975 / 4055523978（SQLテストの恒真アサーション5件）: `git diff --stat 95a4776 HEAD`で`scripts/run_sql_tests.sh`・`scripts/test_m66_audit_fixes.sql`・`scripts/test_m67_retention.sql`・`scripts/test_review2_fixes.sql`が実際に変更されていることを確認済みで、コミット`e9f4f67`（「test: SQLテスト基盤の信頼回復（PR#1 指摘 #1〜#5 / P1）」）がこの5件に対応すると判断した。現在の該当ファイルを読み、それぞれ指摘どおりの修正（本番関数呼び出しへの置き換え・sqlerrm明示検査・0件時FAIL化・許可リスト実突合・ERROR行数計上）が入っていることを直接確認した
- 4055524031（棚卸し#37の記載漏れ）: `2026-09-02_指摘棚卸し.md`自体がこの指摘IDを引用する形で既に更新されている

---

