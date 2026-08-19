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
- UI刷新（デザイナー発注の土台づくり）。オーナー承認済み方針: 依存追加は @expo/vector-icons のみ／代表8画面を先行して確認→残り14画面／外部デザイナーへの発注は維持。

## 🚧 進行中（In Progress）
<!-- 中断しても再開できるように、今どのファイル・どの作業の途中かを書く。 -->
- 代表8画面まで完了。オーナー確認待ち。確認後に残り14画面へ横展開する。

## 📋 TODO（次にやること）
<!-- 優先度順。着手→In Progress、完了→Done へ移動。 -->
- [ ] 【オーナー承認待ち】**M8 音声通話の本実装（Agora・Web先行）**: 設計書 `docs/design/M8_call_design.md`。A/B 2点（本人確認ゲート推奨A・ネイティブ後続推奨A）＋実装開始の承認待ち。並行して**オーナーのAgoraアカウント作成**（設計書§8の手順・App ID/Certificateの共有待ち）。方式決定の記録: `docs/decisions/2026-08-19_通話はAgora_課金ゲートなし.md`
- [ ] 【オーナー待ち】**M7.2 の実決済テスト**（Stripeテストキーを `supabase/functions/.env` に設定後、`docs/design/M7_2_payment_ui_design.md` §12 の手順で §11-(7)〜(15)(18) を実施）→ 結果を `docs/acceptance/M7_2.md` §B に記入
- [ ] 【オーナー待ち】**特商法・規約・ポリシーへのリンクを subscription.tsx に設置**（BYYコーポレートサイトのページ公開後。**公開前必須・法定**。2026-08-19 オーナー判断で保留中）
- [ ] 【オーナー確認待ち】残り14画面へトークン/共通部品を横展開（signup・login・likes・messages・filter・report-block・profile-edit・blocked・upload・call・step2・step4・index。※subscription は M7.2 で刷新済み・chat/mypage/profile系の演出まわりは実施済み。代表8画面のオーナー確認後に着手）

## ✅ 完了したこと（Done）
<!-- 新しいものを上に。日付(YYYY-MM-DD)とツール名を添える。 -->
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
