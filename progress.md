# Progress Log — ハピマリ（再婚マッチングアプリ）

> このファイルは「作業ログ（work journal）」です。**現在地・進行中・TODO** をひと目で分かるようにします。
> AI（Claude Code / Codex / Antigravity 等）は、作業開始時にまずここを読み、区切りごと＆終了時に更新します。
> ルール本体は `CLAUDE.md`（開発憲法）と `dev/AGENTS.md`（共通ルール）にあります。ここは状態(state)だけを記録。
>
> 使い分け（既存の記録との役割分担）:
> - 大きな設計判断の詳細 → `docs/decisions/`（憲法 §8）。ここには1行の要約＋リンクだけ。
> - ブロッカー（停止事項） → `QUESTIONS.md`（憲法 §2）。ここには「待ち」の状態だけ。
> - マイルストーン受け入れ → `docs/acceptance/M{n}.md`。

---

## 🎯 現在のゴール（Now）
<!-- いま進めているマイルストーン/機能。1〜3行。 -->
- 9/14リリースに向けた残タスクの棚卸し（2026-08-26実施）。最大のボトルネックは開発ではなく**出会い系サイト規制法の届出**（受理まで2週間〜1ヶ月）。

## 🚧 進行中（In Progress）
<!-- 中断しても再開できるように、今どのファイル・どの作業の途中かを書く。 -->
- UI刷新の残り画面: 実際にコードを確認したところ、**14画面中9画面は既に新共通部品へ移行済み**（progress.mdの記載が古かった）。未着手は likes・messages・index の3画面のみ、blocked・callは部分対応。「オーナー確認待ち」は解消済みとみて次セッションで残り3〜5画面に着手してよい。

## 📋 TODO（次にやること）
<!-- 優先度順。着手→In Progress、完了→Done へ移動。 -->
- [ ] 【オーナー確認待ち】**LPの18歳未満表示をpush（本番反映）** — `homepage/hapimari-lp` コミット da8b410 が origin/main より1つ先行
- [ ] 【オーナー待ち・最重要】**出会い系サイト規制法の届出**（行政書士面談・申請）。`docs/legal/age_verification_description.md` を面談時に渡す。受理まで2週間〜1ヶ月＝9/14公開の最大の制約
- [ ] 【要オーナー決定】**アプリ本体の本番URL**（届出書に記載が必要。現状アプリは未デプロイでURL未確定。提案は `app.happymarry.jp` — `age_verification_description.md` §6。決定後のDNS・Vercel設定はエージェント作業）
- [ ] 【要オーナー判断・センシティブ領域】**admin本格認証（Supabase Auth）が未実装のまま**。現状は共有パスワードのBasic認証のみ（M6.5の暫定実装）。M7で対応する予定だったが実施されていない。CLAUDE.md §6により設計提案→承認が必要（このセッションでは未提案）
- [ ] 【要オーナー判断】**更新3日前のメール事前通知が完全未実装**（launch_checklist ②-21）。アプリ内解約導線は実装済み。メール送信には外部サービス（Resend等）の追加が必要になる可能性があり、SPEC §8の「メール送信はSupabase Auth標準のみ」からの逸脱になるため要承認
- [ ] 【オーナー待ち】**M8 実音声の疎通確認**: Agoraアカウント作成（設計書§8の手順）→ App ID / App Certificate をチャットで共有 → `.env` 設定して `docs/acceptance/M8.md` §B を実施（2ブラウザで通話・マイク拒否・期限切断・ログ）
- [ ] M8の後続: ネイティブ（iOS/Android）の通話対応（react-native-agora + Expo開発ビルド。ストア配信準備と同時に。9/14のWeb先行公開には不要と設計書に明記済み）
- [ ] 【オーナー待ち】**M7.2 の実決済テスト**（Stripeテストキーを `supabase/functions/.env` に設定後、`docs/design/M7_2_payment_ui_design.md` §12 の手順で §11-(7)〜(15)(18) を実施）→ 結果を `docs/acceptance/M7_2.md` §B に記入
- [ ] 残り3〜5画面（likes・messages・index、部分対応のblocked・call）へトークン/共通部品を横展開

## ✅ 完了したこと（Done）
<!-- 新しいものを上に。日付(YYYY-MM-DD)とツール名を添える。 -->
- 2026-08-27 (Claude): ①`docs/legal/tokushoho.md` の音声通話を有料機能→無料範囲へ移動（08-19決定に整合・README論点3注記も更新）②オーナー承認済み文言「18歳未満はご利用できません」を welcome/signup に追加（コミット 4b2a14a・biome 0 / tsc 0）③LP（別リポ homepage/hapimari-lp）のトップ hero-note・フッター・法定3ページに同文言を追加（コミット da8b410・**ローカルのみ、pushは未実施＝本番未反映**。ローカルHTTPでheroの描画確認・フッターはDOMで存在確認、スクショはタイムアウトで未取得）
- 2026-08-26 (Claude): **9/14リリース残タスクの棚卸し**（ワークフローで6領域を並行検証）＋**subscription.tsx保留分の実装**。①法定リンク3本（特商法・利用規約・プライバシーポリシー→happymarry.jp）をcontract中/解約予約中/プラン選択の全状態で常時表示するよう設置（当初プラン選択時のみだったのを是正）。②検証で判明した事実: admin本格認証は未実装のままBasic認証のみ・更新3日前メール通知は完全未実装・M8ネイティブ通話は9/14に不要（設計通り）・UI刷新は progress.md記載より進んでいた（14画面中9画面が実は移行済み）・tokushoho.mdに通話課金に関する古い記載が残存。検証: tsc 0 / biome 0（mobile）
- 2026-08-26 (Claude): **警察届出対応**。①「児童でないことの確認方法」の説明資料と届出書文例を作成（`docs/legal/age_verification_description.md`・行政書士との面談用）②オーナー決定により**いいね送信・音声通話を本人確認の承認後のみに変更**（like関数・agora-token関数のサーバー側ゲート＋通話ボタン非表示＋案内文更新。M8 §6-1のB決定を上書き。閲覧のみ確認前可＝行政書士回答待ち）③通話ダイアログの古い「モック」文言を修正。検証: 5パターン実測（未確認403/相手未確認410/確認済み200）・biome/tsc 0 → `docs/decisions/2026-08-26_確認前操作の安全側変更.md`
- 2026-08-25 (Claude): **M8 音声通話の本実装（コード完了）**。オーナー承認（6-1=B 本人確認ゲートなし・6-2=A Web先行）を受けて実装。①Edge Function `agora-token`（当事者・非ブロック・相手activeの資格チェック＋16分トークン=15分上限のサーバー側強制）②`call-provider-agora`（Web・シグナリングは既存Realtimeを共用、音声のみAgora）③`.web.ts`分割でネイティブへのSDK混入を防止 ④マイク拒否の専用エラー表示。検証: biome 0 / tsc 0 / shared 88件 / トークン発行の正当系+エラー系4本を実測（ダミーキー）。**実音声はAgoraキー共有後に確認** → `docs/acceptance/M8.md`
- 2026-08-19 (Claude): **残タスク一括消化**（オーナー包括指示）。①messages.kind 列を追加し自動メッセージ判定を正式化（偽装不可を実測・migration 20260819110000）②マッチ成立の演出モーダル（confirmDialog→専用UI・E2Eで実マッチ成立→表示→トーク遷移を確認）③shared の既存型エラー1件修正（shared tsc 0に）④認証後画面の実描画確認（セッション注入方式・M7.2全状態＋ペイウォール＋マイページ＋演出）→ `docs/acceptance/M7_2.md` §A2 ⑤未コミット分を論理単位でコミット。判断記録: `docs/decisions/2026-08-19_messages_kind列とマッチ演出.md`。検証: shared 88件 / biome 0 / tsc mobile・admin・shared 0
- 2026-08-19 (Claude): **M7.2 決済の画面側を実装**（設計書承認→同日実装）。①subscription.tsx 全面改修（3プラン選択・Checkout起動・反映待ちポーリング・解約/取り消し・past_due表示・本人確認誘導）②サーバー3点: past_due旧契約のキャンセル＋Checkout有効期限31分（stripe-checkout）・巻き戻し防止ガード（stripe-webhook）③migration 20260819100000: is_subscription_active を本人限定化（他会員の課金状態を照会不可に）④旧モック課金コードを完全削除。M7.1+M7.2 のmigrationをローカル適用し型再生成。検証: shared 88件成功 / biome 0 / mobile・admin tsc 0 / RLS・照会ガードをDB実測。**実決済テストは未実施**（Stripeキー待ち）→ `docs/acceptance/M7_2.md`
- 2026-08-04 (Claude/Cowork): UI刷新 Phase 0-2。①theme.ts v2（暖色グレー9段階・warning/info追加・文字8段階・lineHeight新設・shadow/radius階層・typographyプリセット）②共通部品10種を新規（AppHeader/Banner/Chip/Badge/Card/EmptyState/Skeleton/ListItem/Section/StepProgress）③既存部品を刷新（AppButton・AppTextField・ChoiceGroup・ValueTagsSelector・ProfileCard・Screen）④代表8画面を改修（ウェルカム/さがす/プロフィール詳細/トーク/デートの相談/マイページ/オンボ1・3）。監査で挙げた破綻8件を解消（カード高さ不揃い・絵文字タブバー・ウェルカムの空白・詳細写真が縦長すぎ・デート誘導バナーの折り返し崩れ・運営メッセージが相手の吹き出しと同一・時刻12ptの16pt規約違反・マイページのボタン5連打）。検証: tsc 0 / biome 0 / shared 72件成功、Expo Web(390×844)でウェルカム・ログイン・全新部品を実描画してスクショ確認。認証後の画面は未検証（AIがログインできないため）
- 2026-07-19 (Claude/Cowork): セキュリティ修正コミット a237557 — ①本番でデモ鍵フォールバック禁止（admin/mobile両方、未設定ならthrow）②admin全体にBasic認証（middleware.ts、ADMIN_PASSWORD未設定なら本番503）③.gitignoreを.env*+!.env.exampleに。検証: tsc両app 0 / biome 0 / sharedテスト73件成功。監査P0-1(admin認証なし)の最小対応
- 2026-07-17 (Claude/Cowork): progress.md を新設（作業ログ運用の開始）

## 🧭 意思決定ログ（Decisions・要約のみ）
<!-- 詳細は docs/decisions/ に。ここは「日付・決めたこと・詳細へのリンク」1行。 -->
-

## ⚠️ ハマりポイント / 未解決（Blockers & Gotchas）
<!-- 停止を要するブロッカーは QUESTIONS.md へ。ここは軽い注意・回避策のメモ。 -->
- 作業パスは必ず `C:\Users\haosh\dev\hapimari`（日本語を含むパスだと Supabase CLI がサイレント失敗）
