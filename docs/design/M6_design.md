# M6 設計書: 課金モック・透明性レポート・退会 + トーン統一（最終マイルストーン）

> **本書の使い方**: M3〜M5設計書と同様の自己完結ドキュメント。実装前に §1 と
> `docs/design/M3_design.md` §1.2（環境の落とし穴）を必読。
> **本書はオーナー承認後に実装着手する**（CLAUDE.md §4。特に §9 の判断1は仕様変更を含む）。

---

## 1. 前提と環境

- 環境は M3設計書 §1 のとおり。適用済みmigrationは8本（最新: `20260707200000_m5_calls_guard.sql`）。
- M6は2つのトラックで構成する:
  - **トラックA**: SPEC §6 M6 の標準スコープ（課金モック・R9・daily_stats・透明性レポート・退会）
  - **トラックB**: オーナー承認済みの追加分（2026-07-06/07 decisions）
    = トーン統一（中高年45〜65）/ 子持ち表示とR3の扱い / 女性プレミア500円将来枠 / 価値観マッチング強化
- 既存資産: `payment-provider.ts`（インターフェース+モック定義済み）/ admin `/transparency` プレースホルダ /
  mypage退会ボタン（ダイアログのみ）/ daily_stats テーブル（M0作成済み・RLSはauthenticated全拒否）

### 受け入れ条件（SPEC §6 M6 + 追加分）

1. **未課金男性がメッセージ送信不可**（閲覧は可・R9。UIとRLSの両方）
2. モック課金画面で「課金」すると送信できるようになる
3. **adminで当月の透明性レポートJSONが出力される**
4. 退会するとdiscover等から消え、ログインしても復帰導線のみになる
5. トーン統一・子持ち表示変更・相性理由表示が反映されている（§9の承認内容どおり）

---

## 2. トラックA: 標準スコープの設計

### A1. 課金状態とモック課金（migration + 画面）

- `profiles.subscription_active boolean not null default false` を追加（SPECの文言どおりフラグ方式）。
  クライアントからの直接更新は不可（UPDATE列GRANTに含めない）。
- RPC `purchase_subscription(p_plan text)`（security definer）:
  モックのため常に成功し自分の subscription_active=true にする。plan は §B5 の定義を検証。
- `payment-provider.ts` 拡張: プラン定義を追加（**male_standard** と **female_premium=将来枠**）。
  `SUBSCRIPTION_PLANS` 定数に名称・月額・対象性別・`available: boolean` を持たせ、
  female_premium は `available: false`（UI非公開・RevenueCat本実装時に有効化）。
- 新画面 `subscription.tsx`（マイページから遷移）: プラン説明 → 「登録する（モック）」→
  PaymentProvider.purchase() → RPC → 完了表示。**価格表記は §9-4 の決定に従う**。
  女性がこの画面を開いた場合は「女性は現在無料でご利用いただけます」を表示。

### A2. R9制御（RLS + UI）

- messages INSERT ポリシーを差し替え:
  既存条件（当事者・is_verified・active）に **「男性の場合は subscription_active=true」** を追加。
  女性は従来どおり送信可。閲覧（SELECT）は変更なし＝未課金男性も受信メッセージは読める。
- chat画面: 未課金男性には送信欄の代わりに
  「メッセージの送信には有料プランへの登録が必要です →（プランを見る）」を表示（RLS 403の先回り）。
- いいね送信・デート機能はR9の対象外（SPECどおりメッセージ送信のみ課金ゲート）。

### A3. daily_stats 集計

- 集計関数 `compute_daily_stats(p_date date)`（security definer・service_roleのみ実行可）:
  active男女数 / その日の新規マッチ数 / その日に confirmed になったデート数 / 凍結数 を upsert。
- **pg_cron** で毎日 JST 0:05 に前日分を実行（ローカルで拡張が使えない場合は §9-3 のフォールバック）。
- admin ダッシュボードに「直近7日のdaily_stats表」+「本日分を手動集計」ボタン（Server Action）を追加。

### A4. 透明性レポート（admin /transparency）

- 月選択 → その月の daily_stats を集計し表示:
  月間アクティブ男女（月末時点）/ 新規マッチ計 / デート成立計 / 強制退会（凍結）計。
- **「公開用JSONを生成」**ボタン → 上記集計を `{ month, active_male, active_female, new_matches,
  dates_confirmed, forced_withdrawals, generated_at }` 形式で画面表示+コピー可能に（受け入れ条件3）。

### A5. 退会フロー

- RPC `withdraw_account()`（security definer）: 自分の profiles.status='withdrawn' に変更
  （statusはクライアント直接更新不可のためRPC必須）。**ソフトデリート**（§9-6）。
- mypage「退会について」を実フローに差し替え: 確認ダイアログ（2段階）→ RPC → サインアウト →
  welcome画面。退会後の再ログイン時は「退会済み」案内画面を表示（プロフィール非表示はRLSが担保済み:
  status='active' 以外は他人から見えない）。

---

## 3. トラックB: 承認済み追加分の設計

### B1. 子持ち表示とR3の再設計（§9-1 の決定に従う・推奨は案A）

**案A（推奨）「見せない・弾かない・そもそも出さない」**:
- プロフィール詳細から「お子さま」「お子さまとの同居」「お子さま連れのデート」の表示を撤去
  （結婚歴・居住地は維持。自己紹介文で本人が書くのは自由）。
- フィルタ検索から「お子さまの有無」条件を撤去。
- R3を「いいね時エラー」から「**表示段階での除外**」に変更:
  `understands_children=false` の男性の discover には子持ち女性を出さない（discover_filtersに条件追加）。
  → エラーも「隠れた属性の漏えい」も発生しない。子持ち女性の保護はむしろ強くなる
  （理解のない男性からは**存在ごと見えない**）。
- Edge Function `like` のR3検証は**防御層としてそのまま残す**（UI迂回対策。通常は発火しない）。
- オンボーディングの入力（has_children等・理解宣言）は維持（マッチング品質のための内部データ）。
  文言を「お相手選びの参考のためだけに使用し、プロフィールには表示されません」に変更。

案B: 表示は維持しトーンだけ調整（R3現状維持） / 案C: 子ども関連の入力・表示・R3を全廃

### B2. トーン統一（文言監査）

- 対象: welcome / onboarding 4step / discover空表示 / 詳細 / チャット・デート・通話の注意文 / mypage。
- 方針: 「再婚」を看板から外し「**人生の後半を、いっしょに歩む人と**」を軸に。
  「バツイチ」「再婚活」等の語を使わない。敬体・16pt以上・絵文字は現状程度（💐📞📅）に抑制。
- welcome の説明文は「45歳からの、まじめなパートナー探し。」系に変更
  （R1の登録年齢はそのまま: 女性35+/男性45+。文言は「大人の」トーンで包む）。

### B3. seed再構成 + SPEC更新

- seed.sql を新ポジショニングに合わせて更新: 男性12名(45〜65) / 女性9名(38〜60・40歳前後を厚めに)。
  価値観タグも中高年寄りに再配分。**既存DBへは非破壊のUPDATE**（生年月日・タグ・自己紹介の調整）で適用し、
  `db reset` はしない（手動ユーザー・E2E履歴を保持）。
- SPEC §7 の「35〜45歳バツイチ子持ち設定」記述と §4 R3 を決定内容に合わせて更新（変更管理）。

### B4. 価値観マッチング強化（診断なし・with風の見せ方）

- shared に `compatibilityReasons(me, other): string[]` を追加（Vitest対象）:
  共通タグ（最大3つ）・時間帯の重なり・結婚観の近さを**日本語の理由文**に変換
  （例: 「お二人とも『ゆっくり距離を縮めたい』派」「会える時間帯が合っています（平日ランチ）」）。
- プロフィール詳細の相性%の下に理由チップを表示（85%未満でも理由は表示=共通点の演出）。
- タグはラベル微調整のみ（§9-5）。オンボーディングの見せ替え（質問形式）は
  デザイナーUI刷新と同時期に回す（今回はコピー調整まで）。

### B5. 女性プレミア500円/月の将来枠

- `SUBSCRIPTION_PLANS` に `female_premium`（月額500円・available:false・
  説明「真剣に活動する女性のための優先表示など（準備中）」）を定義。UIには出さない。
- 目的の記録: 男性のみ課金モデルで生じる「真剣でない男性の混入」を、将来女性側の少額課金で
  相互スクリーニングする布石（2026-07-07 オーナー決定）。

---

## 4. セキュリティ変更まとめ（RLS/GRANT）

| 対象 | 変更 |
|---|---|
| profiles | subscription_active 列追加（SELECT可・INSERT/UPDATE列GRANTに**含めない**） |
| messages | INSERTポリシー差し替え（+男性は subscription_active 必須）= R9 |
| RPC | purchase_subscription / withdraw_account / compute_daily_stats（実行権を最小付与） |
| daily_stats | 変更なし（authenticated全拒否のまま。adminはservice_role） |

## 5. テスト・受け入れ計画（要点）

- Vitest: compatibilityReasons（共通タグ/なし/時間帯/結婚観）・SUBSCRIPTION_PLANS整合
- RLS: 未課金男性のmessages INSERT→403 / 課金後→201 / 女性は常に201 /
  subscription_activeの直接UPDATE→拒否 / withdraw後に他人から見えない
- E2E: 未課金男性の送信欄→課金誘導→モック課金→送信成功（受け入れ1・2）/
  admin透明性レポートJSON（受け入れ3）/ 退会→discover消失→再ログイン案内（受け入れ4）/
  詳細画面の子持ち非表示と相性理由表示・welcome新文言（受け入れ5）
- 完了時: docs/acceptance/M6.md / QUESTIONS.md / SPEC更新 / HANDOFF更新（**MVP完成宣言**）/
  全チェック緑 / 「MVP完成時レビュー（3段階レビューB）」用の引き継ぎ資料を docs/review/ に生成

## 6. 実装順序

| Phase | 内容 | 目安 |
|---|---|---|
| P1 | migration（subscription列・R9 RLS・RPC3本・pg_cron・B1採用案のR3変更）+ psql検証 + 型再生成 | 中 |
| P2 | shared（プラン定義・compatibilityReasons・B1のdiscover条件変更）+ Vitest | 中 |
| P3 | mobile（課金画面・R9 UI・退会・B1表示変更・B2文言・B4理由表示）+ typed routes | 大 |
| P4 | admin（透明性レポート・ダッシュボード集計）+ seed再構成/SPEC更新 | 中 |
| P5 | E2E・受け入れ記録・レビュー用資料・コミット | 中 |

---

## 9. 設計判断（オーナー承認が必要な6点）

| # | 論点 | 推奨案 | 代替案 |
|---|---|---|---|
| 1 | **子持ち表示とR3**（仕様変更を含む・最重要） | **案A**: 表示・検索条件から撤去し、R3は「エラーで弾く」→「理解宣言のない男性には最初から表示しない」に変更（守りは強く・angry体験ゼロ・情報漏えいなし） | 案B: 表示維持でトーンのみ / 案C: 全廃 |
| 2 | 課金状態の持ち方 | **profiles.subscription_active フラグ**（SPECどおり・モックに十分・RevenueCat移行時もwebhookでこの列を更新） | subscriptionsテーブル新設（過剰） |
| 3 | daily_stats集計の起動 | **pg_cron日次 + 管理画面の手動実行ボタン**（ローカルでpg_cron不可なら手動ボタンのみで受け入れ、本番でcron有効化） | 手動のみ |
| 4 | モック課金画面の価格表記 | **「価格は正式リリース時に決定します」表記**（数字を出さない。ストア審査・プライシング検討前に仮価格が独り歩きするのを防ぐ） | 仮価格を表示（例: 月額3,980円(仮)） |
| 5 | 価値観タグの拡充規模 | **ラベル微調整+相性理由の言語化のみ**（タグID・件数は不変=データ移行なし。カテゴリ再編はデザイナーUI刷新と同時に） | 今回タグ追加・再編まで実施 |
| 6 | 退会時のデータ | **ソフトデリート**（status='withdrawn'・他人から完全非表示・データは保持。通報照会や再登録判定に必要。保持期間は利用規約で定める=人間タスク） | 物理削除 |
