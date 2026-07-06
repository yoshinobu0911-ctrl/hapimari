# M3 設計書: 検索・いいね・マッチ・メッセージ

> **本書の使い方**: この設計書は、本リポジトリの経緯を知らないAIエージェント（または開発者）が
> M3を単独で実装完遂できるよう書かれた自己完結ドキュメントである。
> 実装前に必ず §1（前提と環境）と §2（スコープ）を読むこと。
> 上位仕様はリポジトリ直下の `SPEC.md`。本書と SPEC.md が矛盾する場合は本書を優先する
> （ユーザーフィードバックによる意図的な変更を含むため）。

---

## 1. 前提と環境（実装開始前に必読）

### 1.1 リポジトリと実行環境

| 項目 | 値 |
|---|---|
| リポジトリ | `C:\Users\haosh\dev\hapimari`（**必ずここで作業。理由は下記⚠1**） |
| モノレポ | pnpm workspaces + Turborepo（`apps/mobile`=Expo SDK 57, `apps/admin`=Next.js 16, `packages/shared`） |
| DB | Supabaseローカル（`supabase start` 済み。Docker Desktop必須） |
| Lint/Format | Biome 2.5（`pnpm exec biome check --write .`） |
| テスト | Vitest（`pnpm --filter @hapimari/shared test`） |
| 進め方 | M3完了時に停止して報告。コミットは論理単位ごと・日本語。受け入れ記録は `docs/acceptance/M3.md` |
| 不明点 | ブロッカーは `QUESTIONS.md` に書いて停止。非ブロッカーは暫定判断を記録して続行 |

### 1.2 ⚠ この環境特有の落とし穴（M0〜M2で実際に発生したもの）

1. **日本語パス禁止**: Supabase CLI は日本語を含むパス（例: OneDriveのデスクトップ）で
   **exit 0のままサイレントに失敗**する。作業は必ず `C:\Users\haosh\dev\hapimari` で行う。
2. **PATHが通っていない**: シェルごとに
   `$env:Path = "C:\Program Files\nodejs;C:\Users\haosh\AppData\Roaming\npm;$env:Path"`（PowerShell）を先頭で実行すること。
3. **新規テーブルにはGRANTが自動付与されない**: このローカルスタック（npm supabase 2.109）では
   既定のDML GRANTが付かない。**テーブルを作ったら必ず明示GRANTをmigrationに書く**
   （`supabase/migrations/20260706010000_explicit_grants.sql` 参照）。忘れるとRESTが403になる。
4. **Realtimeは明示オプトイン**: 配信したいテーブルは
   `alter publication supabase_realtime add table <t>;` が必要（profilesは追加済み）。
5. **expo-router typed routes**: 新しい画面ルートを追加したら、`expo start` を一度起動して
   `.expo/types` を再生成しないと `tsc` がルート文字列で落ちる。
6. **react-native-web の検証時の癖**（ブラウザE2Eを行う場合）:
   - `Alert.alert` はWebで動かない → 既存の `src/lib/confirm.ts` を使う
   - Pressable は単純な `click` イベントに反応しない → pointerdown/up含むイベント列をdispatchする
   - FlatList の仮想化は少件数でも描画を渋ることがある → 固定少数リストは ScrollView+map
7. **pnpm 11**: postinstallを持つ新規依存は `pnpm-workspace.yaml` の `allowBuilds` に追記が必要。
8. **`supabase db reset` はテストユーザーを消す**: seed20名は復元されるが、手動登録ユーザーは消える。
   スキーマ追加は `pnpm exec supabase migration up`（差分適用）を使うこと。
9. migration適用後は型再生成:
   `pnpm exec supabase gen types typescript --local | Out-File -Encoding utf8NoBOM packages\shared\src\types\database.ts`

### 1.3 既存資産（M0〜M2で構築済み・再利用すること）

| 資産 | 場所 | 内容 |
|---|---|---|
| スキーマ | `supabase/migrations/` | SPEC §3 全テーブル + RLS + R1 + message_countトリガ + review_verification |
| 共有辞書 | `packages/shared/src/fraud_words.ts` | 詐欺ワード50語 + `findFraudWords()`（正規化込み） |
| 隣接県 | `packages/shared/src/adjacent_prefectures.ts` | 47都道府県 + `searchArea()`（R10用） |
| 相性 | `packages/shared/src/compatibility.ts` | `calcCompatibility()`（タグ50%重み）+ 表示閾値85% |
| 定数 | `packages/shared/src/constants.ts` | `FEMALE_DAILY_LIKE_LIMIT=20` 等のRルール定数 |
| UI部品 | `apps/mobile/src/components/ui/` | AppButton / AppTextField / ChoiceGroup / Screen / PrefectureField / ValueTagsSelector |
| 認証・状態 | `apps/mobile/src/stores/` `hooks/` | useAuthStore / useMyProfile / RealtimeProfileSync |
| 管理画面 | `apps/admin/` | service_roleクライアント(`lib/supabase-admin.ts`)・レイアウト・審査キュー。reports/users/flagged はプレースホルダ済み |
| seed | `supabase/seed.sql` | 男12女8（全員認証済み・価値観タグ付き）、マッチ2組（1組はmessage_count=22） |
| テストアカウント | - | `seed01〜20@hapimari.test` / `password123`。`test-f34@hapimari.test`（はなこ改・認証済み） |

### 1.4 デザイン原則（ユーザー指示・変更禁止）

1. **価値観マッチングが核**。一覧カードは「写真・名前・年齢・相性%」のみ。**結婚歴・子どもの有無・居住地はカードに出さない**（詳細画面でのみ表示）。
2. **相性%は85%以上のときだけ表示**（`COMPATIBILITY_DISPLAY_MIN`）。
3. **文字を写真に重ねない**。文字は大きく（最小16pt）、画像視認性優先。
4. SPEC §2: ボタン高さ48pt+、タブ4つ、白基調 #C0392B、破壊的操作に確認ダイアログ、UIはすべて日本語。

---

## 2. スコープ定義

### 2.1 In Scope（M3で実装する）

| # | 機能 | 対応ルール |
|---|---|---|
| S1 | フィルタ検索（modal/filter）+ R10隣接県デフォルト | R10 |
| S2 | プロフィール詳細画面（いいね・通報・ブロックの起点） | デザイン原則1 |
| S3 | いいね送信（Edge Function経由・R3ゲート・R4計数） | R3, R4 |
| S4 | マッチ成立（相互いいね→matches作成・DBトリガ） | - |
| S5 | もらったいいね一覧（likesタブ・R4繰越表示） | R4 |
| S6 | Realtimeチャット（マッチ一覧→トーク画面） | R2(送信ゲート・実装済RLSのUI反映) |
| S7 | 詐欺ワード検知（DBトリガでflagged）+ 受信側警告バナー | R8 |
| S8 | 通報・ブロック（modal/report-block + blocksテーブル） | §3.6 |
| S9 | 管理画面: 通報対応 / ユーザー検索・凍結 / flaggedメッセージ一覧 | §5 |

### 2.2 Out of Scope（M3でやらない・混ぜない）

| 機能 | 実装時期 |
|---|---|
| デート打診バナー（message_count>=20）・日程調整・フィードバック | M4 |
| 通話ボタン表示・通話機能（call_unlocked は既にDBが計算） | M5 |
| 課金ゲート（R9: 男性未課金は閲覧のみ）・退会フロー | M6 |
| daily_stats集計・透明性レポート | M6 |
| プッシュ通知（Realtime画面内更新のみでよい） | M4以降 |
| 既読管理・未読バッジ | スコープ外（スキーマに無い。QUESTIONSに追記済みの扱い） |

### 2.3 受け入れ条件（SPEC §6 M3・これを満たしたら停止して報告）

1. seedユーザー2名でマッチ→チャット往復が**Realtimeで**動く
2. **子持ち女性へ理解宣言なし男性のいいねがエラー**になる（R3）
3. **「投資」を含むメッセージで受信側に警告バナー**が出る（R8）

---

## 3. データ設計（migration 1本にまとめる: `2026xxxx_m3_social.sql`）

### 3.1 新規テーブル: blocks（SPEC §3に無いが「ブロック」機能に必須。QUESTIONS.mdに追記すること）

```sql
create table blocks (
  id uuid primary key default gen_random_uuid(),
  blocker uuid references profiles(id) not null,
  blocked uuid references profiles(id) not null,
  created_at timestamptz default now(),
  unique (blocker, blocked),
  check (blocker <> blocked)
);
alter table blocks enable row level security;
create policy "本人のブロックのみ全操作可" on blocks
  for all to authenticated
  using (blocker = auth.uid()) with check (blocker = auth.uid());
grant select, insert, delete on public.blocks to authenticated;   -- ⚠1.2-3 明示GRANT必須
grant all on public.blocks to service_role;
```

### 3.2 新規テーブル: fraud_words（R8トリガの辞書。TS辞書と同期）

```sql
create table fraud_words (word text primary key);
alter table fraud_words enable row level security;   -- ポリシーなし=authenticatedから不可視
grant all on public.fraud_words to service_role;
insert into fraud_words (word) values ('投資'), ('資産運用'), ... ;  -- packages/shared/src/fraud_words.ts の50語をそのまま転記
```

> **同期規約**: 辞書の正は `packages/shared/src/fraud_words.ts`。語を変更する場合はTSとこのテーブル
> （migration追加）を同時に更新する。Vitestに「50語」の件数テストがあるため片方だけの変更は検知される。

### 3.3 相互可視性の遮断（ブロックの両方向反映）

```sql
create or replace function public.is_blocked_between(a uuid, b uuid)
returns boolean language sql stable security definer set search_path = public as $$
  select exists (
    select 1 from blocks
    where (blocker = a and blocked = b) or (blocker = b and blocked = a)
  );
$$;

-- profiles の閲覧ポリシーを差し替え（discover/詳細/likes表示すべてに効く）
drop policy "認証ユーザーはactiveプロフィールと自分を閲覧可" on profiles;
create policy "認証ユーザーはactiveかつ非ブロックのプロフィールと自分を閲覧可" on profiles
  for select to authenticated
  using (
    id = auth.uid()
    or (status = 'active' and not public.is_blocked_between(auth.uid(), id))
  );
```

### 3.4 マッチ成立トリガ（相互いいね→matches作成。挿入経路に依存しない）

```sql
-- 重複防止の正規化規約: user_a = least(uuid), user_b = greatest(uuid)
create or replace function public.create_match_on_mutual_like()
returns trigger language plpgsql security definer set search_path = public as $$
begin
  if exists (select 1 from likes where from_user = new.to_user and to_user = new.from_user) then
    insert into matches (user_a, user_b)
    values (least(new.from_user, new.to_user), greatest(new.from_user, new.to_user))
    on conflict (user_a, user_b) do nothing;
  end if;
  return new;
end $$;
create trigger trg_likes_mutual_match after insert on likes
for each row execute function public.create_match_on_mutual_like();
```

> 既存seedのマッチ2組は (male, female) 順で user_a < user_b を満たしており正規化と整合する。

### 3.5 R8 検知トリガ（messages挿入時にflagged判定）

```sql
create or replace function public.flag_fraud_message()
returns trigger language plpgsql security definer set search_path = public as $$
declare
  normalized text;
begin
  -- TS側 normalizeForFraudCheck と同等: 小文字化 + 全角英数字→半角
  normalized := lower(translate(new.body,
    'ＡＢＣＤＥＦＧＨＩＪＫＬＭＮＯＰＱＲＳＴＵＶＷＸＹＺａｂｃｄｅｆｇｈｉｊｋｌｍｎｏｐｑｒｓｔｕｖｗｘｙｚ０１２３４５６７８９',
    'abcdefghijklmnopqrstuvwxyzabcdefghijklmnopqrstuvwxyz0123456789'));
  if exists (select 1 from fraud_words w where normalized like '%' || w.word || '%') then
    new.flagged := true;
  end if;
  return new;
end $$;
create trigger trg_messages_fraud before insert on messages
for each row execute function public.flag_fraud_message();
```

### 3.6 いいねの直接INSERT禁止（R3/R4はEdge Function経由に一本化）

```sql
drop policy "自分名義のいいねのみ作成可" on likes;
revoke insert on table public.likes from authenticated;
-- select ポリシー（自分が送った/もらった）は既存のまま
```

### 3.7 Realtime配信の追加

```sql
alter publication supabase_realtime add table messages;
alter publication supabase_realtime add table matches;
alter publication supabase_realtime add table likes;
```

> RealtimeはRLSを尊重する（当事者にしか配信されない）。profilesは追加済みなので触らない。

### 3.8 スキーマ変更後の必須作業

1. `pnpm exec supabase migration up`
2. 型再生成（§1.2-9）
3. `docker exec supabase_db_hapimari psql -U postgres -d postgres -c "..."` でGRANT/トリガ/publicationを目視確認

---

## 4. バックエンド設計（Edge Function）

### 4.1 `supabase/functions/like/index.ts`（唯一のEdge Function）

- ランタイム: Deno（Supabase Edge Functions標準）。`verify_jwt` は既定の有効のまま
  （クライアントは `supabase.functions.invoke('like', { body })` で自動的にJWTが付く）。
- 内部では **service_role クライアント**を生成して検証+INSERTを行う
  （env: `SUPABASE_URL` / `SUPABASE_SERVICE_ROLE_KEY` はローカルserveで自動注入される）。

**入力**: `{ toUser: string, message?: string }`（message ≤200字・任意）
**処理順（この順で早期return）**:

| # | 検証 | 失敗時レスポンス(400/403/409) |
|---|---|---|
| 1 | JWTからsender取得。senderのprofile取得（active であること） | 403 `not_active` |
| 2 | 自分自身へのいいね禁止 | 400 `self_like` |
| 3 | 相手profile取得: 存在・active・**異性** | 404 `target_not_found` |
| 4 | `is_blocked_between(sender, toUser)` がtrueなら拒否 | 403 `blocked` |
| 5 | **R3**: 相手が `gender='female' and has_children=true` かつ sender が `gender='male'` の場合、`sender.understands_children=true` でなければ拒否 | 403 `understands_children_required`（メッセージ: 「お子さまのいるお相手へは、プロフィールで『お子さまのいるお相手を理解し、尊重します』を選択した方のみいいねを送れます」） |
| 6 | 重複いいね（unique制約でも守られるが事前チェック） | 409 `already_liked` |
| 7 | likes INSERT（message込み）→ §3.4トリガが相互ならマッチ作成 | - |
| 8 | **R4**: 相手が女性なら直近24hの被いいね数をカウントし、20件超過なら `carriedOver: true` を返す（**拒否はしない**。表示繰越の解釈は §5.4） | - |
| 9 | マッチ成立確認（matchesをSELECT）→ レスポンス | - |

**成功レスポンス**: `{ ok: true, matched: boolean, matchId?: string, carriedOver: boolean }`

**ローカル起動**: `pnpm exec supabase functions serve like`（開発中）。
E2E時は `supabase start` に含まれるfunctionsコンテナでも可（CLIバージョンにより挙動が違うため、
serveで動作すればよい。動かない場合はQUESTIONS.mdに記録して `--no-verify-jwt` 等の回避策を検討）。

**単体テスト**: Edge Function内の判定ロジックは純粋関数
`packages/shared/src/like_rules.ts` に切り出し（`validateLike(sender, target): {ok} | {error}`）、
Vitestでテストする（R3の4象限: 子持ち女×宣言なし男=NG / 宣言あり男=OK / 子なし女=OK / 女→男=OK）。

### 4.2 マッチ成立・R8はDBトリガ（§3.4/3.5）に置く理由

- チャット送信は低レイテンシが必要 → messagesは**RLS直INSERT**を維持（Edge Function経由にしない）
- トリガなら挿入経路（アプリ/seed/管理操作）に依存せず必ず発火する
- ゆえに「いいね=Edge Function（複雑な業務検証）」「メッセージ=RLS+トリガ（速度と単純さ）」で役割を分離

---

## 5. フロントエンド設計（apps/mobile）

### 5.1 画面一覧と追加ルート（expo-router）

| ルート | 新規/変更 | 内容 |
|---|---|---|
| `(tabs)/discover` | 変更 | フィルタボタン追加・フィルタ適用・カードタップ→詳細へ |
| `modal/filter` | **新規** | 検索条件（§5.3）。`presentation: 'modal'` |
| `profile/[id]` | **新規** | プロフィール詳細（§5.2） |
| `(tabs)/likes` | 変更 | もらったいいね一覧（§5.4） |
| `(tabs)/messages` | 変更 | マッチ一覧（§5.5） |
| `chat/[matchId]` | **新規** | トーク画面（§5.6） |
| `modal/report-block` | **新規** | 通報・ブロック（§5.7）。params: `userId`, `nickname` |

> ルート追加後は typed routes 再生成（§1.2-5）を忘れない。

### 5.2 プロフィール詳細 `profile/[id]`

- **ここで初めて事情系の情報を出す**（デザイン原則1）: 写真（大）→ 名前・年齢 → 相性%（85%以上のみ）→
  価値観タグ（VALUE_TAG_LABELSでチップ表示・自分と共通のタグは強調）→ 居住地 → 結婚歴・子どもの有無/同居/子連れデートOK →
  結婚への考え・同居観・金銭観・会える時間帯 → 自己紹介 → バッジ（本人確認/収入/独身）
- 主要アクション（1画面1主要アクション）: **「いいねを送る」**（+任意の一言メッセージ入力欄、200字）
  - すでにいいね済み → ボタンを「いいね済み」無効表示
  - マッチ済み → 「メッセージを送る」（chatへ遷移）に差し替え
  - R3エラー時: Edge Functionのエラーメッセージをそのまま表示（**受け入れ条件2の確認ポイント**）
  - マッチ成立時: 「マッチしました！」ダイアログ → chatへの導線
- 副アクション: 右上「…」→ `modal/report-block` へ
- データ: profiles単取得（RLSによりブロック済み相手は取得できない→「表示できません」画面）

### 5.3 フィルタ検索 `modal/filter` + discover変更

- 条件（SPEC §5の6項目・すべてAND）:
  1. 年齢: 最小/最大（数値入力 or 5歳刻みChoice。既定: 指定なし）
  2. エリア: 既定「**あなたの県+隣接県**」（R10・`searchArea()`使用）。「全国」「県を選ぶ（複数可）」に切替可
  3. 結婚歴: 未婚/離婚/死別（複数可・既定すべて）
  4. 子どもの有無: 気にしない/いる/いない
  5. 結婚観: marriage_intent（複数可）
  6. 会える時間帯: available_times（**1つでも重なれば**ヒット・overlaps）
- 状態管理: zustand `stores/filter.ts`（既定値=R10状態にリセット可能）。discoverのqueryKeyにフィルタを含める
- クエリ組み立て: `apps/mobile/src/lib/discover-query.ts` に純粋関数
  `buildDiscoverFilters(filter, myProfile)` を切り出し（PostgRESTのメソッド適用は薄く保つ）。
  年齢はbirth_dateレンジに変換（`calcAge`の逆算。両端に注意: n歳以上 = birth_date <= today - n years）
- 適用後もソートは**相性降順**（変更しない）。フィルタボタンには適用中件数バッジ（例:「絞り込み中(3)」）

### 5.4 もらったいいね `(tabs)/likes`（R4繰越表示）

- データ: `likes where to_user = me` + 送り主profile（相性計算にも使用）
- **R4の解釈（本設計の決定事項）**: いいね自体は全件保存される。**女性側の表示だけ**「1日20件まで、
  超過分は翌日以降に繰り越して表示」とする（拒否しない）。男性の受信いいねは制限なし。
- 表示判定は純粋関数 `packages/shared/src/like_visibility.ts` に実装しVitestでテスト:
  ```
  assignVisibleDates(likes(created_at昇順), limit=20):
    day = JSTのcalendar date
    各likeに display_date = max(created_atのJST日付, 直前のlikeのdisplay_date) を仮置きし、
    その日の割当が limit を超えたら翌日に繰り越す。
    表示対象 = display_date <= 今日(JST) のもの。明日以降のものは「明日以降に表示されます」件数のみ出す
  ```
- カードUI: 一覧カードと同じ原則（写真・名前・年齢・相性85%+のみ + 一言メッセージがあれば表示）。
  タップ→ `profile/[id]`（いいねを返す→即マッチ）
- Realtime: `likes` INSERT (`to_user=eq.me`) 購読でinvalidate

### 5.5 マッチ一覧 `(tabs)/messages`

- データ: `matches where user_a=me or user_b=me` + 相手profile + 最新メッセージ1件
  （最新メッセージは match_id in (...) で messages を取得しクライアント側で先頭を選ぶ。MVPでは十分）
- 行UI: 相手写真（小・丸）/ 名前 / 最新メッセージ先頭30字 / 日時。**未読バッジは作らない**（Out of Scope）
- タップ→ `chat/[matchId]`
- Realtime: `matches` INSERT/UPDATE + `messages` INSERT を購読しinvalidate

### 5.6 トーク画面 `chat/[matchId]`

- ヘッダ: 相手の名前（タップで `profile/[id]`）
- 本文: messages昇順・自分は右/相手は左の吹き出し。inverted FlatListで最新が下
- **R8警告バナー（受け入れ条件3）**: **受信した**メッセージが `flagged=true` の場合、
  そのメッセージ直下に注意バナーを表示:
  「⚠ 金銭・投資などの話題にご注意ください。お金の話が出たら、運営への通報をご検討ください。」
  （+「通報する」リンク → report-block modal）。送信者自身の画面には出さない
- 送信欄: TextInput + 送信ボタン。`messages` に直接INSERT（RLSが R2/当事者を担保）
  - 未認証（is_verified=false）の場合は送信欄の代わりに
    「メッセージの送信には本人確認が必要です →（証明書類を提出する）」を表示（RLS 403をUIで先回り）
  - 送信失敗（RLS拒否等）はエラートースト表示
- Realtime: `messages` INSERT (`match_id=eq.X`) を購読して即時追加（**受け入れ条件1の核**）
- 通話ボタン: **M3では置かない**（M5）。デート打診バナーも置かない（M4）
- match.message_count はトリガが自動加算（クライアントは触らない）

### 5.7 通報・ブロック `modal/report-block`

- 入口: プロフィール詳細の「…」/ チャットのヘッダメニュー / R8バナーの「通報する」
- 通報: 理由をChoiceGroupで選択（例: 金銭・投資の勧誘 / 既婚の疑い / 不適切な言動 / プロフィール虚偽 / その他）
  + 詳細自由記述（任意）→ `reports` にINSERT（既存RLS/GRANTで可能）→ 「運営が確認します」完了表示
- ブロック: **確認ダイアログ必須**（SPEC §2）→ `blocks` にINSERT →
  以後お互いに discover/詳細/likes に表示されない（§3.3のRLSで両方向遮断）。
  既存マッチ/チャットは残るが相手プロフィールが取得不可になるため「退会またはブロックされたユーザー」表示にフォールバック
- ブロック解除: マイページ「設定」内に「ブロックしたユーザー」一覧（解除ボタン付き）を追加（小さくてよい）

---

## 6. 管理画面設計（apps/admin・service_role）

既存のプレースホルダ3ページを実装に置き換える。実装パターンは
`app/verifications/page.tsx`（Server Component + Server Action + revalidatePath）を踏襲する。

### 6.1 `/reports` 通報対応

- 一覧: status=open を古い順。列: 通報日時 / 通報者 / 対象ユーザー / 理由 / 詳細
- **対象ユーザーごとにopen件数を集計し、3件以上を赤枠強調**（SPEC §3.6の「警告フラグ」は
  専用カラムを追加せず、この強調表示+手動対応で代替する。QUESTIONS.mdに記録）
- アクション（Server Action）:
  - 「対応済みにする」→ status='actioned'
  - 「対応済み+ユーザーを凍結」→ status='actioned' + 対象profiles.status='suspended'
  - 「棄却」→ status='dismissed'
- 対応履歴（actioned/dismissed直近20件）を下部に表示

### 6.2 `/users` ユーザー検索・凍結

- 検索: ニックネーム部分一致（searchParamsでGET。Next 16では `searchParams` は **Promise** なので
  `const { q } = await searchParams` の形で受ける）
- 列: ニックネーム / 性別 / 年齢 / 都道府県 / 認証バッジ / status / 登録日
- アクション: 「凍結」（status='suspended'・確認付き）/「凍結解除」（status='active'）
  - 凍結の効果: discoverから消える（既存RLS）+ メッセージ送信不可（既存RLSのstatus='active'条件）

### 6.3 `/flagged` flaggedメッセージ一覧

- 一覧: `messages where flagged=true` 新しい順50件。列: 日時 / 送信者 / 受信者(マッチの相手) / 本文 / 検知語
  （検知語は表示時に `findFraudWords(body)` をshared からimportして再計算表示してよい）
- アクション: 「送信者を凍結」（Server Action・確認付き）。それ以外の対応は /reports に集約
- ダッシュボード（`/`）のカードに「flaggedメッセージ数」を1枚追加

---

## 7. セキュリティ設計（RLS/GRANT変更マトリクス）

M3適用後の authenticated の権限（変更点のみ。既存は `20260705100000_init.sql` / `20260706010000_explicit_grants.sql` 参照）:

| テーブル | SELECT | INSERT | UPDATE | DELETE | 変更内容 |
|---|---|---|---|---|---|
| profiles | 自分 or (active かつ 非ブロック) | 既存 | 既存 | - | ポリシー差し替え（§3.3） |
| likes | 自分が当事者（既存） | **禁止に変更**（Edge Functionのみ） | - | - | §3.6 |
| blocks | blocker=自分 | blocker=自分 | - | blocker=自分 | 新規（§3.1） |
| fraud_words | 不可 | 不可 | 不可 | 不可 | 新規・service_roleのみ（§3.2） |
| messages / matches / reports | 既存のまま | 既存のまま | - | - | 変更なし |

確認方法（実装後に必ず実行）:
```
docker exec supabase_db_hapimari psql -U postgres -d postgres -c "select has_table_privilege('authenticated','public.blocks','select');" 等
```

---

## 8. テスト・受け入れ計画

### 8.1 単体テスト（Vitest・packages/shared に追加）

| 対象 | ケース |
|---|---|
| `like_rules.ts` | R3の4象限 / 自分いいね / ブロック済み / 同性 |
| `like_visibility.ts` | 20件以内は当日全表示 / 21件目が翌日へ / 複数日跨ぎの累積繰越 / 男性は無制限 |
| `discover-query`のフィルタ変換 | 年齢→birth_dateレンジ両端 / R10既定エリア / 時間帯overlaps |
| fraud_words | 既存テストがそのまま辞書同期の監視になる（50語） |

### 8.2 RLS/APIテスト（curl or psql。M2の docs/acceptance/M2.md の手法を踏襲）

1. likes への直接INSERTが403になる（Edge Function以外を閉じたことの確認）
2. ブロック後、相手のprofilesがSELECTできない（両方向）
3. fraud_wordsがauthenticatedから見えない

### 8.3 E2E（受け入れ条件との対応。ブラウザ2枚=モバイルWeb2セッションで実施）

| 受け入れ条件 | 手順 | 期待結果 |
|---|---|---|
| 1. マッチ→Realtimeチャット | ブラウザA=seed03(ひろし)、B=seed15(みほ)でログイン。Aが詳細からいいね→Bのlikesタブに出る→Bがいいね返し→両者にマッチ表示→チャットで交互に送信 | 相手の画面に**リロードなしで**メッセージが出る |
| 2. R3ゲート | seed05(しんじ・宣言なし)でログイン→子持ち女性(seed13等)の詳細→いいね | エラーメッセージ表示・likesに行が増えない |
| 3. R8バナー | 上記マッチのチャットで「いい投資の話があります」と送信 | **受信側**にのみ警告バナー。DBで flagged=true |
| 追加: R4 | 女性1名に21件のいいねをREST/Functionで連投（男性が12名しかいないため、テスト用male追加はEdge Function経由で21回は不可→**手動seedで男性ユーザーを一時増員するか、limitを一時的に3に下げた状態のロジックテストで代替**。単体テストで20件境界は担保済みのため、E2Eは「単体+視覚確認」でよい） | 繰越表示の文言確認 |
| 追加: R10 | フィルタ未設定のdiscoverが「自県+隣接県」のみ | seed分布（東京/埼玉/千葉）で確認 |
| 追加: ブロック | AがBをブロック→両者のdiscover/likesから相互に消える | 表示されない |

### 8.4 完了時の成果物

1. `docs/acceptance/M3.md`（上表の実測結果・スクリーンショット準拠の記述）
2. `QUESTIONS.md` 追記（blocks表の追加 / R4解釈 / 警告フラグの代替 / その他発見事項）
3. 日本語コミット（論理単位: migration / Edge Function / 画面群 / 管理画面 / 受け入れ）
4. lint（Biome）0エラー・tsc 0エラー（mobile/admin両方）・Vitest全緑

---

## 9. 実装順序（依存関係順・目安）

| Phase | 内容 | 依存 | 目安 |
|---|---|---|---|
| P1 | migration（§3全部）+ 型再生成 + psql検証 | - | 小 |
| P2 | shared: like_rules / like_visibility / discover-query + テスト | P1 |小 |
| P3 | Edge Function like + serve 動作確認（curl） | P1,P2 | 中 |
| P4 | profile/[id] 詳細 + いいね送信 + filterモーダル + discover接続 | P2,P3 | 大 |
| P5 | likesタブ + Realtime購読 | P4 | 中 |
| P6 | messagesタブ + chat/[matchId] + R8バナー | P1 | 大 |
| P7 | report-block modal + ブロック解除設定 | P1 | 中 |
| P8 | 管理画面3ページ + ダッシュボード1カード | P1 | 中 |
| P9 | E2E・受け入れ記録・コミット | 全部 | 中 |

> P4〜P6は互いに独立なので、行き詰まったら順序を入れ替えてよい。
> 各Phase完了時にコミットすること（途中で壊れても戻れるように）。

---

## 10. 未決事項・リスク（実装者への注意）

1. **R4の解釈**（§5.4）: 「上限=拒否」ではなく「表示繰越」とした。プロダクトオーナー（中村さん）の
   確認が取れていない解釈のため、実装後の報告に明記すること。
2. **blocksテーブルはSPEC §3に無い追加**。同様に報告に明記。
3. **Edge Functionのローカル実行**は npm版CLI 2.109 で未検証。`functions serve` が動かない場合は
   QUESTIONS.mdに記録し、代替として同等検証をPostgres関数（RPC）で実装する判断をしてよい
   （その場合も検証ロジックは like_rules.ts と同一仕様にする）。
4. **Realtimeのチャネル数**: 画面ごとに購読を作るとチャネルが増える。unmount時の
   `supabase.removeChannel()` を必ず行う（`RealtimeProfileSync` の実装パターンを踏襲）。
5. チャットの一覧取得はMVP実装（全件→クライアント処理）。パフォーマンス改善はスコープ外。
6. 受け入れE2EでのRN-web操作の癖は §1.2-6 を参照（過去セッションで実証済みのヘルパーがある）。
