import { useQuery } from '@tanstack/react-query';
import { supabase } from '@/lib/supabase';
import { useAuthStore } from '@/stores/auth';

/** 自分の本人確認申請の履歴（審査待ち画面用・kindごとに最新を使う） */
export function useMyVerifications() {
  const session = useAuthStore((s) => s.session);
  return useQuery({
    queryKey: ['my-verifications', session?.user.id],
    enabled: !!session,
    queryFn: async () => {
      if (!session) return [];
      const { data, error } = await supabase
        .from('verifications')
        .select('id, kind, status, reject_reason, created_at')
        .eq('user_id', session.user.id)
        .order('created_at', { ascending: false });
      if (error) throw error;
      return data;
    },
  });
}
