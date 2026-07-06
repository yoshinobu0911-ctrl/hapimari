'use server';

import { revalidatePath } from 'next/cache';
import { supabaseAdmin } from '@/lib/supabase-admin';

function revalidateReportPages() {
  revalidatePath('/reports');
  revalidatePath('/users');
  revalidatePath('/');
}

/** 対応済みにする（ユーザーへの措置なし） */
export async function markActioned(formData: FormData) {
  const id = String(formData.get('id') ?? '');
  if (!id) return;
  const { error } = await supabaseAdmin.from('reports').update({ status: 'actioned' }).eq('id', id);
  if (error) throw new Error(`更新に失敗しました: ${error.message}`);
  revalidateReportPages();
}

/** 対応済みにし、対象ユーザーを凍結する */
export async function actionAndSuspend(formData: FormData) {
  const id = String(formData.get('id') ?? '');
  const reported = String(formData.get('reported') ?? '');
  if (!id || !reported) return;
  const { error: reportError } = await supabaseAdmin
    .from('reports')
    .update({ status: 'actioned' })
    .eq('id', id);
  if (reportError) throw new Error(`通報の更新に失敗しました: ${reportError.message}`);
  const { error: suspendError } = await supabaseAdmin
    .from('profiles')
    .update({ status: 'suspended' })
    .eq('id', reported);
  if (suspendError) throw new Error(`凍結に失敗しました: ${suspendError.message}`);
  revalidateReportPages();
}

/** 棄却（対応不要と判断） */
export async function dismissReport(formData: FormData) {
  const id = String(formData.get('id') ?? '');
  if (!id) return;
  const { error } = await supabaseAdmin
    .from('reports')
    .update({ status: 'dismissed' })
    .eq('id', id);
  if (error) throw new Error(`更新に失敗しました: ${error.message}`);
  revalidateReportPages();
}
