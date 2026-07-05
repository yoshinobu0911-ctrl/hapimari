# ハピマリ（hapimari）

中高年向け再婚・パートナー探しマッチングアプリの MVP モノレポ。仕様は [SPEC.md](./SPEC.md) を参照。

## 構成

| パス | 内容 |
|---|---|
| `apps/mobile` | Expo（React Native / TypeScript / expo-router） |
| `apps/admin` | 管理画面（Next.js App Router / Tailwind） |
| `packages/shared` | 共有型・定数・fraud_words・隣接県マップ |
| `supabase/migrations` | DBスキーマ（RLS込み） |
| `supabase/functions` | Edge Functions |
| `docs/acceptance` | マイルストーンごとの受け入れ記録 |

## セットアップ

前提: Node.js 20+ / pnpm / Docker Desktop（Supabaseローカル環境用）

```bash
pnpm install
pnpm db:start        # Supabaseローカル起動（初回はDockerイメージ取得で数分かかる）
pnpm db:reset        # migration + seed 投入
pnpm db:types        # DB型を packages/shared に生成
pnpm dev             # mobile(Expo) と admin(Next.js) を同時起動
```

- admin: http://localhost:3000
- Supabase Studio: http://localhost:54323
- mobile: Expo Go または開発ビルドで起動（ターミナルのQRコード参照）

## モック差し替えポイント（SPEC §8）

| 依存 | インターフェース | 差し替え方法 |
|---|---|---|
| 決済（RevenueCat） | `packages/shared/src/payment-provider.ts` | 本番キー取得後、モック実装を実SDKに差し替え |
| 音声通話（Agora） | `packages/shared/src/call-provider.ts` | 同上（M5で作成） |
| eKYC | なし（目視審査運用） | 管理画面の審査キューが正式フロー |

## 開発ルール

- Lint/Format: Biome（`pnpm lint` / `pnpm format`）
- テスト: Vitest（`pnpm test`）
- コミットメッセージは日本語
- 不明点は `QUESTIONS.md` へ
