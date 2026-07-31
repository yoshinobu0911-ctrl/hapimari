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
 * 効果: discoverから消える + メッセージ送信・デート機能・測距・写真閲覧を全てDB層で拒否
 *       （M6.6: is_caller_active() を各経路が参照）。
 * 加えて認証セッション自体をbanし、発行済みトークンでの継続利用も断つ（多層防御）。
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
  // 100年相当。DB層の遮断が本命で、これは発行済みトークンを失効させる補強
  const { error: banError } = await supabaseAdmin.auth.admin.updateUserById(id, {
    ban_duration: '876000h',
  });
  if (banError) throw new Error(`凍結（セッション失効）に失敗しました: ${banError.message}`);
  revalidateUserPages();
}

/** 凍結解除: status='active' + セッションbanの解除 */
export async function reactivateUser(formData: FormData) {
  await assertAdminAuth();
  const id = String(formData.get('id') ?? '');
  if (!id) return;
  const { error } = await supabaseAdmin.from('profiles').update({ status: 'active' }).eq('id', id);
  if (error) throw new Error(`凍結解除に失敗しました: ${error.message}`);
  const { error: unbanError } = await supabaseAdmin.auth.admin.updateUserById(id, {
    ban_duration: 'none',
  });
  if (unbanError)
    throw new Error(`凍結解除（セッション復帰）に失敗しました: ${unbanError.message}`);
  revalidateUserPages();
}
