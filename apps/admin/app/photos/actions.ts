'use server';

import { revalidatePath } from 'next/cache';
import { assertAdminAuth } from '@/lib/admin-auth';
import { supabaseAdmin } from '@/lib/supabase-admin';

/** 承認: 承認された写真だけが profiles_public 経由で他のお相手に表示される */
export async function approvePhoto(formData: FormData) {
  await assertAdminAuth();
  const path = String(formData.get('path') ?? '');
  if (!path) return;
  const { error } = await supabaseAdmin
    .from('photo_reviews')
    .update({ status: 'approved', reviewed_at: new Date().toISOString() })
    .eq('path', path);
  if (error) throw new Error(`承認に失敗しました: ${error.message}`);
  revalidatePath('/photos');
  revalidatePath('/');
}

/**
 * 却下: 表示対象から外し、本人の photo_urls からも取り除き、
 * 画像の実体も削除する（発行済みの署名URL(1時間)を即座に無効化するため。
 * オブジェクトが残っていると却下後も既存の署名URLで閲覧できてしまう）
 */
export async function rejectPhoto(formData: FormData) {
  await assertAdminAuth();
  const path = String(formData.get('path') ?? '');
  const userId = String(formData.get('userId') ?? '');
  if (!path || !userId) return;

  const { error } = await supabaseAdmin
    .from('photo_reviews')
    .update({ status: 'rejected', reviewed_at: new Date().toISOString() })
    .eq('path', path);
  if (error) throw new Error(`却下に失敗しました: ${error.message}`);

  // seed の外部URL（http〜）はバケットに実体が無いため削除対象外
  if (!/^https?:\/\//.test(path)) {
    const { error: removeError } = await supabaseAdmin.storage.from('photos').remove([path]);
    if (removeError) throw new Error(`画像の削除に失敗しました: ${removeError.message}`);
  }

  const { data: profile } = await supabaseAdmin
    .from('profiles')
    .select('photo_urls')
    .eq('id', userId)
    .maybeSingle();
  if (profile?.photo_urls?.includes(path)) {
    const { error: updateError } = await supabaseAdmin
      .from('profiles')
      .update({ photo_urls: profile.photo_urls.filter((p) => p !== path) })
      .eq('id', userId);
    if (updateError) throw new Error(`プロフィールの更新に失敗しました: ${updateError.message}`);
  }

  revalidatePath('/photos');
  revalidatePath('/');
}
