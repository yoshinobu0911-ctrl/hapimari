import type { Database } from '@hapimari/shared/types';
import { createClient } from '@supabase/supabase-js';

// 管理画面は service_role で動作する（RLSバイパス・SPEC §3 RLS方針）。
// フォールバックは supabase start の共通デモ値（ローカル開発専用の公開値）。
// 本番（NODE_ENV=production）では環境変数未設定のまま起動させない。
const isProduction = process.env.NODE_ENV === 'production';

function requireEnv(name: string, devFallback: string): string {
  const value = process.env[name];
  if (value) return value;
  if (isProduction) {
    throw new Error(`環境変数 ${name} が未設定です。本番ではデモ値フォールバックを使用しません。`);
  }
  return devFallback;
}

const supabaseUrl = requireEnv('NEXT_PUBLIC_SUPABASE_URL', 'http://127.0.0.1:54321');
const serviceRoleKey = requireEnv(
  'SUPABASE_SERVICE_ROLE_KEY',
  'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZS1kZW1vIiwicm9sZSI6InNlcnZpY2Vfcm9sZSIsImV4cCI6MTk4MzgxMjk5Nn0.EGIM96RAZx35lJzdJsyH-qQwv8Hdp7fsn3W0YpN81IU',
);

export const supabaseAdmin = createClient<Database>(supabaseUrl, serviceRoleKey, {
  auth: {
    persistSession: false,
    autoRefreshToken: false,
  },
});
