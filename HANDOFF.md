# 引き継ぎ書（2026-08-27・セッションクリア前のスナップショット）

> **最新の状態は常に `progress.md` が正**（本書は8/19〜8/27セッションの固定記録）。
> 旧引き継ぎ `docs/HANDOFF_2026-08-14.md` は本書で置き換え。
> 読者想定: 次のAIセッションと委託エンジニア。まず本書→`progress.md`→各設計書の順で読む。

---

## 1. このセッションで達成したこと（テーマ別・コミット付き）

### M7.2 決済の画面側（08-19・c06112b / 62a2dd9）
- `apps/mobile/src/app/subscription.tsx` **全面改修**: 5状態（未契約/契約中/解約予約/支払いトラブル/反映待ち）。3プラン選択（3ヶ月→6ヶ月→1ヶ月・初期3ヶ月）・Checkout起動・2秒×5回の反映待ちポーリング・解約/取り消し・本人確認誘導・法定4行
- 新規: `lib/subscription-api.ts`・`hooks/use-my-subscription.ts`・`packages/shared/src/subscription-view.ts`（+テスト17件）
- 削除: モック課金一式（`lib/payment.ts`・`shared/src/payment-provider.ts`・旧SUBSCRIPTION_PLANS）
- サーバー: `stripe-checkout` に past_due旧契約の先行キャンセル＋セッション有効期限31分、`stripe-webhook` に契約置き換え時の巻き戻し防止ガード
- migration `20260819100000`: `is_subscription_active` を本人限定化（他会員の課金状態を照会不可）
- **重要**: M7.1のmigrationがローカル未適用だったのを発見し適用＋型再生成

### 残タスク一括消化（08-19・7c1c6a1 ほか）
- migration `20260819110000`: `messages.kind` 列（user/system）。列GRANT外のため**利用者はkindを偽装できない**（実測済み）。自動メッセージRPC2本にkind付与・チャットの判定を接頭辞→列参照に
- マッチ成立の演出 `components/match-celebration.tsx`（confirmDialog→専用モーダル。E2Eで実マッチ→表示→トーク遷移を確認）
- 未コミットだった全作業（UI刷新Phase0-2・M7.1・監査記録等）を論理単位6コミットに整理

### M8 音声通話の本実装（08-19調査→08-25実装・af83f07 / 34175c0 / 80faa9f）
- 方式調査 `docs/design/call_research.md`: VoIP(Agora)≈4.5円/15分通話 vs 番号マスキング≈440〜830円で**約100倍差**→Agora採用
- `supabase/functions/agora-token`: 資格チェック（当事者・非ブロック・双方active＋本人確認済み）＋16分トークン=**15分上限のサーバー側強制**
- `lib/call-provider-agora.ts`(Web): シグナリングは既存Realtimeモックを共用し、connected区間だけAgoraで実音声。`lib/call-provider.ts`/`call-provider.web.ts` の**`.web.ts`分割でネイティブへのSDK混入を防止**
- 依存追加: `agora-rtc-sdk-ng@^4.24.7`（オーナー承認済み）。shared に終了理由 `mic_denied` 追加

### 警察届出対応（08-25〜26・78bc821 / f2723d4 / 2f56296）
- `docs/legal/age_verification_description.md`: 届出書「児童でないことの確認の実施方法」の説明・**記載文例**・URL構成・18歳表示の現状と提案（行政書士面談用の一式）
- **いいね送信と音声通話を本人確認の承認後のみに変更**（like関数=送信者・agora-token=双方。5パターン実測済み）。確認前に可能なのは閲覧のみに
- 法務ドラフトの矛盾を申し送りに記録（tokushoho.mdの通話有料記載・README論点1/3）

### 並行セッションの成果（08-26・progress.md参照）
- subscription.tsx に法定リンク3本（happymarry.jp）設置・リリース残タスク棚卸し（UI刷新は実は14画面中9画面移行済みと判明）

## 2. 途中の作業と現在の状態

**すべてコミット済み・作業ツリーはクリーン。検証: biome 0 / tsc 0（mobile・admin・shared）/ sharedテスト88件成功。**

| 項目 | 状態 | 動かすのに必要なもの |
|---|---|---|
| 決済（M7.2） | コード完成・画面実描画確認済み | **実決済テストのみ未実施**（Stripeテストキー待ち→ `docs/acceptance/M7_2.md` §B） |
| 通話（M8） | コード完成・トークン発行/資格チェックは実測済み | **実音声のみ未確認**（AgoraのApp ID/Certificate待ち→ `docs/acceptance/M8.md` §B） |
| 届出 | 資料完成 | 行政書士面談（オーナー）。アプリ本番URLの決定が先決 |
| アプリ本番 | **未デプロイ**（URL未確定） | `docs/release_web.md` の手順で Vercel＋ドメイン |

## 3. 重要な設計判断（矛盾した実装をしないための要点）

1. **課金の正は `subscriptions` テーブル・書き込みはStripe Webhookのみ**。判定は `is_subscription_active()` 一本（期限を毎回評価・本人限定）。`profiles.subscription_active` は派生キャッシュ
2. **画面は権利判定をしない**。決済成功URL（?checkout=success）は表示のきっかけのみ。状態は `deriveSubscriptionView`（shared・テスト済み）でDB行から導出
3. **通話**: 課金ゲートなし（08-19決定）・**本人確認は双方必須**（08-26決定でM8設計6-1のBを上書き）・録音なし・Web先行。15分制限はトークンTTLで強制
4. **いいね**: 送信者の本人確認必須（08-26）。閲覧のみ確認前可＝行政書士回答待ちの論点
5. **年齢確認**は法的義務（出会い系サイト規制法11条）で省略不可。方式は「書面画像の電磁的送信」＝身分証アップロード＋目視審査。自己申告の生年月日は法律上の確認にならない
6. 自動メッセージ判定は `messages.kind` が正（本文の絵文字接頭辞は表示上の名残）
7. 特商法上、料金は**税込総額＋請求間隔をセットで表示**。プラン順序3→6→1と「おすすめ」は6ヶ月誘導の装置なので変えない

## 4. 既知のバグ・注意点・ハマりどころ

- **migration適用後は必ず型再生成**（M7.1が未適用のまま放置されていた前例あり。手順はCLAUDE.md §3）
- シードの契約行（`seed_cus_*`）はStripeに実体がなく**解約APIのテストには使えない**。実Checkoutで作った契約で行う
- shared単体の `tsc --noEmit` は compatibility.ts 修正済みで現在0エラー（以前は既存エラー1件あり）
- 認証後画面の確認は**セッション注入方式**（CLAUDE.md §3に手順）。シードは seed01〜20@hapimari.test / password123
- ローカルの通話・ゲート検証はダミーAgora環境変数で可能（`AGORA_APP_ID=dummy...` を書いたenvファイルを `functions serve --env-file` に渡す。実キーと混同しないこと）
- テスト残置データ: ゆみこ×のぼる のマッチ（match a0367488-…）と seed02 の契約行はローカル検証で作った実データ。`db reset` で消える
- LPは**別リポジトリ** `C:\Users\haosh\homepage\hapimari-lp`（dev外の例外）。法定3ページ（terms/privacy/tokushoho.html）は**仮文面のプレースホルダ**のまま
- Chrome拡張のブラウザ操作は稀に一時切断・スクショタイムアウトする→数秒待って再試行で回復

## 5. 次にやるべきタスク（優先順・詳細は progress.md のTODOが正）

1. 🔴 **届出**（行政書士面談。`age_verification_description.md` を渡す。受理2週間〜1ヶ月＝9/14公開の最大制約）
2. 🔴 **アプリ本番URLの決定**（届出書に必要。提案 `app.happymarry.jp`。決定後のVercel/DNS設定はAI作業）
3. 🟡 「18歳未満は利用できません」表示の追加（承認待ち・アプリ2箇所は文言変更のみ）
4. 🟡 Agoraキー共有→実音声の疎通確認（`M8.md` §B）／ Stripeキー設定→実決済テスト（`M7_2.md` §B）
5. 🟡 admin本格認証（**要設計提案→承認**。現状Basic認証のみ）・更新3日前メール通知（**要承認**・外部サービス追加の可能性）
6. 🟢 tokushoho.md の通話有料記載の修正（軽微）・UI刷新残り3〜5画面（likes・messages・index等）
