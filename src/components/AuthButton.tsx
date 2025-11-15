import { useState } from 'react';

import { supabase } from '../lib/supabaseClient';
import { useAuthStore } from '../stores/authStore';

const redirectTo = typeof window !== 'undefined' ? window.location.origin : undefined;

export function AuthButton() {
  const user = useAuthStore((state) => state.user);
  const [loading, setLoading] = useState<'signin' | 'signout' | null>(null);

  const handleSignIn = async () => {
    if (!supabase) return;
    setLoading('signin');
    try {
      const { error } = await supabase.auth.signInWithOAuth({
        provider: 'google',
        options: {
          redirectTo,
        },
      });
      if (error) {
        console.error(error.message);
      }
    } finally {
      setLoading(null);
    }
  };

  const handleSignOut = async () => {
    if (!supabase) return;
    setLoading('signout');
    try {
      const { error } = await supabase.auth.signOut();
      if (error) {
        console.error(error.message);
      }
    } finally {
      setLoading(null);
    }
  };

  const label = user ? 'Выйти' : 'Войти через Google';
  const isLoading = Boolean(loading);

  return (
    <button
      type="button"
      onClick={user ? handleSignOut : handleSignIn}
      disabled={isLoading || !supabase}
      className="rounded-full border border-border/80 px-4 py-2 text-sm font-semibold transition hover:border-accent hover:text-accent disabled:opacity-50"
    >
      {isLoading ? 'Загрузка…' : label}
    </button>
  );
}
