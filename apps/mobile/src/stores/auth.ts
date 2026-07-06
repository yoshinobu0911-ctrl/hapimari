import type { Session } from '@supabase/supabase-js';
import { create } from 'zustand';
import { supabase } from '@/lib/supabase';

interface AuthState {
  session: Session | null;
  /** getSession の初回解決が終わったか（終わるまで画面遷移を保留する） */
  initialized: boolean;
}

export const useAuthStore = create<AuthState>(() => ({
  session: null,
  initialized: false,
}));

let listenerStarted = false;

/** ルートレイアウトから1回だけ呼ぶ */
export function startAuthListener(): void {
  if (listenerStarted) return;
  listenerStarted = true;

  supabase.auth.getSession().then(({ data }) => {
    useAuthStore.setState({ session: data.session, initialized: true });
  });

  supabase.auth.onAuthStateChange((_event, session) => {
    useAuthStore.setState({ session, initialized: true });
  });
}
