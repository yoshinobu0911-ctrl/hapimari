# tasks.md — ハピマリ（再婚マッチングアプリ）のタスクボード

> **未完了タスクだけ**をここに置く（優先度順）。完了したらここから消し、`progress.md` の「✅ 完了したこと（Done）」へ日付・ツール名つきで移す。
> どのAIエージェントも、セッション開始時に `progress.md` とこのファイルを読むこと。
> 運用ルールは `C:\Users\haosh\dev\AGENTS.md` の「作業ログの記録ルール」。
> 停止を要するブロッカーは `QUESTIONS.md`、マイルストーン受け入れは `docs/acceptance/M{n}.md`（役割分担は progress.md 冒頭を参照）。

最終更新: 2026-09-03 / Claude Code

## 🚧 進行中（In Progress）

- （なし）

## 📋 TODO（優先度順）

（2026-09-02 に `progress.md` から移設。文言は原文のまま）

- [ ] 【オーナー作業】レビュアー2名へチャットで一報（GitHub返信は投稿済み）。文面: `docs/review/2026-09-02_レビュアー返信_チャット用.md`
- [ ] 【オーナー承認待ち・1行】ローカルDB残骸データの修正（QUESTIONS.md Q21。test_m65のFAIL 1件の原因）と、`server-only` の依存追加（Q20）
- [ ] 【オーナー待ち・最重要】**出会い系サイト規制法の届出**（行政書士面談・申請）。`docs/legal/age_verification_description.md` を面談時に渡す。受理まで2週間〜1ヶ月＝9/14公開の最大の制約
- [ ] 【要オーナー決定】**アプリ本体の本番URL**（届出書に記載が必要。現状アプリは未デプロイでURL未確定。提案は `app.happymarry.jp` — `age_verification_description.md` §6。決定後のDNS・Vercel設定はエージェント作業）
- [ ] 【要オーナー判断・センシティブ領域】**更新3日前のメール事前通知が完全未実装**（launch_checklist ②-21）。アプリ内解約導線は実装済み。メール送信には外部サービス（Resend等）の追加が必要になる可能性があり、SPEC §8の「メール送信はSupabase Auth標準のみ」からの逸脱になるため要承認
- [ ] 【提案待ち・センシティブ領域】**写真のAIモデレーション導入**（オーナー方針: 人力＋AIのハイブリッドで、Claude/ChatGPT/GeminiいずれかのAPIを使う）。要件定義・プロバイダ選定・実装コスト（画像解析APIの料金発生）を短い設計提案として次セッションで提示すること。`apps/admin/lib/photo-ai.ts` に差し込み口あり
- [ ] 【設計提案待ち・センシティブ領域】**「スーパーいいね」機能（一言メッセージ付き）の新規実装**。2026-08-27オーナー決定: 暴言・誹謗中傷は新規NGワード辞書（fraud_words.tsとは別枠）で送信自体を拒否する方式（案A）。SPEC.mdに無い新機能かついいね/メッセージ機能に触れるため、着手時はCLAUDE.md §4の設計提案（目的・変更範囲・リスク）を先に提示してから実装すること
- [ ] 【オーナー待ち】**M8 実音声の疎通確認**: Agoraアカウント作成（設計書§8の手順）→ App ID / App Certificate をチャットで共有 → `.env` 設定して `docs/acceptance/M8.md` §B を実施（2ブラウザで通話・マイク拒否・期限切断・ログ）
- [ ] M8の後続: ネイティブ（iOS/Android）の通話対応（react-native-agora + Expo開発ビルド。ストア配信準備と同時に。9/14のWeb先行公開には不要と設計書に明記済み）
- [ ] 【オーナー待ち】**M7.2 の実決済テスト**（Stripeテストキーを `supabase/functions/.env` に設定後、`docs/design/M7_2_payment_ui_design.md` §12 の手順で §11-(7)〜(15)(18) を実施）→ 結果を `docs/acceptance/M7_2.md` §B に記入
