import type { Database } from '@hapimari/shared/types';
import AsyncStorage from '@react-native-async-storage/async-storage';
import { createClient } from '@supabase/supabase-js';
import { Platform } from 'react-native';

// ローカル開発時のフォールバックは supabase start の共通デモ値（全開発者共通の公開値）。
// 本番ビルド（__DEV__ === false）では環境変数未設定のまま起動させない。
if (
  !__DEV__ &&
  !(process.env.EXPO_PUBLIC_SUPABASE_URL && process.env.EXPO_PUBLIC_SUPABASE_ANON_KEY)
) {
  throw new Error(
    '環境変数 EXPO_PUBLIC_SUPABASE_URL / EXPO_PUBLIC_SUPABASE_ANON_KEY が未設定です。本番ビルドではデモ値フォールバックを使用しません。',
  );
}

const supabaseUrl = process.env.EXPO_PUBLIC_SUPABASE_URL ?? 'http://127.0.0.1:54321';
const supabaseAnonKey =
  process.env.EXPO_PUBLIC_SUPABASE_ANON_KEY ??
  'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZS1kZW1vIiwicm9sZSI6ImFub24iLCJleHAiOjE5ODM4MTI5OTZ9.CRXP1A7WOeoJeXxjNni43kdQwgnWNReilDMblYTn_I0';

export const supabase = createClient<Database>(supabaseUrl, supabaseAnonKey, {
  auth: {
    // WebではlocalStorage（デフォルト）、ネイティブではAsyncStorageを使う
    ...(Platform.OS !== 'web' ? { storage: AsyncStorage } : {}),
    autoRefreshToken: true,
    persistSession: true,
    detectSessionInUrl: false,
  },
});

export type Profile = Database['public']['Tables']['profiles']['Row'];
export type ProfileInsert = Database['public']['Tables']['profiles']['Insert'];
export type ProfileUpdate = Database['public']['Tables']['profiles']['Update'];

/**
 * 他人のプロフィール（M6.5: profiles_public ビュー経由でのみ取得可能）。
 * birth_date の代わりにサーバー計算済みの age を持ち、
 * 子ども関連・理解宣言・subscription_active は含まれない（秘匿）。
 * 自動生成のビュー型は全列 nullable になるため、実際のNOT NULL制約に
 * 合わせた型をここで宣言し、取得時に PublicProfile へキャストして使う。
 */
export interface PublicProfile {
  id: string;
  nickname: string;
  gender: string;
  age: number;
  prefecture: string;
  city: string | null;
  marital_history: string;
  marriage_intent: string | null;
  cohabit_view: string | null;
  money_view: string | null;
  bio: string | null;
  available_times: string[] | null;
  value_tags: string[];
  photo_urls: string[] | null;
  is_verified: boolean;
  income_verified: boolean;
  single_cert_verified: boolean;
  status: string;
  created_at: string | null;
}
