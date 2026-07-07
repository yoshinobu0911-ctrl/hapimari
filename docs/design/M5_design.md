# M5 設計書: 音声通話（モックSDK）

> **本書の使い方**: M3/M4設計書と同様の自己完結ドキュメント。実装前に §1 と
> `docs/design/M3_design.md` §1.2（環境の落とし穴）を必読。
> **本書はオーナー承認後に実装着手する**（CLAUDE.md §4。§9の判断が承認された前提で書いてある）。

---

## 1. 前提と環境

- 環境・落とし穴は M3設計書 §1 のとおり。適用済みmigrationは7本（最新: `20260707100000_m4_date_proposals.sql`）。
- **calls テーブルはM0で作成済み**（id / match_id / started_at / ended_at / duration_seconds / created_at。
  RLS: 当事者のみ SELECT/INSERT/UPDATE。GRANTも付与済み）→ **スキーマ変更はRLS強化1点のみ**。
- R5の解禁判定は `matches.call_unlocked`（generated column: message_count>=10）が既にDBで計算している。
- テストペア: **たかし(seed01)×ようこ(seed13) が message_count=24 で通話解禁済み**。
  ひろし(seed03)×みほ(seed15) は3通で未解禁（ボタン非表示の確認に使う）。
- 定数: `CALL_MAX_DURATION_SECONDS = 900`（15分・constants.tsに定義済み）。

## 2. スコープ

### 2.1 In Scope

| # | 機能 | 対応 |
|---|---|---|
| S1 | `packages/shared/src/call-provider.ts`: **CallProvider インターフェース**（Agora差し替えポイント） | SPEC §8 |
| S2 | モック実装: **Supabase Realtime broadcast によるシグナリング**（発信・着信・応答・拒否・切断は本物、**音声は流れない**） | SPEC §6 M5 |
| S3 | chatヘッダに📞通話ボタン（**call_unlocked=true のときだけ表示**。未解禁は非表示） | R5・受け入れ条件 |
| S4 | 通話前注意ダイアログ（連絡先交換・金銭話への注意） | SPEC §6 M5 |
| S5 | 通話画面（呼び出し中/通話中/終了・経過と残り時間表示・終了ボタン） | - |
| S6 | **15分（900秒）で自動切断** | SPEC §6 M5 |
| S7 | callsログ記録（応答時に started_at、終了時に ended_at + duration_seconds） | SPEC §3.7 |
| S8 | RLS強化: calls INSERT に「そのマッチが call_unlocked であること」を追加 | R5のサーバ側担保 |

### 2.2 Out of Scope（混ぜない）

実音声の送受信（Agora本実装で差し替え）/ プッシュ着信・バックグラウンド着信 /
通話履歴画面（ログはDBのみ。運営向け表示はM6以降）/ ビデオ通話 / 通話中ミュート等の操作

### 2.3 受け入れ条件（SPEC §6 M5）

1. 通話解禁前（10通未満）は通話ボタンが**非表示**
2. 解禁後に**発着信**できる（発信→相手に着信→応答→通話中）
3. **15分で自動切断**される
4. calls に**ログが記録**される（開始・終了・通話秒数）

## 3. データ設計（migration 1本: `2026xxxx_m5_calls_guard.sql`）

```sql
-- R5をサーバ側でも担保: 未解禁マッチへの calls INSERT を拒否
drop policy "当事者のみ記録作成可" on calls;
create policy "当事者かつ通話解禁済みのみ記録作成可" on calls
  for insert to authenticated
  with check (
    public.is_match_participant(match_id)
    and exists (select 1 from matches where id = match_id and call_unlocked)
  );
```

他のテーブル変更なし。ログの書き込みは**発信者のみ**が行う（二重書き込み防止の規約）:
応答受信時に INSERT（started_at）、終了時に UPDATE（ended_at・duration_seconds）。

## 4. CallProvider 設計（packages/shared/src/call-provider.ts）

```ts
type CallState = 'idle' | 'calling' | 'ringing' | 'connected' | 'ended';
type CallEndReason = 'hangup' | 'declined' | 'timeout' | 'no_answer' | 'error';

interface CallProviderEvents {
  onStateChange(state: CallState): void;
  onEnded(reason: CallEndReason): void;
}

interface CallProvider {
  /** 発信（相手が30秒応答しなければ no_answer で終了） */
  startCall(matchId: string, selfId: string, events: CallProviderEvents): Promise<CallHandle>;
  /** 着信の監視を開始（chat画面がマウント中のみ） */
  listen(matchId: string, selfId: string, onIncoming: () => void): () => void;
  /** 着信に応答して通話に参加 */
  joinCall(matchId: string, selfId: string, events: CallProviderEvents): Promise<CallHandle>;
  declineCall(matchId: string, selfId: string): Promise<void>;
}
interface CallHandle { hangup(): void; }
```

- モック実装 `RealtimeMockCallProvider` は Supabase Realtime の **broadcastチャネル `call-{matchId}`** で
  `invite / accept / decline / hangup` イベントを送受信する。**シグナリング（状態遷移）は本物、音声はなし**。
  画面には「モック通話中（音声は流れません）」と明示する。
- Agora導入時はこのインターフェースの別実装を作って差し替える（呼び出し側は無変更）。
- タイマー計算は純粋関数に分離: `remainingCallSeconds(startedAtMs, nowMs, max=900)` と
  `formatCallDuration(seconds)`（Vitest対象）。自動切断は残り0で `hangup()` を呼ぶ。

## 5. フロントエンド（apps/mobile）

| 画面 | 変更 |
|---|---|
| `chat/[matchId]` | ヘッダに📞ボタン（`match.call_unlocked` かつ相手プロフィール取得可のときのみ描画=未解禁・ブロック時は非表示）。マウント中は `listen()` で着信を監視し、着信時は**応答/拒否バナー**を表示 |
| `call/[matchId]`（新規・params: role=caller\|callee） | 相手の名前（大）・状態表示（呼び出し中…/通話中/終了）・**経過時間と残り時間**・「モック通話（音声は流れません）」注記・終了ボタン（大・赤） |

- 発信フロー: 📞タップ → **通話前注意ダイアログ**
  「電話番号・LINEなどの連絡先交換は、十分に信頼できるまでお控えください。金銭・投資の話が出たら通話をやめて通報をご検討ください。」
  → OK → call画面(caller) → invite送信 → accept受信で connected・callsにINSERT
- 着信フロー: chat画面に着信バナー →「応答」→ call画面(callee) → accept送信 → connected /「拒否」→ decline送信
- 終了: どちらかの終了ボタン or 残り0秒（自動切断・reason=timeout）→ 両者 ended → callerが UPDATE でログ確定 → router.back()
- **MVP制約（重要）**: 着信に気づけるのは**相手がそのチャット画面を開いている間だけ**
  （プッシュ着信なし）。画面に「お相手がチャット画面を開いているときにつながります」と表示して誤解を防ぐ。
- typed routes 再生成を忘れない。

## 6. テスト・受け入れ計画

| 種別 | 内容 |
|---|---|
| Vitest | `remainingCallSeconds`（900秒境界・自動切断判定・負値なし）/ `formatCallDuration`（0:00/14:59/15:00表記） |
| RLS | 未解禁マッチ（ひろし×みほ）への calls INSERT → **RLS拒否**（migration §3の実測） |
| E2E-1 | ひろし×みほのchat: 📞**非表示**（受け入れ条件1） |
| E2E-2 | ようこ(ブラウザUI)が発信 → **Nodeスクリプトの「たかしクライアント」**（repoのsupabase-jsで本人ログイン・同一broadcastチャネル購読）が応答 → connected表示（受け入れ条件2） |
| E2E-3 | 手動切断 → calls行に started_at / ended_at / duration_seconds が記録（受け入れ条件4） |
| 15分自動切断 | 実時間15分は非現実的のため **Vitestで900秒境界を担保**し、実装は `CALL_MAX_DURATION_SECONDS` 定数を使用（受け入れ条件3。M3のR4・M4の翌日FBと同じ「時間系は単体テスト+定数」方式） |

完了時: `docs/acceptance/M5.md` / QUESTIONS.md追記 / 日本語論理コミット / Biome・tsc・Vitest全緑

## 7. 実装順序

| Phase | 内容 | 目安 |
|---|---|---|
| P1 | migration（calls INSERTポリシー強化）+ psql検証 + 型再生成 | 小 |
| P2 | shared: call-provider IF + タイマー純粋関数 + Vitest | 小 |
| P3 | mobile: RealtimeMockCallProvider + chatボタン/着信バナー + call画面 | 大 |
| P4 | E2E（Node相手役スクリプト）・受け入れ記録・コミット | 中 |

## 8. リスク・既知の制限

1. 音声は流れない（モック）。「通話できた感」はシグナリングと画面遷移で表現し、画面に明示する。
2. 着信はチャット画面表示中のみ（プッシュなし）。本番前にAgora+プッシュ通知で解消する前提。
3. Realtime broadcastチャネルはRLSの対象外（誰でも同名チャネルに参加可能）。モックでは
  イベントに from（uuid）を載せ、当事者以外のイベントは無視する。**通話の秘匿性が必要になる
  Agora本実装ではトークン認証が入る**ため、モック段階の許容リスクとして記録する。

## 9. 設計判断（推奨案。オーナー承認を得てから実装）

| # | 論点 | 推奨案 | 代替案 |
|---|---|---|---|
| 1 | モックの深さ | **音声なし・発着信/応答/切断/タイマー/ログは本物**（Realtimeシグナリング。E2E可能・Agora差し替え前提が明確） | WebRTCで実音声（工数大・ブラウザ権限依存でE2E不安定） |
| 2 | R5のサーバ側担保 | **calls INSERTポリシーに call_unlocked 条件を追加**（小さなRLS変更・§3） | UIの非表示のみ（改ざん耐性なし） |
| 3 | 15分自動切断の検証 | **単体テストで900秒境界を担保**（実装は定数。E2Eは短い通話で開始〜終了〜ログを確認） | devビルド限定の時間短縮オプションを実装（テスト用コードが本体に混入） |
| 4 | 着信の可達範囲 | **チャット画面表示中のみ着信（MVP制約として画面に明示）** | 全画面で着信監視（常時チャネル接続が増えコスト・複雑化） |
