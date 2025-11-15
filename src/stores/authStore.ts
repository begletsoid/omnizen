import { type Session, type User } from '@supabase/supabase-js';
import { create } from 'zustand';

type AuthState = {
  user: User | null;
  session: Session | null;
  setAuth: (payload: { user: User | null; session: Session | null }) => void;
  reset: () => void;
};

export const useAuthStore = create<AuthState>((set) => ({
  user: null,
  session: null,
  setAuth: ({ user, session }) => set({ user, session }),
  reset: () => set({ user: null, session: null }),
}));
