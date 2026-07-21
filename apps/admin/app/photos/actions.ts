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
 * 却下: 表示対象から外し、本人の photo_urls からも取り除く
 * （本人の画面が「写真なし」になり、別の写真の再アップロードを促せる）
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
