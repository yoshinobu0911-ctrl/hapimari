# ハピマリ 監査チェックリスト（再利用用・後継AI向け）

> 初版: 2026-07-13 / Claude Fable 5 のマルチエージェント全面監査（96エージェント）から抽出。
> 目的: 以後の監査を**安価なモデルでも同品質で・重複なく**回せるようにする。SPEC変更や新マイルストーンの前後にこのチェックリストで再監査する。
> 使い方: このファイル＋対象コミットを監査AIに渡し、「下記8次元を静的に監査し、§C の既知棄却リストに該当するものは報告しない。実コードで裏取りできた指摘のみ file:line 付きで返す」と指示する。

---

## A. この製品で最も壊れやすい「背骨」（監査の主眼）

**関係性ベースの安全機能が、DBとクライアントの両層で担保されているか。** 2026-07-13 監査ではP0の9件中7件がここに集中した。新しいコードを読むとき、常にこう問う:

> 「認証済みユーザーAは、ブロックした/退会した/一度も接点のない被害者Bの何を、読み/書き/追跡できてしまうか？」

具体的な"背骨"は5つ: **ブロック / 退会・凍結 / 位置情報 / 写真・本人確認画像 / 管理画面認証**。この5つに触れる差分は必ず重点監査する。

---

## B. 8つの監査次元（各次元＝1エージェント）

| 次元 | 主眼 | 主対象ファイル |
|---|---|---|
| 1. RLS・認可 | 他人のデータ読み書き穴、security definer の RLS 貫通、位置RPCの認可欠落 | `supabase/migrations/*.sql`, `functions/like/index.ts`, `apps/admin/**/actions.ts`, `supabase-admin.ts` |
| 2. クライアント側露出 | `select('*')` によるPII過剰取得、Realtime購読、公開バケット、秘密情報混入 | `apps/mobile/src/lib/*.ts`, `hooks/*`, `realtime-profile-sync.tsx`, `app.json` |
| 3. マッチング/相性ロジック | 境界値・ゼロ除算・正規化の数学的誤り・重み不整合・画面間の値の食い違い | `packages/shared/src/compatibility.ts`, `like_rules.ts`, `discover_filters.ts` |
| 4. 課金・ペイウォール | **クライアントのみの判定＝バイパス**、DB付与RPCの直叩き、退会/期限切れ時の状態不整合 | `subscription.tsx`, `lib/payment.ts`, `m6_subscription_location.sql` |
| 5. 状態遷移・エッジケース | 認証/オンボーディング/退会/GPSの途中離脱・二重送信・レース・詰み状態 | `stores/*`, `app/index.tsx`, `(auth)/*`, `lib/location.ts`, `[matchId]系` |
| 6. SPEC整合性 | 受け入れ条件・絶対ルール（全テーブルRLS・年齢制限・仮想通貨禁止等）と実装の乖離 | `SPEC.md`, `docs/acceptance/*`, `QUESTIONS.md` |
| 7. DBスキーマ品質 | 欠落制約(unique/check/FK)、欠落index、on delete、退会時の孤児レコード、seed事故 | `supabase/migrations/*`, `seed.sql` |
| 8. 依存・設定・CI | 権限過剰(位置/カメラ)、CI検証漏れ、`.env`コミット、目的文欠落 | `package.json`, `app.json`, `ci.yml`, `.gitignore`, `config.toml` |

**検証プロトコル**: 各指摘は「反証レンズ（実害なし/仕様どおり/事実誤認を探す）」＋「影響度レンズ（発生条件の現実性と被害）」の2エージェントで検証し、反証されたものは落とす。偽陽性を通さないため、確信が持てなければ棄却側に倒す。

---

## C. 既知の棄却リスト（再報告しない — 2026-07-13 監査で調査済み・シロ確定）

以下は一度疑って調査し「実害なし/仕様どおり」と確定済み。**再監査で再び挙げないこと**（挙げるなら「棄却理由が覆る新事実」を明示する）。

1. いいね `carriedOver` フラグの二重化 → クライアント未使用、表示は `assignVisibleDates` が正典。
2. 退会後も `subscription_active=true` 残存 → messages RLS が active も要求し無効化。課金は常時成功モックで金銭価値ゼロ。
3. `subscription_active` 列が全員に見える → M6でSELECT可と承認済み。R9仕様上「送信可＝課金済み」は公知。
4. 透明性レポート2指標が近似値 → QUESTIONS Q17 に記録済みの意図的暫定仕様、未公開。
5. seed末尾のUPDATEがUUID非限定 → 実行経路は空DB再構築のみ、本番不在、「デモ男性=課金」は仕様。
6. 全FKに on delete 指定なし → 承認済みソフトデリート設計の帰結。cascadeはむしろ通報証跡を消し危険。
7. `review_verification` が reviewed_by 未設定 → 管理者アイデンティティ自体が未実装(Q5)で記録値がない。M2はモック。
8. CIが型チェックしない → SPEC M0が「CI=lint+test」と規定。型は各受け入れで `tsc --noEmit` 実施済み。
9. flagged一覧が50件limitのみ → M3設計 §6.3 どおりの意図実装。対応は /reports に集約。
10. 本人確認書類のEXIF漏洩(別経路) → verifications バケットのMIME allowlistがHEIC/TIFF/AVIFを415拒否。WebP経路はiPhone非生成で非現実的。

---

## D. 次マイルストーンで塞ぐべき"根っこ"（個別対処より上流の3投資）

1. **関係性ベース認可の一元化**: `is_blocked_between` を単一の認可関数化し、messages・matches・photos・位置RPCの全経路から参照。→ P0-1/2/3/5 の根が一括で塞がる。
2. **退会/凍結の状態機械を集約**: `withdraw_account` に「status更新＋関連データ後始末＋入口ゲート分岐＋管理操作のstatusガード」まで含め、状態遷移を1箇所に。→ P0-6・P1-10。
3. **画像処理パイプライン標準化＋管理画面認証ゲート化**: 全アップロードをEdge Function経由でサーバ側JPEG再エンコード＋EXIF除去に統一。管理画面認証を本番デプロイの必須ゲートに。→ P0-8/9・P0-4。

---

## E. 監査の実行記録

- 2026-07-13: Fable 5 マルチエージェント全面監査。生37→重複統合30→確認31/棄却10。P0(high)9・P1(medium)12・P2(low)10。報告書は [2026-07-13_全面監査_Fable5.md](2026-07-13_全面監査_Fable5.md)、構造化データは同ディレクトリの `_findings.json`。
