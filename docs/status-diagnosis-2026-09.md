# ハピマリ 開発状況診断（2026-09-16）

> 調査のみ。コードは変更していない。調査方法: `HANDOFF.md`／`progress.md`／`tasks.md`／`SPEC.md`／`QUESTIONS.md`／`docs/acceptance/`／`docs/decisions/`／`docs/review/`／実装コード（migrations・Edge Functions・apps）の精読と、ローカルでの実行（lint・型検査・単体テスト・SQLテスト・Expo Web/admin起動）。

---

## 0. 結論（全体の完成度）

**機能・セキュリティの実装は概ね完成（目安95%）。公開作業（法務・本番インフラ）はほぼ未着手（目安10%）。**

| 観点 | 完成度目安 | 一言 |
|---|---|---|
| コア機能（登録〜チャット〜通報/ブロック〜管理画面） | 100% | 全マイルストーン受け入れ条件クリア済み（実測記録あり） |
| 決済（Stripe）・通話（Agora）の実装 | コード100% / 実キー検証0% | 実装は完了、本番/テストキーでの動作確認だけが残っている |
| セキュリティレビュー（PR#1・39件指摘） | 対応済み31件＋見送り5件＋本番実測待ち4件 | 主要な脆弱性（RLS・三点測位・写真なりすまし・ブロック貫通）はすべて修正・実測PASS |
| 本番公開 | 実質0% | Supabase本番プロジェクト未作成・ホスティング未契約・ドメイン未定 |
| 出会い系サイト規制法の届出 | 未着手 | **最大のボトルネック**（受理まで2週間〜1ヶ月。開発ではなく行政手続き） |
| 未コミットの新規実装1件 | コード完成・未検証 | 写真AIモデレーション＋暴言フィルタ（後述、要注意） |

「開発が終わっていないから公開できない」のではなく、**「開発はほぼ終わっているが、法令の届出とインフラ契約という開発外の作業が残っている」**状態。

---

## 1. 基本情報

### 技術スタック
| レイヤ | 技術 | 根拠 |
|---|---|---|
| モバイル/Web | Expo 57 / React Native 0.86 / React 19 / expo-router | [apps/mobile/package.json](../apps/mobile/package.json) |
| 状態管理 | Zustand + TanStack Query | 同上 |
| 管理画面 | Next.js 16 (App Router) / Tailwind 4 | [apps/admin/package.json](../apps/admin/package.json) |
| バックエンド | Supabase（Postgres・Auth・Storage・Realtime・Edge Functions） | `@supabase/supabase-js` を mobile/admin で使用、`supabase/` 配下に migrations 23本・Edge Functions |
| 認証 | Supabase Auth（メール+パスワード） | `apps/mobile/src/lib/supabase.ts` |
| 決済 | **Stripe**（RevenueCatではない） | `supabase/functions/stripe-checkout`・`stripe-webhook`。SPEC.md原案はRevenueCat連携だったが、実装ではStripe Checkoutに置き換え済み（コード内にRevenueCat参照は0件） |
| 通話 | Agora（`agora-rtc-sdk-ng`・Web先行） | `apps/mobile/src/lib/call-provider-agora.ts`、`supabase/functions/agora-token` |
| モノレポ | pnpm workspaces + Turborepo + Biome | ルート `package.json` |

### Expo Web対応・Web公開に必要なもの
- **`apps/mobile` は Expo Web に対応済み**（`react-native-web` 依存あり、`"web": "expo start --web"` スクリプトあり）。
- 実際に `expo start --web` を起動し、ウェルカム画面が正しく描画されることを確認済み（本診断内「4. 動作確認」参照）。
- Web公開の手順書は既に存在: [docs/release_web.md](release_web.md)（`npx expo export -p web` で静的書き出し→Vercel等でホスティング）。
- **足りないもの**は「機能」ではなく「インフラの契約・作成」（3章参照）。

### git log（直近30件・要約）
- 直近の作業は **写真AIモデレーション/暴言フィルタの承認・設計・実装**（09-09）、**編集方針の追記**（09-09）、**admin `server-only` 導入=PR#1指摘対応**（09-08）、**PR#1レビュー返信12件の投稿記録**（09-03）、**PR#1レビュー第2弾の一括セキュリティ修正**（09-02、コミット `d1fbcb7`）。
- 全30件のログは `git log --oneline -30` で確認可能。最終コミット日時: 2026-09-09（`d3d0711`）。

### origin との差分
- `git status`: **クリーンではない**（後述「6. 気になった点」参照）。
- `git log origin/main..HEAD` / `HEAD..origin/main`: **どちらも0件**（push漏れ・pull漏れなし。ブランチはorigin/mainと同期済み）。

---

## 2. マイルストーンの進捗

| マイルストーン | 非エンジニア向け説明 | 判定 | 根拠ファイル |
|---|---|---|---|
| M0 基盤 | アプリの土台（起動・DB・型・CI） | **完成** | [docs/acceptance/M0.md](acceptance/M0.md) |
| M1 登録・本人確認の入口 | 会員登録、年齢/価値観タグ入力 | **完成** | [docs/acceptance/M1.md](acceptance/M1.md) |
| M2 本人確認 | 身分証提出→運営承認 | **完成** | [docs/acceptance/M2.md](acceptance/M2.md) |
| M3 検索・いいね・マッチ・チャット・通報/ブロック | お相手探し〜会話・通報 | **完成** | [docs/acceptance/M3.md](acceptance/M3.md) |
| M4 デート打診・日程調整 | 実際に会う約束の調整 | **完成** | [docs/acceptance/M4.md](acceptance/M4.md) |
| M5 音声通話（初期のモックSDK版） | アプリ内通話（旧: ダミー実装） | **完成（後にM8で本実装に置換）** | [docs/acceptance/M5.md](acceptance/M5.md) |
| M6 課金ゲート・透明性レポート・退会 | 未課金者の送信制限、月次レポート、退会処理 | **完成** | [docs/acceptance/M6.md](acceptance/M6.md) |
| 管理画面（全体） | 運営が審査・通報対応する画面 | **完成**（認証は簡易方式、後述） | `apps/admin/` 一式・[docs/acceptance/M2.md](acceptance/M2.md) |
| **M4（再掲・詳細）** デート打診・日程調整 | 上記のとおり | **完成** | 相手の意思を見せない秘匿設計まで実装・実測済み（`get_date_status` RPC） |
| **M5（本実装）音声通話** | 実際に声が届く通話機能 | **一部（コードは完成、実音声は未確認）** | Edge Function `supabase/functions/agora-token`（当事者確認・非ブロック・双方本人確認済み・15分上限をトークン有効期限で強制）＋ `apps/mobile/src/lib/call-provider-agora.ts`。**Agoraの本番キー未設定のため、実際に声が届くかは未確認**（[docs/acceptance/M8.md](acceptance/M8.md) §B 未実施） |
| **M6（本実装）課金・退会** | クレジットカード決済、解約 | **一部（コードは完成、実決済は未確認）** | Stripe実装：`supabase/functions/stripe-checkout`・`stripe-webhook`、`apps/mobile/src/app/subscription.tsx`。RevenueCatは不採用（コード上に参照なし）。**Stripeのテスト/本番キー未設定のため、実際の決済は未確認**（[docs/acceptance/M7_2.md](acceptance/M7_2.md) §B 未実施）。退会（アカウント削除・匿名化）はSQLテストで実測PASS（`test_m67_retention`、90日後の個人情報匿名化・写真/位置情報の削除まで確認済み） |

**モックか本物か（重要な2点の確認結果）**
- **音声通話＝モックではない。実Agora SDK**（`agora-rtc-sdk-ng`）を使う本実装。ダミーキーでトークン発行の正常系・異常系は実測済みだが、**実際の音声疎通は未確認**。
- **課金＝モックではない、かつRevenueCatでもない。実Stripe Checkout/Webhookの本実装**。画面遷移・DB反映ロジックまで完成しているが、**実際のカード決済は未確認**。

---

## 3. レビュー指摘（PR#1）の対応状況

PR#1: https://github.com/yoshinobu0911-ctrl/hapimari/pull/1（gh CLI 未使用。`docs/review/` の記録・実装コード・ローカルSQLテストの実行結果から判定）

| # | 指摘内容 | 判定 | 根拠 |
|---|---|---|---|
| 1 | 管理画面の認証 | **修正済み**（ただし本格認証ではなく意図的にBasic認証を維持） | `apps/admin/middleware.ts`: `ADMIN_PASSWORD` 未設定なら**環境を問わず503で全遮断**（フェイルクローズ）。ローカルで `ADMIN_ALLOW_INSECURE` 未設定のまま起動し、実際に「無効化しています」の503を確認済み（4章）。本格的な個人ログイン制は[docs/decisions/2026-08-27_admin認証は当面Basic認証で維持.md](decisions/2026-08-27_admin認証は当面Basic認証で維持.md)でオーナーが**当面Basic認証のままでよいと承認**（運営がオーナー1名のため） |
| 2 | 個人情報の露出・RLS | **修正済み** | `profiles_public` ビュー（`supabase/migrations/20260902100000_review2_security_fixes.sql`）で `birth_date`・`has_children` 等の秘匿列を除外。`profile_locations`（緯度経度）・`subscriptions`（Stripe ID列）もRLS/GRANTで直接参照不可。SQLテスト `test_m65`（他人の契約照会は拒否）・`test_m66`（座標は完全非公開）が **実行してPASS**（4章） |
| 3 | 本人確認の仕組み（承認前のメッセージ制限がサーバー側強制か） | **修正済み** | メッセージ送信のR2ゲートはM2から実装済み。加えて2026-08-26の決定で**いいね送信・音声通話も本人確認の承認後のみ**に拡張（`supabase/functions/like/index.ts`・`supabase/functions/agora-token/index.ts` でサーバー側チェック）。5パターン実測済み（HANDOFF.md記載）。閲覧のみは確認前でも可（法務判断待ちの残論点として`QUESTIONS.md`に明記あり） |
| 4 | 位置情報による三点測位攻撃 | **修正済み** | `supabase/migrations/20260730100000_m6_6_audit_fixes.sql` で座標を約5km格子に量子化してから距離計算＋頻度制限（30分間隔・1日8回）＋並列更新の行ロック。SQLテスト `test_m66_audit_fixes` で「全24観測地点で同一セル内の位置は区別不能」を**実行してPASS**（4章） |
| 5 | ブロック機能の完全性 | **修正済み** | `is_blocked_between` 関数をプロフィール表示・メッセージ送信・通話・デート打診の全RPCでチェック。SQLテスト `test_m65` で「ブロック後のmessages・calls・date RPCすべて拒否」を**実行してPASS** |
| 6 | 写真URLの検証 | **修正済み** | 書込トリガで所有者パス強制（`invalid_photo_path`）、表示側は `is_photo_of_profile` 関数で所有者一致＋承認済みのみ返す、UPDATE/DELETEポリシー撤去でDELETE→再アップ迂回も閉鎖。SQLテスト `test_review2_fixes` で複数の攻撃シナリオを**実行してPASS** |
| 7 | DBインデックス | **修正済み** | `supabase/migrations/20260721110000_analytics_and_masters.sql` に複合インデックス（`profiles(status, gender, birth_date)` 等）・GINインデックス（タグ・空き時間）。likes/matches/messages等の主要FKにもインデックスあり |

**総括**: 指摘39件中31件対応済み・5件は意図的見送り（オーナー承認済み判断）・4件は「本番Supabase作成後でないと実測できない」項目（後述5章）。**公開をブロックする未対応のP0級指摘は残っていない**。

---

## 4. 動作確認（実施結果）

| 確認項目 | 結果 |
|---|---|
| Biome lint | ✅ 142ファイル、指摘0件 |
| 型検査（tsc --noEmit） | ✅ shared / mobile / admin すべて0エラー |
| 単体テスト（Vitest, `packages/shared`） | ✅ 12ファイル・**93件全PASS** |
| ローカルSupabase起動（Docker） | ✅ 起動成功 |
| SQLテストスイート（`scripts/run_sql_tests.sh`） | ✅ **全スイートPASS（FAIL 0件）**。RLS・ブロック遮断・三点測位対策・写真なりすまし対策・退会/匿名化まで含む |
| Expo Web起動（`expo start --web`） | ✅ 起動成功。ブラウザでウェルカム画面（「ハピマリ／人生の後半を、いっしょに歩む人と。」）の描画を実際に確認 |
| 管理画面起動（`next dev`） | ✅ 起動成功。`ADMIN_PASSWORD` 未設定時に設計どおり503で遮断されることを実際に確認（意図的な安全側動作） |

HANDOFF.mdの起動手順（`supabase start` → `pnpm -F mobile exec expo start --web` / `pnpm -F admin dev`）は**そのとおり動作する**ことを確認した。

---

## 5. 公開前に必ず直すべきもの（重要度順）

1. 🔴 **出会い系サイト規制法の届出**（行政書士面談・申請、受理まで2〜4週間）。開発外の作業だが**最大のボトルネック**。届出書用の資料は`docs/legal/age_verification_description.md`に完成済み
2. 🔴 **本番インフラの契約**: Supabase本番プロジェクト（東京リージョン推奨）・ホスティング（Vercel推奨）・ドメイン取得・アプリ本番URLの確定（提案: `app.happymarry.jp`、オーナー決定待ち）
3. 🔴 **Stripe本番/テストキーの設定→実決済テスト**（`docs/acceptance/M7_2.md` §B）。コードは完成しているが実キーでの検証が一度もない
4. 🔴 **Agoraキーの取得→実音声疎通テスト**（`docs/acceptance/M8.md` §B）。同上
5. 🟡 **未コミットの実装（写真AIモデレーション/暴言フィルタ）の扱いを決める**（6章参照）。このまま放置すると作業が失われるリスクがある
6. 🟡 **本番Supabase作成後の実測2件**（PR#1指摘・未対応。`docs/launch_checklist.md` #23, #24）:
   - Edge Functionの共有コード（`packages/shared`）がホスト環境の `functions deploy` で正しくバンドルされるか
   - Realtime（`postgres_changes`）で当事者以外にmessages/likesが配信されないか
7. 🟢 **更新3日前のメール事前通知**（現状完全未実装）。実装には外部メールサービス追加の可能性があり、SPEC.mdの「メール送信はSupabase Auth標準のみ」からの逸脱になるため要承認（`tasks.md`に記載済み）
8. 🟢 法定表示3ページ（特商法・利用規約・プライバシーポリシー）はLP側リポジトリ（`hapimari-lp`、本調査の対象外）で**仮文面のプレースホルダのまま**。届出受理番号の反映も含め、届出完了後に本文確定が必要

---

## 6. Web版公開に向けて足りないもの

機能面での不足はない（Expo Webは動作確認済み）。足りないのは**インフラと運用**:

- Supabase本番プロジェクトの作成・migration適用・Edge Functionsのデプロイ
- Vercel等へのホスティング・ドメイン接続
- Stripe本番アカウントの審査通過・本番商品登録・Webhook登録
- 上記が揃った状態での本番一気通貫確認（登録→本人確認→検索→いいね→マッチ→メッセージ→決済→解約）

手順自体は [docs/release_web.md](release_web.md) に一通り整理済み（ただし同文書内の§4進捗表は2026-08-14時点のままで、決済画面・通話・UI刷新は現在では完了しているため**古い**。届出とStripe本番審査の2点のみが実質的な残課題）。

---

## 7. 気になった点・矛盾点

1. **未コミットの実装が1週間放置されている**: 2026-09-09に「写真AIモデレーション」「いいね一言の暴言フィルタ」がオーナー承認され、同日中にコード実装まで完了（[docs/decisions/2026-09-09_写真AI併用と暴言フィルタ承認.md](decisions/2026-09-09_写真AI併用と暴言フィルタ承認.md)）。しかし**このコードは本日時点（2026-09-16）でもgit未コミット**（`packages/shared/src/abuse_words.ts` ほか6ファイルがuntracked/modifiedのまま）。`progress.md`・`tasks.md` は最終更新が同じ09-09で、この決定・実装の反映がなく「オーナー承認待ち」の記述のまま止まっている。**単体テスト93件（新規abuse_words.test.ts含む）はPASSしているが、実キー（OpenAI moderations API）での動作確認だけが未実施** — 消えると困る作業なので、早めにコミット＋`progress.md`/`tasks.md`の更新を推奨
2. **SPEC.mdからの意図的な逸脱が2件ある**（悪いことではないが記録が分散している）:
   - 決済: SPEC.mdの原案は「RevenueCat統合ポイントのみ用意したモック」だったが、実際は**Stripeの本実装**に置き換えられている（M7.2で決定・実装）
   - 通話: SPEC.mdの原案は「モックSDK（M5）→Agora本実装は後日差し替え」の計画通りで、これはM8で予定どおり実装済み
3. **`docs/release_web.md` の前提条件表（§4）が古い**（2026-08-14時点）。決済画面・音声通話・UI刷新はいずれも「❌未着手」と書かれているが、実際は全て完成済み。読者が古い情報で「まだ遠い」と誤解する可能性がある
4. **`docs/launch_checklist.md` も古い**（2026-07-30時点）。「現在はモック」という記述が決済・通話の両方に残っているが、両方とも本実装に置き換わっている
5. **本人確認の「eKYC自動照合」は依然として目視審査のみ**（SPEC.mdの想定どおりではあるが、PR#1コメント#27で指摘された「カメラ撮影限定（ライブラリ選択不可にする）」は未実装のまま、`apps/mobile/src/app/(verification)/upload.tsx` で今もライブラリ選択を許可している）。届出の行政書士回答と合わせて検討事項として残っている
