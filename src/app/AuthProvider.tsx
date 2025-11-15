import { PropsWithChildren, useEffect } from 'react';

import { supabase } from '../lib/supabaseClient';
import { useAuthStore } from '../stores/authStore';

export function AuthProvider({ children }: PropsWithChildren) {
  const setAuth = useAuthStore((state) => state.setAuth);
  const reset = useAuthStore((state) => state.reset);

  useEffect(() => {
    if (!supabase) {
      reset();
      return;
    }

    let isMounted = true;

    supabase.auth.getSession().then(({ data }) => {
      if (!isMounted) return;
      const session = data.session ?? null;
      if (session) {
        setAuth({ user: session.user, session });
      } else {
        reset();
      }
    });

    const {
      data: { subscription },
    } = supabase.auth.onAuthStateChange((_event, session) => {
      if (session) {
        setAuth({ user: session.user, session });
      } else {
        reset();
      }
    });

    return () => {
      isMounted = false;
      subscription.unsubscribe();
    };
  }, [reset, setAuth]);

  return children;
}
