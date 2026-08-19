import { useQuery } from '@tanstack/react-query';
import { fetchMySubscription } from '@/lib/subscription-api';
import { useAuthStore } from '@/stores/auth';

/**
 * 自分の契約状態（M7.2）。未契約なら null。
 * 画面状態への変換は @hapimari/shared の deriveSubscriptionView で行う。
 */
export function useMySubscription() {
  const session = useAuthStore((s) => s.session);
  return useQuery({
    queryKey: ['my-subscription', session?.user.id],
    enabled: !!session,
    queryFn: () => fetchMySubscription(session?.user.id ?? ''),
  });
}
