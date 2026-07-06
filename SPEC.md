# ハピマリ 実装仕様書 v2.0（AIエージェント実装用）

> **この文書の使い方**: Claude Code / Cursor にこのファイルをリポジトリ直下に `SPEC.md` として置き、
> 「SPEC.md のマイルストーン M0 から順に実装してください。各マイルストーンの受け入れ条件を満たしたら停止して報告してください」と指示する。
> **一括で全部作らせないこと。** マイルストーン単位で進め、人間が動作確認してから次へ進む。

---

## 0. エージェントへの絶対ルール

1. 技術スタックは §1 の指定から変更しない。代替ライブラリを提案しない。
2. 不明点は推測せず、`QUESTIONS.md` に書き出して停止する。
3. 外部サービス（決済・eKYC・通話SDK・プッシュ通知）は §8 のモック方針に従い、必ずインターフェースを切ってモック実装する。本物のAPIキーを要求して止まらない。
4. 各マイルストーン完了時に、受け入れ条件を検証するテスト（またはSeedデータでの手動確認手順）を `docs/acceptance/M{n}.md` に残す。
5. すべてのテーブルに Supabase RLS を設定する。RLSなしのテーブルを作らない。
6. UIテキストはすべて日本語。i18nは不要。
7. コミットはマイルストーン内の論理単位ごとに行い、コミットメッセージは日本語で書く。

---

## 1. 技術スタック（確定・変更禁止）

| レイヤ | 技術 | 備考 |
|---|---|---|
| モバイルアプリ | Expo SDK 最新安定版 / React Native / TypeScript | expo-router使用 |
| 状態管理 | Zustand + TanStack Query | Reduxは使わない |
| バックエンド | Supabase（Auth / Postgres / Storage / Realtime / Edge Functions） | セルフホストしない |
| 管理画面 | Next.js (App Router) / TypeScript / Tailwind | `apps/admin` |
| モノレポ | pnpm workspaces + Turborepo | `apps/mobile`, `apps/admin`, `packages/shared` |
| スキーマ管理 | Supabase migrations（SQLファイル） | `supabase/migrations/` |
| 型共有 | supabase gen types → `packages/shared/types` | |
| テスト | Vitest（ロジック）、Maestro（E2Eは任意） | |
| Lint/Format | Biome | |

## 2. UI/UX基準（中高年向け・全画面共通）

- 最小フォントサイズ 16pt、主要ボタンは高さ48pt以上・タップ領域44pt以上
- 1画面1主要アクション。タブは最大4つ（さがす / お相手から / メッセージ / マイページ）
- ポイント・コイン等の仮想通貨概念を実装しない
- 色: プライマリ #C0392B 系の落ち着いた暖色、背景は白基調。派手なグラデーション・アニメーション禁止
- すべての破壊的操作（ブロック・退会）に確認ダイアログ

## 3. データモデル（Postgres / このまま migration にする）

```sql
-- 3.1 プロフィール（auth.users と 1:1）
create table profiles (
  id uuid primary key references auth.users(id),
  nickname text not null,
  gender text not null check (gender in ('male','female')),
  birth_date date not null, -- 登録時に女性35歳/男性45歳未満を拒否（app側+DB制約）
  prefecture text not null,
  city text,
  marital_history text not null check (marital_history in ('unmarried','divorced','widowed')),
  has_children boolean not null default false,
  children_living_together boolean,
  ok_child_date boolean, -- 子連れデートOK
  marriage_intent text check (marriage_intent in ('asap','within_2y','someday','partner_only')), -- partner_only=籍にこだわらない伴侶
  cohabit_view text,      -- 同居観（自由記述→Phase2で選択式）
  money_view text,
  bio text check (char_length(bio) <= 1000),
  available_times text[] default '{}', -- {'weekday_lunch','weekend_am','weekend_pm','weekday_night'}
  understands_children boolean not null default false, -- 子持ち理解宣言
  understands_remarriage boolean not null default false,
  photo_urls text[] default '{}',
  voice_profile_url text,
  is_verified boolean not null default false, -- F-10 本人確認済み
  income_verified boolean not null default false,
  single_cert_verified boolean not null default false,
  status text not null default 'active' check (status in ('active','suspended','withdrawn')),
  created_at timestamptz default now()
);

-- 3.2 本人確認申請
create table verifications (
  id uuid primary key default gen_random_uuid(),
  user_id uuid references profiles(id) not null,
  kind text not null check (kind in ('identity','income','single_cert')),
  document_url text not null, -- Storage private bucket
  status text not null default 'pending' check (status in ('pending','approved','rejected')),
  reviewed_by uuid, reviewed_at timestamptz, reject_reason text,
  created_at timestamptz default now()
);

-- 3.3 いいね / マッチ
create table likes (
  id uuid primary key default gen_random_uuid(),
  from_user uuid references profiles(id) not null,
  to_user uuid references profiles(id) not null,
  message text check (char_length(message) <= 200),
  created_at timestamptz default now(),
  unique (from_user, to_user)
);

create table matches (
  id uuid primary key default gen_random_uuid(),
  user_a uuid references profiles(id) not null,
  user_b uuid references profiles(id) not null,
  message_count int not null default 0, -- トリガで更新。通話解禁(5往復)・デート打診(10往復)の判定に使用
  call_unlocked boolean generated always as (message_count >= 10) stored, -- 5往復=10メッセージ
  created_at timestamptz default now(),
  unique (user_a, user_b)
);

-- 3.4 メッセージ
create table messages (
  id uuid primary key default gen_random_uuid(),
  match_id uuid references matches(id) not null,
  sender uuid references profiles(id) not null,
  body text not null check (char_length(body) <= 2000),
  flagged boolean not null default false, -- F-33 詐欺ワード検知
  created_at timestamptz default now()
);

-- 3.5 デート打診（F-01〜03, F-05）
create table date_proposals (
  id uuid primary key default gen_random_uuid(),
  match_id uuid references matches(id) not null,
  -- 双方の「会ってみたい」意思。両方trueで成立し相手に見える。片方falseでも相手に通知しない
  intent_a boolean, intent_b boolean,
  status text not null default 'collecting'
    check (status in ('collecting','matched','scheduling','confirmed','done','cancelled')),
  proposed_slots jsonb, -- [{date, time_range}] 昼時間帯を優先表示
  confirmed_slot jsonb,
  area_suggestion text, -- 中間エリア名（MVPでは県庁所在地ベースの簡易ロジック）
  feedback_a text check (feedback_a in ('again','end')), -- F-05
  feedback_b text check (feedback_b in ('again','end')),
  created_at timestamptz default now()
);

-- 3.6 通報・警告
create table reports (
  id uuid primary key default gen_random_uuid(),
  reporter uuid references profiles(id) not null,
  reported uuid references profiles(id) not null,
  reason text not null,
  detail text,
  status text not null default 'open' check (status in ('open','actioned','dismissed')),
  created_at timestamptz default now()
);
-- reported への open通報が3件以上で profiles に警告フラグを立てる（管理画面から手動確定）

-- 3.7 通話ログ（M5）
create table calls (
  id uuid primary key default gen_random_uuid(),
  match_id uuid references matches(id) not null,
  started_at timestamptz, ended_at timestamptz,
  duration_seconds int, -- 900秒(15分)でクライアント側強制終了
  created_at timestamptz default now()
);

-- 3.8 透明性レポート用の日次集計（F-31）
create table daily_stats (
  date date primary key,
  active_male int, active_female int,
  new_matches int, dates_confirmed int, forced_withdrawals int
);
```

**RLS方針**: profiles は本人のみ更新可・認証ユーザーは閲覧可（withdrawn/suspended除外）。messages/matches/date_proposals は当事者のみ。verifications/reports の閲覧・更新は service_role（管理画面）のみ。

## 4. ビジネスルール（コードに落とす判定ロジック）

| ID | ルール | 実装箇所 |
|---|---|---|
| R1 | 登録可能年齢: 女性35歳以上・男性45歳以上（上限なし） | サインアップバリデーション + DB check |
| R2 | is_verified=false のユーザーはメッセージ送信不可 | RLS + UI |
| R3 | has_children=true の女性には understands_children=true の男性のみ「いいね」可能 | likes insert時のEdge Function検証 |
| R4 | 同一女性が24時間に受け取る「いいね」上限100件。超過分は翌日繰越表示（F-40簡易版）※2026-07-06 オーナー決定で20→100に変更 | Edge Function |
| R5 | message_count>=10（5往復）で通話解禁、>=20（10往復）でデート打診バナー表示 | matches.message_count |
| R6 | デート打診は両者 intent=true になるまで相手に一切通知しない | date_proposals |
| R7 | デートプラン提案の時間帯は weekday_lunch / weekend_am を上位固定 | 提案ロジック |
| R8 | メッセージ本文に金銭・投資・外部誘導ワード（辞書は `packages/shared/fraud_words.ts`、初期50語をエージェントが作成）を検知したら flagged=true + 受信者に注意バナー | DBトリガ or Edge Function |
| R9 | 男性は subscription_active=false の場合、メッセージ閲覧のみ・送信不可（MVPはモック課金） | UI + RLS |
| R10 | 検索デフォルトは「居住県＋隣接県」。隣接県マップは静的定義 | 検索クエリ |

## 5. 画面一覧（expo-router のルート）

```
(auth)/welcome, signup, login, onboarding(4step: 基本情報→結婚歴・子ども→価値観→写真)
(verification)/upload   -- 本人確認書類アップロード、審査待ち画面
(tabs)/discover         -- 検索・カード一覧（グリッド表示、スワイプUIにしない）
(tabs)/likes            -- もらったいいね
(tabs)/messages         -- マッチ一覧→トーク画面（通話ボタンは解禁後表示）
(tabs)/mypage           -- プロフィール編集、証明バッジ、設定、退会
modal/filter            -- 検索条件（年齢/エリア/結婚歴/子ども/結婚観/会える時間帯）
modal/date-proposal     -- 「会ってみますか？」→日程候補→確定
modal/date-feedback     -- デート翌日の相互フィードバック
modal/report-block
```

管理画面（apps/admin, Supabase service_role）:
ダッシュボード（daily_stats） / 本人確認審査キュー / 通報対応 / ユーザー検索・凍結 / flaggedメッセージ一覧 / 透明性レポート出力（月次、公開用JSON生成）

## 6. マイルストーン（この順で実装。各完了時に停止して報告）

### M0: 基盤
モノレポ構築、Supabaseローカル環境（supabase start）、migration投入、型生成、CI（lint+test）。
**受け入れ条件**: `pnpm dev` でmobile/adminが起動し、seedスクリプトでダミーユーザー20名（男12女8、東京・埼玉・千葉）が投入される。

### M1: 認証・オンボーディング・プロフィール
サインアップ（メール）、R1年齢制御、4ステップオンボーディング、写真アップロード（Storage）、マイページ編集。
**受け入れ条件**: 新規登録→プロフィール完成→discover に自分以外が表示される。34歳女性・44歳男性の登録が拒否される。

### M2: 本人確認フロー（モック）+ 管理画面審査
書類アップロード→pending→admin画面で承認/却下→is_verified反映。未認証ユーザーのメッセージ送信ブロック（R2）。
**受け入れ条件**: admin承認で即座にアプリ側バッジ表示が変わる（Realtime）。

### M3: 検索・いいね・マッチ・メッセージ
フィルタ検索（R10隣接県込み）、いいね（R3ゲート、R4上限）、マッチ成立、Realtimeチャット、R8詐欺ワード検知、通報・ブロック。
**受け入れ条件**: seedユーザー2名でマッチ→チャット往復がRealtimeで動く。子持ち女性へ理解宣言なし男性のいいねがエラーになる。「投資」を含むメッセージで受信側に警告バナーが出る。

### M4: デート移行支援（差別化の核・最重要）
R5バナー、R6両者合意ロジック、日程候補提示（R7昼優先）、確定、F-05翌日フィードバック（Edge Function + Expoローカル通知）。
**受け入れ条件**: 10往復→双方に打診UI→片方拒否時に相手へ通知が出ないこと→双方合意→日程確定→翌日フィードバック入力までE2Eで通る。

### M5: 音声通話（モックSDK）
`packages/shared/call-provider.ts` にインターフェース定義、MVPはWebRTCのP2Pまたはダミー実装（同一端末2シミュレータで疎通確認できる最小実装）。15分タイマー強制終了、通話前注意ダイアログ、callsログ記録。Agora本実装はキー取得後に差し替え。
**受け入れ条件**: 通話解禁前は通話ボタン非表示。解禁後に発着信→15分で自動切断→ログ記録。

### M6: 課金モック・透明性レポート・仕上げ
subscription_active フラグのモック課金画面（RevenueCat統合ポイントだけインターフェースで用意）、R9制御、daily_stats集計バッチ（pg_cron）、admin月次レポート出力、退会フロー。
**受け入れ条件**: 未課金男性がメッセージ送信不可。adminで当月の透明性レポートJSONが出力される。

## 7. Seedデータ要件
- 男性12名・女性8名。女性のうち5名は35〜45歳バツイチ子持ち設定（シードユーザー層の再現）
- 全員 is_verified=true、写真はプレースホルダ画像
- マッチ済みペア2組（うち1組はmessage_count=22でデート打診可能状態）

## 8. モック方針（外部依存で止まらないための指示）
| 依存 | MVPでの扱い |
|---|---|
| 決済（ストア課金/RevenueCat） | `PaymentProvider` インターフェース + 常にsuccessを返すモック。実装差し替えポイントをREADMEに明記 |
| eKYC（本人確認の自動照合） | 目視審査運用とし、自動照合はなし。管理画面の審査キューが正式フロー |
| 音声通話SDK（Agora） | `CallProvider` インターフェース + 最小WebRTC/ダミー。APIキーは env.example にプレースホルダ |
| プッシュ通知 | Expo Notifications、開発ビルドのローカル通知で代替可 |
| メール送信 | Supabase Auth標準のみ |

## 9. コード生成の対象外（人間のタスク）
- インターネット異性紹介事業の届出、利用規約・プライバシーポリシーの法務レビュー
- App Store / Google Play 申請（出会い系カテゴリは審査要件が厳しい。18+設定必須）
- Agora / RevenueCat / 本番Supabaseの契約とキー発行
- 監視オペレーション（BPO委託）の体制構築
- シードユーザーのリクルーティング

## 10. ディレクトリ構成
```
hapimari/
├── SPEC.md（このファイル）
├── QUESTIONS.md（エージェントの質問置き場）
├── apps/mobile/        # Expo
├── apps/admin/         # Next.js
├── packages/shared/    # 型・定数・fraud_words・adjacent_prefectures
├── supabase/migrations/
├── supabase/functions/ # Edge Functions（like検証、詐欺検知、日次集計）
└── docs/acceptance/    # 各マイルストーンの受け入れ記録
```
