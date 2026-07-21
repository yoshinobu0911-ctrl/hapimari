'use server';

import { revalidatePath } from 'next/cache';
import { assertAdminAuth } from '@/lib/admin-auth';
import { supabaseAdmin } from '@/lib/supabase-admin';

function revalidateUserPages() {
  revalidatePath('/users');
  revalidatePath('/reports');
  revalidatePath('/flagged');
  revalidatePath('/');
}

/**
 * 凍結: status='suspended'。
 * 効果: discoverから消える（既存RLS）+ メッセージ送信不可（RLSのstatus='active'条件）
 */
export async function suspendUser(formData: FormData) {
  await assertAdminAuth();
  const id = String(formData.get('id') ?? '');
  if (!id) return;
  const { error } = await supabaseAdmin
    .from('profiles')
    .update({ status: 'suspended' })
    .eq('id', id);
  if (error) throw new Error(`凍結に失敗しました: ${error.message}`);
  revalidateUserPages();
}

/** 凍結解除: status='active' */
export async function reactivateUser(formData: FormData) {
  await assertAdminAuth();
  const id = String(formData.get('id') ?? '');
  if (!id) return;
  const { error } = await supabaseAdmin.from('profiles').update({ status: 'active' }).eq('id', id);
  if (error) throw new Error(`凍結解除に失敗しました: ${error.message}`);
  revalidateUserPages();
}
