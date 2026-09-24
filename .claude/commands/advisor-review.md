---
description: 実装後の独立監査（実装したAIとは別のAI・上位モデルで実行・読み取り専用）
argument-hint: 監査対象のブランチ名またはコミット範囲（省略時は main との差分）
---

【監査対象】
$ARGUMENTS

上記（空なら今のブランチと main の差分）について、次の共通手順（全AI共通の正本 `docs/workflows/advisor-review.md`）に従って独立監査を行ってください。

@docs/workflows/advisor-review.md

> 上の `@` 行で本文が取り込まれていない場合は、`docs/workflows/advisor-review.md` を読んでから始めること。

<!-- Claude Code 用の入口。本文はここに書かない（AGENTS.md §13-3）。手順を変えるときは docs/workflows/advisor-review.md を編集する -->
