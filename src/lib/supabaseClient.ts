import { createClient } from '@supabase/supabase-js';

const metaEnv = typeof import.meta !== 'undefined' ? import.meta.env : undefined;
const url = metaEnv?.VITE_SUPABASE_URL ?? process.env.VITE_SUPABASE_URL;
const anonKey = metaEnv?.VITE_SUPABASE_ANON_KEY ?? process.env.VITE_SUPABASE_ANON_KEY;

if (!url || !anonKey) {
  console.warn('Supabase ENV variables are missing. Check .env or Netlify settings.');
}

export const supabase = url && anonKey ? createClient(url, anonKey) : undefined;
