import 'dotenv/config';

import { createClient } from '@supabase/supabase-js';

import { bootstrapDashboard } from '../src/features/dashboards/api';
import { supabase } from '../src/lib/supabaseClient';

const url = process.env.VITE_SUPABASE_URL;
const serviceKey = process.env.SUPABASE_SERVICE_ROLE_KEY;
const anonKey = process.env.VITE_SUPABASE_ANON_KEY;

if (!url || !anonKey || !serviceKey) {
  console.warn(
    'Smoke test skipped: set VITE_SUPABASE_URL, VITE_SUPABASE_ANON_KEY and SUPABASE_SERVICE_ROLE_KEY to enable it.',
  );
  process.exit(0);
}

const adminClient = createClient(url, serviceKey, {
  auth: {
    persistSession: false,
    autoRefreshToken: false,
  },
});
const anonClient = createClient(url, anonKey, {
  auth: {
    persistSession: false,
    autoRefreshToken: false,
  },
});

async function run() {
const email = `smoke+${Date.now()}@omnizen.dev`;
  const password = 'SmokeTest123!';
  console.log('Creating test user', email);
  const { data, error } = await adminClient.auth.admin.createUser({
    email,
    password,
    email_confirm: true,
  });
  if (error || !data?.user) {
    throw error ?? new Error('User not created');
  }
  const userId = data.user.id;
  try {
    const signInResult = await anonClient.auth.signInWithPassword({ email, password });
    if (signInResult.error) throw signInResult.error;
    if (supabase && signInResult.data.session) {
      await supabase.auth.setSession({
        access_token: signInResult.data.session.access_token,
        refresh_token: signInResult.data.session.refresh_token,
      });
    }

    const bootstrap = await bootstrapDashboard(userId);
    if (!bootstrap.widgets.length) {
      throw new Error('Widgets were not generated');
    }
    if (!bootstrap.layout.layout.length) {
      throw new Error('Layout was not generated');
    }
    console.log('Smoke test passed:', {
      dashboardId: bootstrap.dashboard.id,
      widgets: bootstrap.widgets.length,
    });
  } finally {
    await anonClient.auth.signOut();
    if (supabase) {
      await supabase.auth.signOut();
    }
    await adminClient.auth.admin.deleteUser(userId);
    console.log('Cleaned up test user');
  }
}

run().catch((err) => {
  console.error('Smoke test failed');
  console.error(err);
  process.exit(1);
});
