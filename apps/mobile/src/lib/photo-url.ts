/**
 * 写真の署名付きURL発行（M6.5: photos バケット非公開化に伴う表示経路）。
 *
 * photo_urls にはバケット内パス（{user_id}/photo_xxx.jpg）が入っており、
 * 表示時に1時間有効の署名付きURLへ変換する。署名は45分キャッシュして
 * 使い回す（期限1時間より短いので、表示中に切れることはほぼない）。
 * seed等の外部URL（http〜）はそのまま返す。
 */
import { useQuery } from '@tanstack/react-query';
import { supabase } from './supabase';

const SIGNED_URL_TTL_SECONDS = 60 * 60;
const CACHE_MS = 45 * 60 * 1000;

function isExternalUrl(value: string): boolean {
  return value.startsWith('http://') || value.startsWith('https://');
}

/** パス→署名付きURL。外部URLはそのまま。未指定・失敗時は null */
export function usePhotoUrl(pathOrUrl: string | null | undefined): string | null {
  const needsSigning = !!pathOrUrl && !isExternalUrl(pathOrUrl);
  const query = useQuery({
    queryKey: ['photo-url', pathOrUrl],
    enabled: needsSigning,
    staleTime: CACHE_MS,
    gcTime: CACHE_MS,
    queryFn: async () => {
      const { data, error } = await supabase.storage
        .from('photos')
        .createSignedUrl(pathOrUrl as string, SIGNED_URL_TTL_SECONDS);
      if (error || !data) return null;
      return data.signedUrl;
    },
  });
  if (!pathOrUrl) return null;
  if (!needsSigning) return pathOrUrl;
  return query.data ?? null;
}
