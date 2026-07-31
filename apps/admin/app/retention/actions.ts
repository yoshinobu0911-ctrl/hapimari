'use server';

import { revalidatePath } from 'next/cache';
import { assertAdminAuth } from '@/lib/admin-auth';
import { supabaseAdmin } from '@/lib/supabase-admin';

/**
 * 保持ポリシーのジョブ（docs/legal/privacy_policy.md §6）
 *
 * 1. 退会から90日を過ぎた利用者を匿名化する（DB側の RPC）
 *    → 個人を特定できる情報を消し、学習用の特徴量だけを残す
 * 2. 写真・本人確認書類の「実体」を Storage API で削除する
 *    → Supabase は SQL からの storage テーブル直接DELETEを禁止しているため、
 *      DB側は削除待ちキューに積むだけにしてあり、ここで実際に消す
 *
 * 将来 M7 でBEサーバーを立てたら、この処理を日次のcronから呼ぶ。
 * それまでは管理画面のボタンで手動実行する。
 */
export async function runRetentionJob(): Promise<{
  anonymized: number;
  filesDeleted: number;
  fileErrors: string[];
}> {
  await assertAdminAuth();

  const { data: jobResult, error: jobError } = await supabaseAdmin.rpc('run_retention_job');
  if (jobError) throw new Error(`匿名化ジョブに失敗しました: ${jobError.message}`);

  const { data: pending, error: pendingError } = await supabaseAdmin.rpc(
    'get_pending_file_deletions',
  );
  if (pendingError) throw new Error(`削除待ちの取得に失敗しました: ${pendingError.message}`);

  // バケットごとにまとめて削除（Storage API は複数パスを一度に受け付ける）
  const byBucket = new Map<string, string[]>();
  for (const row of pending ?? []) {
    const list = byBucket.get(row.bucket_id) ?? [];
    list.push(row.path);
    byBucket.set(row.bucket_id, list);
  }

  let filesDeleted = 0;
  const fileErrors: string[] = [];
  for (const [bucket, paths] of byBucket) {
    const { error } = await supabaseAdmin.storage.from(bucket).remove(paths);
    if (error) {
      fileErrors.push(`${bucket}: ${error.message}`);
      continue;
    }
    for (const path of paths) {
      await supabaseAdmin.rpc('mark_file_deleted', { p_bucket: bucket, p_path: path });
      filesDeleted += 1;
    }
  }

  revalidatePath('/retention');
  return {
    anonymized: (jobResult as { anonymized?: number } | null)?.anonymized ?? 0,
    filesDeleted,
    fileErrors,
  };
}
