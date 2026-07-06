import { useQueryClient } from '@tanstack/react-query';
import { useEffect } from 'react';
import { supabase } from '@/lib/supabase';
import { useAuthStore } from '@/stores/auth';

/**
 * 自分の profiles 行の変更を Realtime で購読し、キャッシュを無効化する。
 * 管理画面での本人確認の承認が、リロードなしでバッジに反映される（M2受け入れ条件）。
 * ルートレイアウトに1つだけマウントする。
 */
export function RealtimeProfileSync() {
  const session = useAuthStore((s) => s.session);
  const queryClient = useQueryClient();
  const userId = session?.user.id;

  useEffect(() => {
    if (!userId) return;
    const channel = supabase
      .channel(`profile-sync-${userId}`)
      .on(
        'postgres_changes',
        { event: 'UPDATE', schema: 'public', table: 'profiles', filter: `id=eq.${userId}` },
        () => {
          queryClient.invalidateQueries({ queryKey: ['my-profile', userId] });
          queryClient.invalidateQueries({ queryKey: ['my-verifications', userId] });
        },
      )
      .subscribe();
    return () => {
      supabase.removeChannel(channel);
    };
  }, [userId, queryClient]);

  return null;
}
