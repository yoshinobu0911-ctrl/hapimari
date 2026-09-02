# QUESTIONS.md（エージェントの質問置き場）

> SPEC.md §0-2 に従い、不明点はここに記録する。**ブロッカー**は実装を停止して人間の回答を待つ。
> **非ブロッカー**は暫定判断を記載して実装を継続し、レビュー時に確認してもらう。

## ブロッカー（回答待ち）

（現在なし）

## 非ブロッカー（暫定判断で継続中）

### Q1. profiles の年齢チェック（R1）の DB 制約について
- SPEC §3.1 のコメント「女性35歳/男性45歳未満を拒否（app側+DB制約）」に基づき、
  DB 側は `birth_date` と `current_date` を比較する CHECK 制約で実装した。
- CHECK 制約は「登録時点」でのみ評価されるため、既存行が誕生日経過で違反状態になることはない（挿入・更新時のみ評価）。
- **暫定判断**: この実装で問題ないか、レビュー時に確認。

### Q2. verifications の RLS と「審査待ち画面」（M2）の整合
- SPEC §3 RLS方針「verifications/reports の閲覧・更新は service_role（管理画面）のみ」に従い、
  申請者本人も自分の verifications 行を SELECT できない設計にした（INSERTのみ許可）。
- M2 の「審査待ち画面」で申請ステータスを表示する場合、
  (a) 本人のみSELECT可のポリシーを追加する、(b) Edge Function 経由で返す、のどちらかが必要。
- **M2で(a)を実装済み**（`20260706100000_m2_verification.sql`）。本人は自分の申請のみ閲覧可。
  他人の申請・書類画像（非公開バケット）には引き続きアクセス不可。

### Q5. 管理画面（apps/admin）に認証がない（M2時点・非ブロッカー）
- MVPローカル開発では管理画面に認証を付けていない（localhostのみで動作する前提）。
- service_role キーもローカルのデモ値。**本番デプロイ前に必ず管理者認証（例: Supabase Auth + 管理者ロール、
  もしくはBasic認証/前段のIdP）を導入する**こと。M6の仕上げで再確認する。

### Q3. matches.call_unlocked の閾値
- §3.3 の generated column は `message_count >= 10`（5往復=10メッセージで通話解禁）。
- §4 R5「message_count>=10（5往復）で通話解禁、>=20（10往復）でデート打診」と整合しているため、そのまま実装。

### Q4. Supabaseローカルの既定GRANTが無効だった件（M1で発覚・解決済み）
- 現行のローカルスタック（npm supabase 2.109）では public テーブルに anon/authenticated/service_role への
  DML GRANT が自動付与されず、REST が 403 になった。
- `20260706010000_explicit_grants.sql` で RLS 設計に対応する最小権限を明示付与して解決。
- ホスト版 Supabase（本番）では既定GRANTが存在するが、明示GRANTは冪等なのでそのまま適用可能。
  むしろ本番では「既定で全許可」になるため、**本番移行時に不要な既定GRANTのREVOKEを検討**（M6の仕上げで再確認）。

### Q6. blocks テーブルの新設（M3・オーナー承認済み）
- SPEC §3 に無いテーブルだが、ブロック機能の両方向遮断をRLSレベルで実装するために追加。
- 2026-07-06 にオーナー承認済み（`docs/decisions/2026-07-06_M3設計判断.md` #2）。記録のみ。

### Q7. R4「いいね上限」の解釈と値（M3・オーナー承認済み）
- 上限は **100件/日**（SPEC初版の20から変更）・方式は「拒否せず表示繰越」。
- いいね自体は全件保存し、**女性側の表示だけ** 1日100件に制限、超過分は翌日以降に繰越表示。男性は無制限。
- 2026-07-06 オーナー承認済み（decisions #1）。実装: `packages/shared/src/like_visibility.ts`。

### Q8. 通報3件以上の「警告フラグ」の実装方法（M3・オーナー承認済み）
- DBカラムは追加せず、**管理画面 /reports の赤枠強調表示 + 運営の手動対応**で代替（decisions #3）。

### Q9. ブロック解除一覧に相手のニックネームを表示できない（M3・**解決済み**）
- ブロック中は §3.3 のRLS（両方向遮断）により**相手のプロフィール行そのものが取得できない**ため、
  「ブロックしたユーザー」一覧（マイページ→設定）は**ブロックした日時のみ**表示している。
- **2026-07-06 オーナー承認: 日時のみ表示のままでOK**。改善案（ニックネーム非正規化保存 / RPC追加）は不採用。

### Q10. チャット画面は inverted FlatList でなく ScrollView+map を採用（M3・暫定判断）
- 設計書 §5.6 は「inverted FlatList」だが、§1.2-6 の既知の癖（react-native-web で FlatList が
  少件数でも描画を渋る）により、受け入れE2E（Web）の信頼性を優先して ScrollView+map + 自動下端スクロールで実装。
- メッセージ件数が増えた場合はページング + FlatList 化を検討（パフォーマンス改善はM3スコープ外・設計書§10.5）。

### Q12. M4「デート打診の存在」まで秘匿する実装（M4・設計の強化）
- R6は「片方の意思を相手に見せない」だが、実装中に「**相手が何か答えた事実（提案行の存在）**が
  見えるだけでも実質的な漏えいになる」ことを確認。get_date_status は
  「collecting かつ自分未回答」の間は行が存在しないのと同一の応答を返す仕様にした（受け入れで実測済み）。

### Q13. M4のバックエンドは Edge Function でなく Postgres RPC（M4・暫定判断）
- SPEC §6 M4 の「Edge Function」は security definer の Postgres RPC 6本で代替
  （Q3系の既定方針。検証はすべてサーバ側・デプロイ物削減・低レイテンシ）。
- 相手側への更新伝搬は「成立/確定/キャンセル時の自動メッセージ」（既存 messages Realtime）で実現。
  date_proposals 自体のRealtime配信は行っていない（直接SELECTを遮断しているため）。

### Q14. フィードバックのローカル通知は承諾側のみ（M4・既知の制限）
- expo-notifications のローカル通知は「日程を承諾した側」の端末でのみ予約される。
  提案者側・Webはチャット/相談画面のアプリ内バナーで代替（F-05の入力自体は両者可能・E2E済み）。
- 双方に確実に届けるにはプッシュ通知基盤（M4以降のスコープ外）が必要。公開前に要検討。

### Q15. Realtimeチャネルの同名 leave/join 競合（M5・発見と対処の記録）
- チャットの着信リスナーと通話セッションが同じチャネル名 `call-{matchId}` を共有するため、
  通話画面への遷移時に「リスナー離脱」と「通話参加」が競合し、通話チャネルが購読不能になる
  不具合をE2Eで発見（受け入れ前に修正済み）。
- 対処: `CallListener.stop()` を Promise 化し、**離脱完了を await してから**通話画面へ遷移する。
- 教訓: supabase-js で同一クライアントが同名チャネルを連続で leave→join する場合は直列化が必要。
  Agora本実装への差し替え時はこの制約自体が消える。

### Q16. R3いいね返し例外（M6・案Aの補完・暫定判断）
- 案A採用後も「子持ち女性が自ら宣言なし男性にいいね→男性が返せずエラー（=非表示のはずの
  子ども情報がエラー文言から漏れる）」という残穴があったため、**相手が先にいいねしている場合は
  R3ゲートを適用しない**（いいね返しは常に可能）とした。
- 根拠: R3の趣旨は「望まないアプローチからの保護」。女性が自分で選んだ相手には適用不要。
  Vitest・E2Eで担保済み。オーナー承認済みの案Aの自然な補完としてレビューで確認いただきたい。

### Q17. daily_stats の2項目は近似値（M6・暫定判断）
- `dates_confirmed` = confirmed_slot の日付が当日のデート数（「確定操作をした日」のタイムスタンプ列が無い）
- `forced_withdrawals` = 現在 suspended のユーザー数（凍結日時の列が無いため累計スナップショット）
- 正確にするには date_proposals.confirmed_at / profiles.suspended_at の列追加が必要（スキーマ変更のため見送り）。
  本番の透明性レポート公開前にどちらの定義でいくかオーナー判断を仰ぐ。

### Q18. 位置情報は専用テーブル `profile_locations` に分離（M6・実装中の設計変更）
- 当初は profiles に座標列+カラム単位SELECT遮断で設計したが、PostgRESTの `select=*` が
  カラム権限不足で**全プロフィール取得が403**になることがE2Eで発覚。
- 座標を `profile_locations`（authenticated へのGRANTゼロ・書き込みは丸め込みRPC
  `set_my_location`・読み出しは距離RPC `get_profile_distances` のみ）へ分離して解決。
- 教訓: **カラム単位のSELECT制限は `select('*')` を使うアプリ全体と両立しない**。
  秘匿カラムは別テーブルに分離するのが正解。

### Q19. 価値観タグのラベルは変更なし（M6・暫定判断）
- 判断#5の「ラベル微調整」について、30タグを監査した結果、M1改の時点で中高年向けに
  設計されておりトーン不整合が無いため**変更なし**と判断。タグの拡充・カテゴリ再編は
  デザイナーUI刷新と同時期に実施（decisions 2026-07-07 §4）。

### Q11. discover のフィルタ変換ロジックの配置（M3・軽微な構造判断）
- 設計書 §5.3 は `apps/mobile/src/lib/discover-query.ts` に純粋関数を置く指定だが、
  §8.1 が同ロジックを packages/shared の Vitest 対象に指定しているため、
  **変換の純粋関数は `packages/shared/src/discover_filters.ts`** に置き、
  mobile 側の `discover-query.ts` は PostgREST への適用のみの薄い層とした（設計意図どおりテスト可能）。

### Q20. `apps/admin/lib/supabase-admin.ts` への `import 'server-only'`（2026-09-02・非ブロッカー）
- レビュー指摘（PR#1 コメント3651267595・P3提案）。service_role キーを持つファイルの
  クライアント側import をビルド時に検出できるようになる。
- **`server-only` パッケージが未導入で、依存追加はオーナー承認が必要**なため見送り中。
- 承認いただければ `pnpm add server-only --filter @hapimari/admin` + import 1行で対応可。

### Q21. ローカルDBの残骸データ1件の修正（2026-09-02・非ブロッカー・承認待ち）
- ローカルDBに「匿名化済みなのに status='active'」の行が1件あり（nickname='退会済み'・
  birth_date=1900年・過去の手動テストの残骸）。このせいで test_m65_p1 のage検査が
  FAILする（コード起因ではない。本番には存在しない）。
- データ上書きにあたるため停止中。承認後に次の1行を実行:
  `update profiles set status = 'withdrawn', withdrawn_at = coalesce(withdrawn_at, anonymized_at) where anonymized_at is not null and status = 'active';`
