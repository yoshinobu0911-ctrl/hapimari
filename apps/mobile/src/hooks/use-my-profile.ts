import { useQuery } from '@tanstack/react-query';
import { supabase } from '@/lib/supabase';
import { useAuthStore } from '@/stores/auth';

/** 自分のプロフィール。未作成なら null（オンボーディングへ誘導する判定に使う） */
export function useMyProfile() {
  const session = useAuthStore((s) => s.session);
  return useQuery({
    queryKey: ['my-profile', session?.user.id],
    enabled: !!session,
    queryFn: async () => {
      if (!session) return null;
      const { data, error } = await supabase
        .from('profiles')
        .select('*')
        .eq('id', session.user.id)
        .maybeSingle();
      if (error) throw error;
      return data;
    },
  });
}
