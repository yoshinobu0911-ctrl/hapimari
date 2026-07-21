'use server';

import { revalidatePath } from 'next/cache';
import { assertAdminAuth } from '@/lib/admin-auth';
import { supabaseAdmin } from '@/lib/supabase-admin';

/** 承認: verifications.status を approved にし、profiles の該当フラグを立てる（DB関数で原子的に） */
export async function approveVerification(formData: FormData) {
  await assertAdminAuth();
  const id = String(formData.get('id') ?? '');
  if (!id) return;
  const { error } = await supabaseAdmin.rpc('review_verification', {
    verification_id: id,
    approve: true,
  });
  if (error) throw new Error(`承認に失敗しました: ${error.message}`);
  revalidatePath('/verifications');
  revalidatePath('/');
}

/** 却下: 理由付きで rejected にする（profiles は変更しない） */
export async function rejectVerification(formData: FormData) {
  await assertAdminAuth();
  const id = String(formData.get('id') ?? '');
  const reason = String(formData.get('reason') ?? '').trim();
  if (!id) return;
  const { error } = await supabaseAdmin.rpc('review_verification', {
    verification_id: id,
    approve: false,
    reason: reason || '書類を確認できませんでした。鮮明な画像で再提出してください。',
  });
  if (error) throw new Error(`却下に失敗しました: ${error.message}`);
  revalidatePath('/verifications');
  revalidatePath('/');
}
