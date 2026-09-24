# AGENTS.md — 全AI共通の運用ルール（Claude Code / Codex / Grok / Antigravity ほか）

> 複数のAIが同じリポジトリで作業しても、お互いの作業がぶつからない（バッティングしない）ためのルール。
> どのAIも、作業を始める前に必ず読むこと。
> 状態: **提案（2026-09-24）**。セットアップ（`docs/handoff/2026-09-24_multi-agent-setup.md`）完了後に「運用中」へ変更する。
> 各AIの作業フォルダ（§1）がまだ無い間は、従来どおり本体フォルダで作業してよい。ただし**同時に動かすAIは1つだけ**にする。
> 経緯と選択肢: `docs/decisions/2026-09-24_複数AIの作業分離.md`

## 0. 最初に読むもの（この順番）

1. `CLAUDE.md` — 開発憲法。**Claude Code 以外のAIも全文を読み、同じルールに従う**（ファイル名に Claude と付いていても全AI共通）
2. このファイル — 複数AIでの作業の分け方
3. `progress.md` → `tasks.md` — 現在地と未完了タスク

## 1. 作業場所: 1つのAIセッション = 1つのフォルダ = 作業ごとに1つのブランチ

| 使う人・AI | 作業フォルダ | ブランチ名 |
|---|---|---|
| オーナー確認・統合（§7） | `C:\Users\haosh\dev\hapimari`（本体） | `main` |
| Claude Code | `C:\Users\haosh\dev\hapimari-claude` | `agent/claude/<作業名>` |
| Codex | `C:\Users\haosh\dev\hapimari-codex` | `agent/codex/<作業名>` |
| Grok | `C:\Users\haosh\dev\hapimari-grok` | `agent/grok/<作業名>` |
| クラウド版（claude.ai/code 等） | GitHub 上 | ツールが自動で付ける名前（例: `claude/...`） |

- 各作業フォルダは `git worktree`（同じリポジトリの「別の作業机」）。履歴とブランチは全フォルダで共有される
- **本体フォルダではファイルを編集・コミットしない**（§7 の統合作業だけは例外）。ここはオーナーの動作確認用
- **他のAIのフォルダのファイルを書き換えない**（読むのはよい）
- 同じAIを同時に2つ動かすときは `hapimari-claude2` のようにフォルダを1つ増やす。新しいAIも同じ形式で追加する
- フォルダのパスに日本語を入れない（Supabase CLI が黙って失敗する。CLAUDE.md §3）

## 2. 作業の始め方（毎回）

1. `git worktree list` で、自分のフォルダにいることを確認する
2. `git status` で、前回の作業の残り（未コミットの変更）がないか確認する。残っていたら**消さずに**オーナーへ報告する
3. main の最新から作業ブランチを作る: `git switch -c agent/<AI名>/<作業名> main`
   - ブランチ名がそのまま「担当宣言」になる。作業名は内容が分かる英数字にする（例: `agent/codex/likes-empty-state`）
   - 作業していない間、フォルダが「HEAD detached」（どのブランチにもいない）状態なのは正常
4. 他のAIが同じファイルを触っていないか確認する
   - 進行中の作業の一覧: `git branch --list "agent/*"`
   - コミット済みの変更ファイル: `git diff --stat main...<ブランチ名>`
   - 未コミットの変更ファイル: `git -C C:\Users\haosh\dev\hapimari-<AI名> status --short`
   - 同じファイルを触る作業が進行中なら、**着手せずにオーナーへ報告**する

## 3. 担当を1つに絞る場所（同時に触ると壊れやすい）

| 場所 | ルール |
|---|---|
| `supabase/`（migration・Edge Function・seed・config）と、DBから生成するファイル（`packages/shared/src/types/database.ts`・`supabase/schema.generated.sql`） | **同時に1つのAIだけ**が触る。原則 Claude Code が担当する（CLAUDE.md §6 のセンシティブ領域と重なるため）。生成ファイルは手で編集しない |
| `package.json` の依存・`pnpm-lock.yaml` | 依存の追加はオーナー承認制（CLAUDE.md §5）。同時に1つのAIだけ |
| `CLAUDE.md`・`AGENTS.md`・`SPEC.md` | オーナー承認なしに変更しない |

## 4. ローカル環境は全フォルダで共有（フォルダを分けても分離されない）

- **Supabase のローカルDB（Docker）は1つだけ**。どのフォルダから操作しても同じDBが変わる
  - `supabase migration up` と型の再生成は、§3 のDB担当だけが実行する
  - `supabase db reset`・`supabase stop` は禁止（全員の作業が止まる。必要ならオーナーに依頼）
  - 起動していなければ、**本体フォルダで** `pnpm exec supabase start` を実行する（自分のフォルダからは起動しない）
  - Edge Function は `supabase start` / `functions serve` を実行したフォルダのコードが動く。自分のフォルダの関数を試すのはDB担当だけ（試している間は全員がそのコードを使う）
- **画面の起動ポートはフォルダごとに固定**（同じ番号だと先に起動した方とぶつかる）

| 作業フォルダ | Expo Web（アプリ） | 管理画面 |
|---|---|---|
| hapimari（本体） | 8081 | 3000 |
| hapimari-claude | 8082 | 3001 |
| hapimari-codex | 8083 | 3002 |
| hapimari-grok | 8084 | 3003 |

- 起動例（Codex の場合）: `pnpm -F mobile exec expo start --web --port 8083` / `pnpm -F admin exec next dev --port 3002`
- `.claude/launch.json` と `pnpm dev` は本体用の番号（8081/3000）なので、作業フォルダでは上の表の番号で起動する
- 決済の戻り先（`APP_BASE_URL`）は 8081 固定のため、**決済の動作確認は本体フォルダで**行う

## 5. 全員が書き込むファイルの書き方

- `progress.md`: **追記のみ**。既存の行を書き換えない・ファイル全体を書き直さない。行頭は `日付 (AI名):`
- `tasks.md`: 消してよいのは、自分が完了したタスクの行だけ。他のAIの行は触らない
- `QUESTIONS.md`: 新しい質問の番号は `Q-YYYYMMDD-<AI名>` の形にする（例: `Q-20260924-codex`）。連番（Q22…）の取り合いを防ぐため
- 新しい記録ファイル（`docs/decisions/`・`docs/review/` など）は、既存どおり `YYYY-MM-DD_内容.md` で作る
- 統合時に衝突したら**両方の内容を残す**（片方を消して解決しない）

## 6. コミット

- コミットは自分の作業ブランチにだけする（main に直接コミットしない）
- メッセージは日本語（CLAUDE.md §8）。**最後の行に `Agent: <AI名>` を付ける**（例: `Agent: codex`）。どのAIの作業か後から追えるようにするため（Claude Code も付ける）
- `.env` などの秘密情報はコミットしない（CLAUDE.md §7）

## 7. 作業が終わったら

1. チェックを実行する: `pnpm exec biome check .` / apps/mobile と apps/admin で `pnpm exec tsc --noEmit` / `pnpm --filter @hapimari/shared test`
2. 自分の作業ブランチにコミットする
3. `progress.md` に1行追記する（§5 の形式。これも同じブランチにコミット）
4. オーナーに「`agent/<AI名>/<作業名>` が完了。統合待ち」と報告して終わる

**main への取り込み（統合）は Claude Code が本体フォルダで行う**（オーナーの依頼を受けてから）:

1. `git status` が空であることを確認し、`git pull --ff-only origin main` で GitHub の最新にそろえる
2. 差分をレビューする。CLAUDE.md §6 のセンシティブ領域に触れていたら、オーナーの承認があるか確認する
3. `git merge --no-ff agent/<AI名>/<作業名>`（merge commit に「どのAIの作業か」が残る）
   - クラウド版のブランチは、先に `git fetch origin <ブランチ名>` を実行し、`origin/<ブランチ名>` を取り込む
4. 衝突は両方の意図を残して解消する。判断できない衝突はオーナーに確認する
5. migration を含む場合は `pnpm exec supabase migration up` と型の再生成（CLAUDE.md §3）
6. 作業が終わったら（§7 冒頭）の1と同じチェックを実行し、すべて通ったら `git push origin main`
7. 統合したブランチは `git branch -d` で消してよい（取り込み済みのブランチしか消さない安全な消し方。そのAIのフォルダで使用中なら消せないので、そのままでよい）

## 8. 困ったとき

- ルールで判断できないとき・他のAIの作業とぶつかりそうなときは、**勝手に進めずオーナーに報告する**
- 作業を止める必要があるブロッカーは `QUESTIONS.md` に書く（CLAUDE.md §2）
