# ハピマリ 引き継ぎ書（セッション間ハンドオフ）

最終更新: 2026-07-06 / 対象: 次に実装を引き継ぐAIエージェント（Fable 5 等）とオーナー

> このファイルだけ読めば「今どこまでできていて、次に何をすればいいか」が分かるように書いてある。
> 詳細な規約は `CLAUDE.md`（開発憲法）、上位仕様は `SPEC.md`、M3の実装手順は `docs/design/M3_design.md`。

---

## 0. 30秒サマリ

- **プロダクト**: ハピマリ = 中高年向け再婚・パートナー探しマッチングアプリのMVP（女性35歳+/男性45歳+）。株式会社BYY（オーナー中村さんの個人事業）。
- **現在地**: **M0・M1・M2・M3 完了**（動く）。M4〜M6 は未着手。
- **リポジトリ**: `C:\Users\haosh\dev\hapimari`（**日本語パス禁止の事情でここに置いてある。§3参照**）
- **次にやること**: M4（デート移行支援・差別化の核）の設計書作成 → オーナー承認 → 実装。
  M3の受け入れ記録は `docs/acceptance/M3.md`、暫定判断は `QUESTIONS.md` Q6〜Q11。
- **進め方**: マイルストーン単位。各完了で停止・オーナー報告。コミットは日本語・論理単位。

---

## 1. プロダクト概要

- 価値観マッチングが核。センシティブ属性（離婚/死別/子ども有無）で第一印象を決めさせない設計。
- 主要機能: プロフィール、本人確認（目視審査）、検索、いいね/マッチ、チャット、デート移行支援（M4が差別化の核）、音声通話（M5）、課金（M6）。
- UI基準: 中高年向け。最小フォント16pt、ボタン48pt+、白基調＋プライマリ #C0392B、タブ最大4つ、破壊的操作に確認ダイアログ、UIは全日本語。

---

## 2. 技術スタック（SPEC §1・変更禁止）

| レイヤ | 技術 |
|---|---|
| モバイル | Expo SDK 57 / React Native / TypeScript / expo-router |
| 状態管理 | Zustand + TanStack Query（Reduxは使わない） |
| バックエンド | Supabase（Auth / Postgres / Storage / Realtime / Edge Functions） |
| 管理画面 | Next.js 16（App Router）/ TypeScript / Tailwind（`apps/admin`） |
| モノレポ | pnpm workspaces + Turborepo（`apps/mobile`, `apps/admin`, `packages/shared`） |
| Lint/Format | Biome 2.5 / テスト: Vitest |

---

## 3. ⚠ この環境の必須知識（実際にハマった落とし穴・最重要）

1. **日本語パス禁止**: Supabase CLI は日本語を含むパス（OneDrive/デスクトップ等）で **exit 0 のままサイレント失敗**する。作業は必ず `C:\Users\haosh\dev\hapimari`。
2. **PATH補正が毎シェル必要**: PowerShellの先頭で
   `$env:Path = "C:\Program Files\nodejs;C:\Users\haosh\AppData\Roaming\npm;$env:Path"`。
   node/pnpm/supabaseはこれを通さないと「認識されない」エラーになる。
3. **新規テーブルはGRANTが自動付与されない**（npm supabase 2.109）。テーブルを作ったら
   **RLS + 明示GRANTをmigrationにセットで書く**。忘れるとRESTが403。参考: `supabase/migrations/20260706010000_explicit_grants.sql`。
4. **Realtimeは明示オプトイン**: 配信したいテーブルは `alter publication supabase_realtime add table <t>;`。
   （現状 profiles のみ追加済み）。
5. **スキーマ反映は `pnpm exec supabase migration up`**（差分適用）。`supabase db reset` は
   seed20名は戻るが**手動登録ユーザーを消す**。
6. **migration適用後は型再生成**:
   `pnpm exec supabase gen types typescript --local | Out-File -Encoding utf8NoBOM packages\shared\src\types\database.ts`
7. **expo-router typed routes**: 新しい画面ルートを追加したら `expo start` を一度起動して
   `.expo/types` を再生成しないと `tsc` がルート文字列で落ちる。
8. **react-native-web でE2E検証する時の癖**:
   - `Alert.alert` はWebで動かない → `apps/mobile/src/lib/confirm.ts` を使う
   - Pressableは単純clickに反応しない → pointerdown/up含むイベント列をdispatch
   - FlatListは少件数でも描画を渋る → 固定少数は ScrollView+map
9. **pnpm 11**: postinstallを持つ新規依存は `pnpm-workspace.yaml` の `allowBuilds` に追記が必要。
10. **git**: 改行警告(CRLF)が出るが正常。コミットは `git -c core.safecrlf=false commit` で通している。
    ユーザー名/メールは設定済み（Yoshinobu Nakamura / im.claude1@meetsmore.com）。

---

## 4. リポジトリ構成

```
hapimari/
├── CLAUDE.md            # 開発憲法（働き方ルール・承認ゲート・センシティブ領域）★必読
├── SPEC.md              # 上位仕様（技術/データモデル/Rルール/マイルストーン）
├── QUESTIONS.md         # 未解決・暫定判断の記録
├── apps/mobile/         # Expo（src/app 配下がexpo-routerのルート）
├── apps/admin/          # Next.js 16 管理画面（service_roleで動作）
├── packages/shared/     # 型・定数・fraud_words・adjacent_prefectures・compatibility・value_tags
├── supabase/migrations/ # スキーマ（RLS込み・下記5本が適用済み）
├── supabase/seed.sql    # ダミーデータ
└── docs/
    ├── design/M3_design.md          # M3実装設計書（自己完結）★次の作業の主資料
    ├── decisions/2026-07-06_M3設計判断.md  # オーナー承認済みの設計判断
    ├── acceptance/M0.md, M1.md, M2.md      # 各マイルストーン受け入れ記録
    └── HANDOFF.md                    # このファイル
```

適用済みmigration（5本）:
`20260705100000_init`（全テーブル+RLS+R1年齢制約+message_countトリガ）/
`20260706000000_storage_photos`（写真バケット）/
`20260706010000_explicit_grants`（明示GRANT）/
`20260706020000_value_tags`（価値観タグ列）/
`20260706100000_m2_verification`（本人確認バケット・審査関数・profiles Realtime）

---

## 5. マイルストーンの状態

| MS | 内容 | 状態 |
|---|---|---|
| M0 | モノレポ・DB・RLS・seed・CI | ✅ 完了 |
| M1 | 認証・4ステップオンボーディング・discover・マイページ | ✅ 完了 |
| M1改 | 価値観タグ30個・相性スコア・カード刷新（写真/名前/年齢/相性）・相性85%以上のみ表示 | ✅ 完了（オーナーFB対応） |
| M2 | 本人確認フロー（書類提出→管理画面審査→承認Realtime反映）・R2送信ゲート | ✅ 完了 |
| M3 | 検索・いいね・マッチ・メッセージ・通報ブロック・管理画面3枚 | ✅ 完了（受け入れ: docs/acceptance/M3.md） |
| **M4** | **デート移行支援（差別化の核）** | **未着手（次はここ・設計書から）** |
| M5 | 音声通話（モックSDK） | 未着手 |
| M6 | 課金モック・透明性レポート・退会 | 未着手 |

---

## 6. 実装済みの重要な設計・資産（再利用すること）

### 6.1 デザイン原則（オーナー指示・変更禁止）
1. 一覧カードは「写真・名前・年齢・相性%」のみ。**結婚歴・子ども有無・居住地はカードに出さない**（詳細画面のみ）。
2. **相性%は85%以上のときだけ表示**（`COMPATIBILITY_DISPLAY_MIN=85`）。
3. **文字を写真に重ねない**。文字は大きく、画像視認性優先。

### 6.2 packages/shared の再利用資産
- `fraud_words.ts`: 詐欺ワード50語 + `findFraudWords()`（正規化込み）
- `adjacent_prefectures.ts`: 47都道府県 + `searchArea()`（R10隣接県）
- `compatibility.ts`: `calcCompatibility()`（タグ一致50%重み）+ 表示閾値85%
- `value_tags.ts`: 価値観タグ30個（6カテゴリ）
- `constants.ts`: Rルール定数（`FEMALE_DAILY_LIKE_LIMIT` は M3で 20→100 に変更する）
- `payment-provider.ts`: 決済モックのインターフェース（M6で使用）

### 6.3 mobile の再利用資産
- UI部品: `src/components/ui/`（AppButton / AppTextField / ChoiceGroup / Screen / PrefectureField / ValueTagsSelector）
- 状態: `src/stores/auth.ts`（useAuthStore）/ `src/hooks/use-my-profile.ts` / `src/components/realtime-profile-sync.tsx`（Realtime購読パターンの手本）
- `src/lib/`: supabase.ts / confirm.ts（Web対応ダイアログ）/ upload-photo.ts / base64.ts

### 6.4 admin の再利用資産
- `lib/supabase-admin.ts`（service_roleクライアント）
- `app/verifications/page.tsx`（Server Component + Server Action + revalidatePath の手本）
- `app/reports`・`app/users`・`app/flagged` はプレースホルダ（M3で中身を実装）

---

## 7. M3で必ず守る承認済みの決定（docs/decisions/2026-07-06_M3設計判断.md）

1. **R4 いいね上限 = 100件/日**（SPECの20から変更）。方式は「拒否せず表示繰越」。
   → `packages/shared/src/constants.ts` の `FEMALE_DAILY_LIKE_LIMIT` を 20→100 にする。
2. **blocks テーブル新設**（SPEC §3に無い追加）承認済み。ブロックはRLSで両方向遮断。
3. **通報3件以上の警告**はDBカラム追加でなく**管理画面の強調表示**で代替。

M3の受け入れ条件（これを満たしたら停止・報告）:
1. seedユーザー2名でマッチ→チャット往復が**Realtimeで**動く
2. **子持ち女性へ理解宣言なし男性のいいねがエラー**になる（R3）
3. **「投資」を含むメッセージで受信側に警告バナー**が出る（R8）

---

## 8. 起動・確認方法

### 8.1 開発起動（PowerShell）
```powershell
$env:Path = "C:\Program Files\nodejs;C:\Users\haosh\AppData\Roaming\npm;$env:Path"
cd C:\Users\haosh\dev\hapimari
pnpm exec supabase start   # Docker Desktop起動が前提
pnpm dev                   # mobile(Expo) + admin(Next.js)
```
- 管理画面: http://localhost:3000 / Supabase Studio: http://localhost:54323
- モバイルWeb: http://localhost:8081（Expoの "w" でも可）

### 8.2 非エンジニアのオーナー向け（cowork directory にbatあり）
- `ハピマリを起動.bat`（アプリ）/ `管理画面を起動.bat`（運営画面）をダブルクリック

### 8.3 テストアカウント（全員 password123）
- `seed01〜12@hapimari.test` = 男性 / `seed13〜20@hapimari.test` = 女性（全員認証済み・価値観タグ付き）
- `test-f34@hapimari.test` = 「はなこ改」（女性・認証済み・M1/M2で作成）
- マッチ済みペア: seed01(たかし)×seed13(ようこ) は message_count=22（デート打診可能状態・M4用）

### 8.4 品質チェックコマンド
```powershell
pnpm exec biome check --write .           # Lint/Format
pnpm --filter @hapimari/shared test       # Vitest（現在25件緑）
cd apps\mobile; pnpm exec tsc --noEmit     # モバイル型チェック
cd apps\admin;  pnpm exec tsc --noEmit     # 管理画面型チェック
```

---

## 9. 次のエージェントへの指示文（コピペ用）

```
C:\Users\haosh\dev\hapimari で作業してください。
あなたはこのプロジェクトのリードエンジニアです。まずリポジトリ直下の CLAUDE.md（開発憲法）と
docs/HANDOFF.md を読み、全ルールを遵守してください。
次に docs/design/M3_design.md に従って M3（検索・いいね・マッチ・メッセージ）を実装してください。
§1「前提と環境」は実際に発生したトラブルの回避策なので実装前に必読。
実装順序は設計書 §9（P1→P9）。各Phase完了ごとに日本語で論理単位コミット。
docs/decisions/2026-07-06_M3設計判断.md の決定（いいね上限100・blocks新設・通報強調表示）はそのまま実装。
完了条件は設計書 §8.4（受け入れ条件3点E2E / docs/acceptance/M3.md / QUESTIONS.md追記 / Biome・tsc・Vitest全緑）。
設計書に無い判断が必要になったら勝手に決めず、選択肢＋推奨案を提示して停止してください。
```

---

## 10. 現在の未解決・注意事項（QUESTIONS.md 抜粋 + 本番前TODO）

- **管理画面に認証がない**（ローカル開発前提）。本番公開前に管理者認証の導入が必須。
- **service_roleキー・Supabase URLはローカルのデモ値**をフォールバックにしている。本番は必ず環境変数で。
- verifications は「本人は自分の申請のみ閲覧可」に緩和済み（審査待ち画面のため・SPECからの意図的逸脱）。
- 本番Supabaseでは既定GRANTが全許可になるため、不要なGRANTのREVUKE検討が必要（M6仕上げ）。
- App Store / Google Play 申請、インターネット異性紹介事業の届出、利用規約/プライバシーポリシー法務レビューは人間タスク（SPEC §9）。

---

## 11. 直前の状態（2026-07-06 M3完了時点）

- M3 実装完了・受け入れE2E合格（`docs/acceptance/M3.md`）。Biome/tsc/Vitest(53件)全緑。
- 適用済みmigrationは6本になった（+`20260706200000_m3_social.sql`）。
- **いいね送信には Edge Function が必要**: `pnpm exec supabase functions serve like` を起動しておくこと
  （batファイルには未組み込み。オーナーがアプリを触る際の注意点）。
- E2Eで作られたデータ: ひろし(seed03)×みほ(seed15)のマッチ+メッセージ3通（1通flagged）は
  M4検証用に意図的に残置。reports対応履歴3件も残置。
- M4着手時は CLAUDE.md §4 に従い、設計提案（`docs/design/M4_design.md`）→オーナー承認→実装の順で。
