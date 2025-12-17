import 'dotenv/config';

if (process.env.SKIP_SMOKE === '1') {
  console.warn('Smoke test skipped (SKIP_SMOKE=1).');
  process.exit(0);
}

import { createClient } from '@supabase/supabase-js';

import { bootstrapDashboard } from '../src/features/dashboards/api';
import { saveHabitOrders } from '../src/features/habits/api';
import type { HabitRecord, HabitStatus } from '../src/features/habits/types';
import { buildHabitOrderUpdates } from '../src/features/habits/utils';
import type { LayoutItem } from '../src/features/layout/types';
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
let habitsWidgetId: string | null = null;
let microTasksWidgetId: string | null = null;
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
    const habitsWidget = bootstrap.widgets.find((widget) => widget.type === 'habits');
    if (!habitsWidget) {
      throw new Error('Habits widget missing from bootstrap');
    }

    habitsWidgetId = habitsWidget.id;
    const microWidget = bootstrap.widgets.find((widget) => widget.type === 'tasks');
    if (microWidget) {
      microTasksWidgetId = microWidget.id;
    }
    await runHabitReorderSmoke(habitsWidgetId, userId);
    if (microTasksWidgetId) {
      await runMicroTasksSmoke(microTasksWidgetId, userId);
    }
    await runLayoutReorderSmoke(bootstrap.dashboard.id);

    console.log('Smoke test passed:', {
      dashboardId: bootstrap.dashboard.id,
      widgets: bootstrap.widgets.length,
    });
  } finally {
    await anonClient.auth.signOut();
    if (supabase) {
      await supabase.auth.signOut();
    }
    if (habitsWidgetId) {
      await supabase?.from('habits').delete().eq('widget_id', habitsWidgetId);
    }
    if (microTasksWidgetId) {
      await supabase?.from('micro_tasks').delete().eq('widget_id', microTasksWidgetId);
    }
    await adminClient.auth.admin.deleteUser(userId);
    console.log('Cleaned up test user');
  }
}

async function runHabitReorderSmoke(widgetId: string, userId: string) {
  if (!supabase) throw new Error('Supabase client missing');

  await supabase.from('habits').delete().eq('widget_id', widgetId);
  const seed = [
    { title: 'Smoke NS 1', status: 'not_started' satisfies HabitStatus, order: 1 },
    { title: 'Smoke NS 2', status: 'not_started' satisfies HabitStatus, order: 2 },
    { title: 'Smoke IP 1', status: 'in_progress' satisfies HabitStatus, order: 1 },
    { title: 'Smoke AD 1', status: 'adopted' satisfies HabitStatus, order: 1 },
  ].map((habit) => ({
    ...habit,
    widget_id: widgetId,
    user_id: userId,
  }));
  const seedResult = await supabase.from('habits').insert(seed).select('*');
  if (seedResult.error) {
    throw seedResult.error;
  }

  const initial = await fetchHabits(widgetId);
  await assertSequential(initial);

  const groupedInitial = groupHabits(initial);
  const swapSource = groupedInitial.not_started[0];
  const swapUpdates = buildHabitOrderUpdates({
    activeHabit: swapSource,
    targetStatus: 'not_started',
    insertIndex: groupedInitial.not_started.length - 1,
    grouped: groupedInitial,
  });
  await saveHabitOrders({ widgetId, userId, updates: swapUpdates });

  const afterSwap = await fetchHabits(widgetId);
  await assertSequential(afterSwap);

  const groupedAfterSwap = groupHabits(afterSwap);
  const moveSource = groupedAfterSwap.not_started.at(-1);
  if (!moveSource) {
    throw new Error('Move source habit missing');
  }
  const moveUpdates = buildHabitOrderUpdates({
    activeHabit: moveSource,
    targetStatus: 'adopted',
    insertIndex: groupedAfterSwap.adopted.length,
    grouped: groupedAfterSwap,
  });
  await saveHabitOrders({ widgetId, userId, updates: moveUpdates });

  const afterMove = await fetchHabits(widgetId);
  await assertSequential(afterMove);
  const groupedAfterMove = groupHabits(afterMove);
  if (groupedAfterMove.adopted.length < 2) {
    throw new Error('Habit did not move to adopted status');
  }
}

async function runMicroTasksSmoke(widgetId: string, userId: string) {
  if (!supabase) throw new Error('Supabase client missing');

  await supabase.from('micro_tasks').delete().eq('widget_id', widgetId);
  const seed = [
    { title: 'Micro Smoke 1', order: 1 },
    { title: 'Micro Smoke 2', order: 2 },
  ].map((task) => ({
    ...task,
    widget_id: widgetId,
    user_id: userId,
    is_done: false,
  }));
  const insertResult = await supabase.from('micro_tasks').insert(seed).select('*');
  if (insertResult.error) throw insertResult.error;
  const tasks = insertResult.data!;

  // Start first task timer
  await supabase.rpc('start_micro_task_timer', { p_task_id: tasks[0].id });
  await new Promise((resolve) => setTimeout(resolve, 1100));

  // Starting second task should pause the first one
  await supabase.rpc('start_micro_task_timer', { p_task_id: tasks[1].id });
  await new Promise((resolve) => setTimeout(resolve, 500));
  await supabase.rpc('pause_micro_task_timer', { p_task_id: tasks[1].id });

  const { data: afterTimers, error: timerError } = await supabase
    .from('micro_tasks')
    .select('*')
    .eq('widget_id', widgetId)
    .order('order', { ascending: true });
  if (timerError || !afterTimers) throw timerError ?? new Error('Failed to load micro tasks');

  if (!afterTimers.some((task) => task.elapsed_seconds > 0)) {
    throw new Error('Micro task timer did not accumulate time');
  }
  if (afterTimers.some((task) => task.timer_state === 'running')) {
    throw new Error('Expected no running timers after pause');
  }

  const reorderPayload = afterTimers.map((task, index) => ({
    id: task.id,
    order: afterTimers.length - index,
  }));
  const reorderResponse = await supabase.rpc('reorder_micro_tasks', {
    p_widget_id: widgetId,
    p_user_id: userId,
    p_updates: reorderPayload,
  });
  if (reorderResponse.error) throw reorderResponse.error;

  const { data: afterReorder, error: reorderCheckError } = await supabase
    .from('micro_tasks')
    .select('order')
    .eq('widget_id', widgetId)
    .order('order', { ascending: true });
  if (reorderCheckError || !afterReorder) {
    throw reorderCheckError ?? new Error('Failed to verify micro task reorder');
  }
  const expected = Array.from({ length: afterReorder.length }, (_, idx) => idx + 1);
  const orders = afterReorder.map((task) => task.order);
  if (orders.some((order, idx) => order !== expected[idx])) {
    throw new Error('Micro task reorder did not normalize order values');
  }
}

async function fetchHabits(widgetId: string) {
  if (!supabase) throw new Error('Supabase client missing');
  const { data, error } = await supabase
    .from('habits')
    .select('*')
    .eq('widget_id', widgetId)
    .order('status')
    .order('order', { ascending: true });
  if (error || !data) {
    throw error ?? new Error('Failed to fetch habits');
  }
  return data as HabitRecord[];
}

async function assertSequential(habits: HabitRecord[]) {
  const grouped = groupHabits(habits);
  Object.entries(grouped).forEach(([status, list]) => {
    const orders = list.map((habit) => habit.order);
    const expected = Array.from({ length: list.length }, (_, idx) => idx + 1);
    if (orders.some((order, idx) => order !== expected[idx])) {
      throw new Error(`Broken order for ${status}: ${orders.join(',')} expected ${expected.join(',')}`);
    }
  });
}

function groupHabits(habits: HabitRecord[]) {
  const grouped: Record<HabitStatus, HabitRecord[]> = {
    adopted: [],
    in_progress: [],
    not_started: [],
  };
  habits.forEach((habit) => {
    grouped[habit.status].push(habit);
  });
  grouped.adopted.sort((a, b) => a.order - b.order);
  grouped.in_progress.sort((a, b) => a.order - b.order);
  grouped.not_started.sort((a, b) => a.order - b.order);
  return grouped;
}

async function runLayoutReorderSmoke(dashboardId: string) {
  if (!supabase) throw new Error('Supabase client missing');
  const { data, error } = await supabase
    .from('widget_layouts')
    .select('*')
    .eq('dashboard_id', dashboardId)
    .maybeSingle();
  if (error || !data) {
    throw error ?? new Error('Layout not found');
  }
  const layout = (data.layout as LayoutItem[]) ?? [];
  if (layout.length < 2) return;

  const swapped = layout.slice();
  [swapped[0], swapped[1]] = [swapped[1], swapped[0]];
  const upserted = await supabase
    .from('widget_layouts')
    .upsert({ dashboard_id: dashboardId, layout: swapped }, { onConflict: 'dashboard_id' })
    .select('*')
    .single();
  if (upserted.error) throw upserted.error;
  const verify = upserted.data?.layout as LayoutItem[];
  if (!verify || verify[0].widget_id !== swapped[0].widget_id) {
    throw new Error('Layout reorder did not persist');
  }

  const restored = await supabase
    .from('widget_layouts')
    .upsert({ dashboard_id: dashboardId, layout }, { onConflict: 'dashboard_id' })
    .select('*')
    .single();
  if (restored.error) throw restored.error;
}

run().catch((err) => {
  console.error('Smoke test failed');
  console.error(err);
  process.exit(1);
});
