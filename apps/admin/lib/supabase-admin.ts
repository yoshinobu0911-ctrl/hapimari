import type { Database } from '@hapimari/shared/types';
import { createClient } from '@supabase/supabase-js';

// 管理画面は service_role で動作する（RLSバイパス・SPEC §3 RLS方針）。
// フォールバックは supabase start の共通デモ値（ローカル開発専用の公開値）。
// 本番デプロイ時は必ず環境変数を設定し、この画面自体に認証を導入すること（QUESTIONS.md参照）。
const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL ?? 'http://127.0.0.1:54321';
const serviceRoleKey =
  process.env.SUPABASE_SERVICE_ROLE_KEY ??
  'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZS1kZW1vIiwicm9sZSI6InNlcnZpY2Vfcm9sZSIsImV4cCI6MTk4MzgxMjk5Nn0.EGIM96RAZx35lJzdJsyH-qQwv8Hdp7fsn3W0YpN81IU';

export const supabaseAdmin = createClient<Database>(supabaseUrl, serviceRoleKey, {
  auth: {
    persistSession: false,
    autoRefreshToken: false,
  },
});
