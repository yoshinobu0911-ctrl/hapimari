'use server';

import { revalidatePath } from 'next/cache';
import { assertAdminAuth } from '@/lib/admin-auth';
import { supabaseAdmin } from '@/lib/supabase-admin';

/** JSTの今日（yyyy-mm-dd） */
function todayJst(): string {
  return new Intl.DateTimeFormat('sv-SE', { timeZone: 'Asia/Tokyo' }).format(new Date());
}

/**
 * daily_stats の手動集計（判断#3: pg_cron日次 + 手動ボタンの併用）。
 * pg_cron が使えない環境や、当日分を今すぐ見たいときに使う。
 */
export async function computeTodayStats() {
  await assertAdminAuth();
  const { error } = await supabaseAdmin.rpc('compute_daily_stats', { p_date: todayJst() });
  if (error) throw new Error(`集計に失敗しました: ${error.message}`);
  revalidatePath('/');
  revalidatePath('/transparency');
}
