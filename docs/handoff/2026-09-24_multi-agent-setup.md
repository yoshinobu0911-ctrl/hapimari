# 複数AIの作業分離セットアップ（ローカルの Claude Code 向け指示書）

- 作成: 2026-09-24 クラウドセッション（GitHub ブランチ `claude/inspiring-euler-acq15n`）
- 実行する人: オーナーのPC（Windows）で動く Claude Code
- 作業場所: **この作業だけは本体フォルダ `C:\Users\haosh\dev\hapimari` で行う**
- オーナーの同意: この指示書を渡した時点で、提案（`AGENTS.md` §12・§13 の導入、AIごとの作業フォルダの作成、定型ワークフローの共通化）に同意済み
- 背景と設計: 同じブランチにある `AGENTS.md` §12・§13 と `docs/decisions/2026-09-24_複数AIの作業分離.md` を先に読むこと

この指示書でやること:

1. 提案ブランチを main に取り込む
2. PCにしか無いもの（`dev\AGENTS.md`、`/advisor-design`・`/advisor-review` の原本）をリポジトリに取り込む
3. AIごとの作業フォルダ（git worktree）を作り、動くことを確認する

## 止まる条件（1つでも当てはまったら、それ以上変更せずオーナーに報告して止まる）

- 本体フォルダの `git status --short` に、`.agents/` 以外の行がある（ほかのAIが作業中かもしれない。消す・コミットする・stash する、のどれもしない）
- 本体フォルダのブランチが main ではない
- これから作るフォルダ（`C:\Users\haosh\dev\hapimari-claude` / `hapimari-codex` / `hapimari-grok`）がすでに存在する
- 手順2の `git merge --ff-only origin/main` が失敗する（ローカルの main と GitHub の main が食い違っている）

## 手順

PowerShell を開くたびに、最初にこれを実行する（`AGENTS.md` §3）:

```powershell
$env:Path = "C:\Program Files\nodejs;C:\Users\haosh\AppData\Roaming\npm;$env:Path"
Set-Location C:\Users\haosh\dev\hapimari
```

### 1. 現状を確認する（読むだけ）

```powershell
git status --short
git branch --show-current
git stash list
git worktree list
Get-ChildItem C:\Users\haosh\dev
Get-ChildItem "$HOME\.claude\commands", "$HOME\.claude\skills" -ErrorAction SilentlyContinue
```

- 止まる条件に当たらないか確認する
- stash があれば、中身の要約を報告に含める（消さない）
- `advisor-design`・`advisor-review` の原本がどこにあるか控えておく（手順4で使う）

### 2. 提案ブランチを main に取り込む

リポジトリ直下に Git 管理外の `.agents\` フォルダが残っていると、取り込みが止まる（同じ場所に `.agents\skills\` を追加するため）。あれば**消さずに**退避してから取り込む:

```powershell
if (Test-Path .agents) {
  New-Item -ItemType Directory -Force C:\Users\haosh\dev\_backup\2026-09-24_hapimari | Out-Null
  Move-Item .agents C:\Users\haosh\dev\_backup\2026-09-24_hapimari\.agents
}
git fetch origin main claude/inspiring-euler-acq15n
git merge --ff-only origin/main
git merge --no-ff origin/claude/inspiring-euler-acq15n -m "統合: 複数AIの作業分離（AGENTS.md §13・定型ワークフローの共通化）" -m "Agent: claude"
```

- 衝突したら両方の内容を残して解消する（progress.md・tasks.md は両方の行を残す）

### 3. `dev\AGENTS.md`（リポジトリ外の共通ルール）を確認する

- `C:\Users\haosh\dev\AGENTS.md` を読む（無ければ飛ばす）
- ハピマリに関係するルールのうち、リポジトリの `AGENTS.md`（開発憲法の正本）に無いものがあれば、`AGENTS.md` の該当する節に追記する
- 特に「作業ログの記録ルール」と `AGENTS.md` §13-3（途中経過は `docs/agents/<AI名>/log.md`、`progress.md` には統合時に1行要約）が矛盾しないか確認する。矛盾があれば書き換えずにオーナーに確認する（どちらを正とするかはオーナーが決める）
- 取り込んだ場合は、`tasks.md` 冒頭の「運用ルールは `C:\Users\haosh\dev\AGENTS.md`…」を、リポジトリの `AGENTS.md` を指す記述に直す
- **`dev\AGENTS.md` 自体は変更も削除もしない**（ほかのプロジェクトでも使っている可能性があるため）

### 4. `/advisor-design`・`/advisor-review` の原本をリポジトリに取り込む

リポジトリの `docs/workflows/advisor-design.md`・`advisor-review.md` は、クラウドから原本が見えなかったため**暫定版**。PCの原本で置き換える。

1. 原本を探す: `$HOME\.claude\commands\advisor-design.md`・`advisor-review.md`、または `$HOME\.claude\skills\advisor-design\SKILL.md` など（手順1で控えた場所）。手順2で退避した `.agents` の中の複製も参考にする
2. 原本の**本文**で、`docs/workflows/advisor-design.md`・`advisor-review.md` の本文を置き換える
   - 冒頭の「全AI共通の正本」の注記は残し、「暫定版」の注記は消す
   - Claude 専用の書き方（コマンド名だけで他の手順を指している箇所など）は、`docs/workflows/feature.md`・`selfreview.md` と同じく「Claude Code: `/advisor-review`、その他のAI: 本文のパス」の形に直す。**手順・観点・出力形式の中身は変えない**
3. 原本の**先頭の設定欄（frontmatter）**のうち Claude 専用の項目（`model` など）は、`.claude/commands/advisor-design.md`・`advisor-review.md` の frontmatter に写す。`.agents/skills/` の SKILL.md は `name`・`description` だけのままにする
4. PCの原本は、**消さずに** `C:\Users\haosh\dev\_backup\2026-09-24_hapimari\claude-personal\` へ移す（同じ名前の個人設定が残ると、リポジトリ版より優先されて食い違いの原因になるため）。ただし、原本にハピマリ専用の記述が無く、ほかのプロジェクトでも使っていそうな場合は移さずに残し、報告でオーナーに確認する
5. 置き換えたあと、原本と見比べて**意味が変わっていないか**を確認し、差分の要点を報告に書く

### 5. AIごとの作業フォルダを作る

```powershell
foreach ($ai in "claude", "codex", "grok") {
  git worktree add --detach "C:\Users\haosh\dev\hapimari-$ai" main
}
git worktree list
```

- `git worktree list` が本体＋3フォルダの4行になれば成功
- `--detach` は「どのブランチにもいない待機状態」で作るという意味。作業開始時に各AIが `agent/<AI名>/<作業名>` ブランチを作る（`AGENTS.md` §13-2）

### 6. 各フォルダを準備する（`.env` のコピーと依存のインストール）

`.env` 類は Git の管理外なので、worktree には入らない。コピーする（中身は表示しない・コミットしない）。
決済・通話の秘密鍵（`supabase` 配下の `.env` 類）は、DB担当である Claude のフォルダにだけコピーする。

```powershell
$src = "C:\Users\haosh\dev\hapimari"
foreach ($ai in "claude", "codex", "grok") {
  $dirs = @(".", "apps\mobile", "apps\admin")
  if ($ai -eq "claude") { $dirs += @("supabase", "supabase\functions") }
  foreach ($dir in $dirs) {
    Get-ChildItem -Path "$src\$dir" -Force -File -Filter ".env*" |
      Where-Object { $_.Name -ne ".env.example" } |
      Copy-Item -Destination "C:\Users\haosh\dev\hapimari-$ai\$dir\"
  }
  pnpm -C "C:\Users\haosh\dev\hapimari-$ai" install --frozen-lockfile
}
```

### 7. 動作を確認する

```powershell
foreach ($ai in "claude", "codex", "grok") {
  Set-Location "C:\Users\haosh\dev\hapimari-$ai"
  pnpm exec biome check .
  pnpm --filter @hapimari/shared test
}
Set-Location C:\Users\haosh\dev\hapimari
```

- さらに1フォルダだけ画面の起動を確認する: `hapimari-codex` で `pnpm -F mobile exec expo start --web --port 8083` を実行し、http://localhost:8083 が表示されたら停止する
- 失敗したら無理に直さず、エラーの全文を報告する（例: パスが長すぎる・`pnpm install` の失敗）

### 8. 記録してコミットする（本体フォルダ・main。統合作業なので例外的に本体でコミットしてよい）

- `AGENTS.md` §13 冒頭の「状態: **提案（2026-09-24）**…」の段落を「状態: **運用中（<今日の日付>〜）**」に置き換える
- `docs/decisions/2026-09-24_複数AIの作業分離.md` の「状態」を「承認・導入済み（<今日の日付>）」に変える
- `docs/agents/claude/log.md` の先頭に、この作業の記録を書く（作ったフォルダ、取り込んだ原本、`dev\AGENTS.md` の確認結果、退避したファイルの場所、未解決の点）
- `progress.md` の「✅ 完了したこと」の先頭に1行: `- <今日の日付> (Claude): 複数AIの作業分離を導入 → [Claude の作業ログ](docs/agents/claude/log.md)`
- `tasks.md` の「開発体制」にある「複数AIの作業分離の導入」の行を削除する
- コミットメッセージは日本語、最後の行に `Agent: claude` を付ける → `git push origin main`

### 9. オーナーに報告する（この形で）

1. 作ったフォルダの一覧（`git worktree list` の結果）
2. 各AIの開き方（下の表をそのまま貼る）
3. 止まった箇所・失敗した箇所（あれば全部。隠さない）
4. `dev\AGENTS.md` と advisor の原本から取り込んだ内容、退避したファイルの場所、オーナーの判断が必要な点

| AI | 開くフォルダ | 定型ワークフローの呼び方 |
|---|---|---|
| Claude Code | `C:\Users\haosh\dev\hapimari-claude` | `/feature`・`/selfreview`・`/advisor-design`・`/advisor-review` |
| Codex | `C:\Users\haosh\dev\hapimari-codex` | スキルとして読み込まれる。「advisor-review を実行して」のように名前で頼む |
| Grok | `C:\Users\haosh\dev\hapimari-grok` | 「AGENTS.md を読んで、advisor-review を実行して」のように名前で頼む |
| 統合（main に取り込む） | `C:\Users\haosh\dev\hapimari` で Claude Code | 「統合待ちのブランチを AGENTS.md §13-2 の手順で main に取り込んで」 |

- アプリの起動用 bat（cowork directory）は本体フォルダを指したままでよい。本体フォルダには統合済みの内容だけが入る
- 各AIに最初に添える1行は `docs/HANDOFF.md` §9 にある
