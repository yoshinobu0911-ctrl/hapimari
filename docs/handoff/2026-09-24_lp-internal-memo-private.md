# LP内部メモの非公開化 指示書（推奨モデル: Fable）

> **使い方**: 新しい Claude Code セッションで次の1行を送るだけ。
> `yoshinobu0911-ctrl/hapimari の claude/serene-shannon-m6av2c ブランチにある docs/handoff/2026-09-24_lp-internal-memo-private.md を読んで、その指示どおりに進めて`
>
> 公開範囲の変更（センシティブ領域）なので Fable での実行を推奨（CLAUDE.md §6・§10）。

---

## 作業場所
ハピマリLP（別リポジトリ）: GitHub `yoshinobu0911-ctrl/hapimari-lp`／オーナーPCでは `C:\Users\haosh\homepage\hapimari-lp`。
素のHTML・ビルド工程なし・Vercel配信。**main への push＝本番公開**。

## 目的
内部メモ `progress.md` と `images/README.md` が本番
（https://www.happymarry.jp/progress.md 、https://www.happymarry.jp/images/README.md ）で
誰でも見られる状態か確認し、見えているなら正しい方法で非公開にする。

## 経緯（2026-09-24 判明）
- コミット 5914e0d で `vercel.json` の `rewrites`（`/progress.md` → `/not-found-internal` 等）により「404化」したつもりだった。
- しかし vercel.json の `rewrites` はファイルシステム確認の**後**に評価されるため、実在ファイルには効かない。
  Vercel CLI 59.26.0 の `vercel build` 出力（`.vercel/output/config.json`）でも `{"handle":"filesystem"}` が rewrites より前にあり、
  `.vercel/output/static/` に progress.md と images/README.md が含まれることを確認済み。
- それ以前（d3a3116）は `.vercelignore` 方式を試したが「デプロイが2回連続スタック」して撤回した（原因が .vercelignore だったかは未検証）。
- 同日、`/terms` が404になる問題の修正として `vercel.json` に `"cleanUrls": true` を追加した
  （LPリポジトリのブランチ `claude/serene-shannon-m6av2c`。main 反映済みかは `git fetch` して確認すること）。

## 進め方（厳守）
1. まず設計提案（選択肢＋推奨と理由・リスク）を日本語で出し、オーナーの「OK」まで実装しない。候補例:
   - A) `.vercelignore` を再導入（Git連携デプロイでも効くかを確認）
   - B) `vercel.json` の `redirects`（filesystem より前に評価される）で `/` へ転送
   - C) 配信用ファイルを `public/` 等へ移し、内部メモを配信対象外にする
2. 承認後に実装し、`vercel build` の出力で検証する（static に含まれない、またはルートで転送される）。
   `vercel dev` はログインが必要なので、ビルド出力（config.json）で判断してよい。
   cleanUrls の効果（/terms・/tokushoho・/privacy が表示され、.html 付きURLは 308 転送）を壊していないことも確認。
3. コミットまではしてよい。**main への push（＝本番公開）の直前で必ず止まり、オーナーに簡潔に確認する。**
4. クラウド環境からは happymarry.jp に接続できない場合がある。その場合、本番での最終確認は
   「上の2つのURLをブラウザで開いて中身が出ないこと」をオーナーに依頼する。
5. LP の `progress.md` の「⚠️ 未解決」行を更新して記録する。
6. 報告は、初心者向けのやさしい説明とエンジニア用語の両方で書く。
