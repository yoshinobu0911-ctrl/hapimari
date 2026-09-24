# 複数AIの作業分離セットアップ（ローカルの Claude Code 向け指示書）

- 作成: 2026-09-24 クラウドセッション（GitHub ブランチ `claude/inspiring-euler-acq15n`）
- 実行する人: オーナーのPC（Windows）で動く Claude Code
- 作業場所: **この作業だけは本体フォルダ `C:\Users\haosh\dev\hapimari` で行う**
- オーナーの同意: この指示書を渡した時点で、提案（`AGENTS.md` の導入と、AIごとの作業フォルダの作成）に同意済み
- 背景と設計: 同じブランチにある `AGENTS.md` と `docs/decisions/2026-09-24_複数AIの作業分離.md` を先に読むこと

点検の結果、全AIが同じフォルダ・同じブランチ（main）で作業しており、同時に動かすと作業が混ざる構成だった。
この指示書では、ルールを main に取り込み、AIごとの作業フォルダ（git worktree）を作る。

## 止まる条件（1つでも当てはまったら、何も変更せずオーナーに報告して止まる）

- 本体フォルダの `git status` に未コミットの変更がある（ほかのAIが作業中かもしれない。消す・コミットする・stash する、のどれもしない）
- 本体フォルダのブランチが main ではない
- これから作るフォルダ（`C:\Users\haosh\dev\hapimari-claude` / `hapimari-codex` / `hapimari-grok`）がすでに存在する
- ローカルの main と GitHub の main が食い違っていて、手順2の `--ff-only` が失敗する

## 手順

PowerShell を開くたびに、最初にこれを実行する（CLAUDE.md §3）:

```powershell
$env:Path = "C:\Program Files\nodejs;C:\Users\haosh\AppData\Roaming\npm;$env:Path"
Set-Location C:\Users\haosh\dev\hapimari
```

### 1. 現状を確認する（読むだけ）

```powershell
git status
git branch --show-current
git stash list
git worktree list
Get-ChildItem C:\Users\haosh\dev
```

- 止まる条件に当たらないか確認する
- stash があれば、中身の要約を報告に含める（消さない）

### 2. 提案ブランチを main に取り込む

```powershell
git fetch origin main claude/inspiring-euler-acq15n
git merge --ff-only origin/main
git merge --no-ff origin/claude/inspiring-euler-acq15n -m "統合: 複数AIの作業分離ルール（AGENTS.md 新設・CLAUDE.md §2/§3）" -m "Agent: claude"
```

- 衝突したら両方の内容を残して解消する（progress.md・tasks.md は両方の行を残す）

### 3. `dev\AGENTS.md`（リポジトリ外の共通ルール）を確認する

- `C:\Users\haosh\dev\AGENTS.md` を読む（無ければ飛ばす）
- ハピマリに関係するルールのうち、リポジトリの `AGENTS.md`・`CLAUDE.md` に無いもの（例: 作業ログの記録ルール）は、リポジトリの `AGENTS.md` §5 に追記する
- 取り込んだ場合は、`tasks.md` 冒頭の「運用ルールは `C:\Users\haosh\dev\AGENTS.md`…」と `progress.md` 冒頭の `dev/AGENTS.md` を、リポジトリの `AGENTS.md` を指す記述に直す
- リポジトリ側のルールと矛盾する点があれば、書き換えずにオーナーに確認する（どちらを正とするかはオーナーが決める）
- **`dev\AGENTS.md` 自体は変更も削除もしない**（ほかのプロジェクトでも使っている可能性があるため）

### 4. AIごとの作業フォルダを作る

```powershell
foreach ($ai in "claude", "codex", "grok") {
  git worktree add --detach "C:\Users\haosh\dev\hapimari-$ai" main
}
git worktree list
```

- `git worktree list` が本体＋3フォルダの4行になれば成功
- `--detach` は「どのブランチにもいない待機状態」で作るという意味。作業開始時に各AIが `agent/<AI名>/<作業名>` ブランチを作る（`AGENTS.md` §2）

### 5. 各フォルダを準備する（`.env` のコピーと依存のインストール）

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

### 6. 動作を確認する

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

### 7. 記録してコミットする（本体フォルダ・main。統合作業なので例外的に本体でコミットしてよい）

- `AGENTS.md` 冒頭: 「状態: **提案（2026-09-24）**…」を「状態: **運用中（<今日の日付>〜）**」に変える。その次の行（「作業フォルダがまだ無い間は…」）は削除する
- `docs/decisions/2026-09-24_複数AIの作業分離.md` の「状態」を「承認・導入済み（<今日の日付>）」に変える
- `progress.md` の「✅ 完了したこと」の先頭に1行: `- <今日の日付> (Claude): 複数AIの作業分離を導入（hapimari-claude / -codex / -grok を git worktree で作成・.env コピー・動作確認）。<dev\AGENTS.md から取り込んだ内容があれば1行で>`
- `tasks.md` の「【オーナー承認待ち・指示書あり】複数AIの作業分離」の行を削除する
- コミットメッセージは日本語。最後の行に `Agent: claude` を付ける → `git push origin main`

### 8. オーナーに報告する（この形で）

1. 作ったフォルダの一覧（`git worktree list` の結果）
2. 各AIの開き方（下の表をそのまま貼る）
3. 止まった箇所・失敗した箇所（あれば全部。隠さない）
4. `dev\AGENTS.md` から取り込んだ内容と、矛盾していてオーナーの判断が必要な点

| AI | 開くフォルダ | 最初に添える1行 |
|---|---|---|
| Claude Code | `C:\Users\haosh\dev\hapimari-claude` | 不要（CLAUDE.md と AGENTS.md を自動で読む） |
| Codex | `C:\Users\haosh\dev\hapimari-codex` | 「AGENTS.md と CLAUDE.md を読んでから作業して」 |
| Grok | `C:\Users\haosh\dev\hapimari-grok` | 「AGENTS.md と CLAUDE.md を読んでから作業して」 |
| 統合（main に取り込む） | `C:\Users\haosh\dev\hapimari` で Claude Code | 「統合待ちのブランチを AGENTS.md §7 の手順で main に取り込んで」 |

- アプリの起動用 bat（cowork directory）は本体フォルダを指したままでよい。本体フォルダには、統合済みの内容だけが入る
