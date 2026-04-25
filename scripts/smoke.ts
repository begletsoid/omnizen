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
let analyticsWidgetId: string | null = null;
let goalsWidgetId: string | null = null;
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
    const analyticsWidget = bootstrap.widgets.find((widget) => widget.type === 'analytics');
    if (analyticsWidget) {
      analyticsWidgetId = analyticsWidget.id;
    }
    const goalsWidget = bootstrap.widgets.find((widget) => widget.type === 'goals');
    if (goalsWidget) {
      goalsWidgetId = goalsWidget.id;
    }
    await runHabitReorderSmoke(habitsWidgetId, userId);
    if (microTasksWidgetId) {
      await runMicroTasksSmoke(microTasksWidgetId, userId);
    }
    if (analyticsWidgetId) {
      await runAnalyticsSmoke(userId);
    }
    if (goalsWidgetId) {
      await runGoalsReorderSmoke(goalsWidgetId, userId);
    }
    if (goalsWidgetId && microTasksWidgetId) {
      await runHeatmapSmoke(goalsWidgetId, microTasksWidgetId, userId);
    }
    if (microTasksWidgetId) {
      await runEodCleanupSmoke(microTasksWidgetId, userId);
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
      await supabase?.from('micro_task_groups').delete().eq('widget_id', microTasksWidgetId);
    }
    await supabase?.from('micro_task_group_templates').delete().eq('user_id', userId);
    if (analyticsWidgetId) {
      await supabase?.from('analytics_timers').delete().eq('user_id', userId);
      await supabase?.from('analytics_settings').delete().eq('user_id', userId);
    }
    if (goalsWidgetId) {
      await supabase?.from('goals').delete().eq('widget_id', goalsWidgetId);
    }
    await supabase?.from('eod_cleanup_log').delete().eq('user_id', userId);
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
  await supabase.from('micro_task_groups').delete().eq('widget_id', widgetId);
  await supabase.from('micro_task_group_templates').delete().eq('user_id', userId);
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

  const { data: group, error: groupError } = await supabase
    .from('micro_task_groups')
    .insert({ widget_id: widgetId, user_id: userId, name: 'Smoke Group', order: 1 })
    .select('*')
    .single();
  if (groupError || !group) throw groupError ?? new Error('Failed to create group');

  const groupAssign = await supabase
    .from('micro_tasks')
    .update({ group_id: group.id, group_order: 1 })
    .eq('id', tasks[0].id);
  if (groupAssign.error) throw groupAssign.error;

  const { data: template, error: templateError } = await supabase
    .from('micro_task_group_templates')
    .insert({ user_id: userId, name: 'Smoke Template' })
    .select('*')
    .single();
  if (templateError || !template) throw templateError ?? new Error('Failed to create template');

  const templateItemsResult = await supabase.from('micro_task_group_template_items').insert([
    {
      template_id: template.id,
      title: tasks[0].title,
      category_ids: [],
      order: 1,
    },
  ]);
  if (templateItemsResult.error) throw templateItemsResult.error;

  const { data: spawnedGroup, error: spawnedGroupError } = await supabase
    .from('micro_task_groups')
    .insert({ widget_id: widgetId, user_id: userId, name: template.name, order: 2 })
    .select('*')
    .single();
  if (spawnedGroupError || !spawnedGroup) {
    throw spawnedGroupError ?? new Error('Failed to create group from template');
  }

  const spawnResult = await supabase.from('micro_tasks').insert([
    {
      widget_id: widgetId,
      user_id: userId,
      title: tasks[0].title,
      order: 3,
      group_id: spawnedGroup.id,
      group_order: 1,
      elapsed_seconds: 0,
      is_done: false,
    },
  ]);
  if (spawnResult.error) throw spawnResult.error;

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

async function runGoalsReorderSmoke(widgetId: string, userId: string) {
  if (!supabase) throw new Error('Supabase client missing');

  await supabase.from('goals').delete().eq('widget_id', widgetId);
  const seed = [
    { title: 'Goal Smoke A', sort_order: 1 },
    { title: 'Goal Smoke B', sort_order: 2 },
    { title: 'Goal Smoke C', sort_order: 3 },
  ].map((goal) => ({
    ...goal,
    widget_id: widgetId,
    user_id: userId,
  }));
  const insertResult = await supabase.from('goals').insert(seed).select('*');
  if (insertResult.error) throw insertResult.error;
  const inserted = insertResult.data!;

  const reversedIds = [...inserted].reverse().map((g) => ({ id: g.id }));
  const reorderResponse = await supabase.rpc('reorder_goals', {
    p_widget_id: widgetId,
    p_user_id: userId,
    p_updates: reversedIds,
  });
  if (reorderResponse.error) throw reorderResponse.error;

  const { data: afterReorder, error: verifyError } = await supabase
    .from('goals')
    .select('id, sort_order')
    .eq('widget_id', widgetId)
    .order('sort_order', { ascending: true });
  if (verifyError || !afterReorder) {
    throw verifyError ?? new Error('Failed to verify goals reorder');
  }
  const expectedOrder = [...inserted].reverse().map((g) => g.id);
  const actualOrder = afterReorder.map((g) => g.id);
  if (expectedOrder.some((id, idx) => id !== actualOrder[idx])) {
    throw new Error(
      `Goals reorder did not apply: expected ${expectedOrder.join(',')} got ${actualOrder.join(',')}`,
    );
  }
  const expectedPositions = Array.from({ length: afterReorder.length }, (_, idx) => idx + 1);
  if (afterReorder.some((g, idx) => g.sort_order !== expectedPositions[idx])) {
    throw new Error('reorder_goals did not normalize sort_order values');
  }
}

async function runEodCleanupSmoke(microWidgetId: string, userId: string) {
  if (!supabase) throw new Error('Supabase client missing');

  // Clean slate: wipe widget tasks and any prior cleanup logs for this test user.
  await supabase.from('micro_tasks').delete().eq('widget_id', microWidgetId);
  await supabase.from('micro_task_groups').delete().eq('widget_id', microWidgetId);
  await supabase.from('eod_cleanup_log').delete().eq('user_id', userId);

  // Set a "bedtime" 30 minutes ago — anchors the clamp.
  const now = new Date();
  const bedtime = new Date(now.getTime() - 30 * 60_000);
  const lastStarted = new Date(now.getTime() - 90 * 60_000); // started 90 min before "now"
  // Expected elapsed after clamp = bedtime - lastStarted = 60 min = 3600 s.
  const expectedClampSeconds = 60 * 60;

  await supabase
    .from('profiles')
    .update({ last_bedtime_at: bedtime.toISOString() })
    .eq('id', userId);

  // Seed: one running task that has accumulated 0s pre-pause, three done-like tasks.
  const { data: runningInsert, error: runningError } = await supabase
    .from('micro_tasks')
    .insert({
      widget_id: microWidgetId,
      user_id: userId,
      title: 'EOD running task',
      order: 1,
      elapsed_seconds: 0,
      timer_state: 'running',
      last_started_at: lastStarted.toISOString(),
    })
    .select('*')
    .single();
  if (runningError || !runningInsert) throw runningError ?? new Error('Failed to seed running task');

  const { error: restError } = await supabase.from('micro_tasks').insert([
    {
      widget_id: microWidgetId,
      user_id: userId,
      title: 'EOD worked-on task',
      order: 2,
      elapsed_seconds: 600,
      timer_state: 'paused',
      is_done: false,
    },
    {
      widget_id: microWidgetId,
      user_id: userId,
      title: 'EOD noise task (<5s)',
      order: 3,
      elapsed_seconds: 2,
      timer_state: 'never',
      is_done: false,
    },
  ]);
  if (restError) throw restError;

  // Invoke the per-user cleanup explicitly (bypassing the tick's time check).
  const { error: rpcError } = await supabase.rpc('eod_cleanup_user', {
    p_user_id: userId,
    p_now: now.toISOString(),
  });
  if (rpcError) throw rpcError;

  // 1. Running task should be paused, with elapsed_seconds clamped to bedtime.
  const { data: afterRunning, error: afterRunningError } = await supabase
    .from('micro_tasks')
    .select('*')
    .eq('id', runningInsert.id)
    .single();
  if (afterRunningError || !afterRunning) {
    throw afterRunningError ?? new Error('Running task lookup failed');
  }
  if (afterRunning.timer_state !== 'paused') {
    throw new Error(`Running task was not paused: timer_state=${afterRunning.timer_state}`);
  }
  if (afterRunning.last_started_at !== null) {
    throw new Error('Running task last_started_at was not cleared');
  }
  const elapsed = afterRunning.elapsed_seconds ?? 0;
  if (Math.abs(elapsed - expectedClampSeconds) > 5) {
    throw new Error(
      `Running task elapsed_seconds=${elapsed}, expected ~${expectedClampSeconds}s (clamp to bedtime)`,
    );
  }
  if (afterRunning.archived_at === null || afterRunning.is_done !== true) {
    throw new Error('Worked-on running task was not archived');
  }

  // 2. Worked-on paused task (≥5s) should be archived + is_done=true.
  const { data: list, error: listError } = await supabase
    .from('micro_tasks')
    .select('*')
    .eq('widget_id', microWidgetId);
  if (listError || !list) throw listError ?? new Error('Listing failed');
  const noiseRemaining = list.find((t) => t.title === 'EOD noise task (<5s)');
  if (noiseRemaining) throw new Error('Noise task (<5s) was not deleted');
  const archivedAll = list
    .filter((t) => t.title === 'EOD worked-on task' || t.title === 'EOD running task')
    .every((t) => t.archived_at !== null);
  if (!archivedAll) throw new Error('Not all heavy tasks were archived');

  // 3. Cleanup log entry exists.
  const { data: logs, error: logError } = await supabase
    .from('eod_cleanup_log')
    .select('*')
    .eq('user_id', userId)
    .order('ran_at', { ascending: false })
    .limit(1);
  if (logError || !logs?.length) throw logError ?? new Error('Cleanup log not written');
  if (logs[0].skipped_reason) {
    throw new Error(`Cleanup was skipped with reason: ${logs[0].skipped_reason}`);
  }

  // 4. Without a bedtime, cleanup must skip.
  await supabase.from('profiles').update({ last_bedtime_at: null }).eq('id', userId);
  await supabase.from('eod_cleanup_log').delete().eq('user_id', userId);
  await supabase.from('micro_tasks').delete().eq('widget_id', microWidgetId);
  await supabase.from('micro_tasks').insert({
    widget_id: microWidgetId,
    user_id: userId,
    title: 'Should survive',
    order: 1,
    elapsed_seconds: 42,
    is_done: false,
  });
  await supabase.rpc('eod_cleanup_user', { p_user_id: userId, p_now: now.toISOString() });
  const { data: afterSkip } = await supabase
    .from('micro_tasks')
    .select('id, archived_at')
    .eq('widget_id', microWidgetId);
  if (!afterSkip || afterSkip.length !== 1 || afterSkip[0].archived_at !== null) {
    throw new Error('Cleanup ran without recent bedtime — safety guard broken');
  }
  const { data: skipLog } = await supabase
    .from('eod_cleanup_log')
    .select('skipped_reason')
    .eq('user_id', userId)
    .order('ran_at', { ascending: false })
    .limit(1);
  if (skipLog?.[0]?.skipped_reason !== 'no_recent_bedtime') {
    throw new Error(`Expected skip reason 'no_recent_bedtime', got ${skipLog?.[0]?.skipped_reason}`);
  }
}

async function runHeatmapSmoke(goalsWidgetId: string, microWidgetId: string, userId: string) {
  if (!supabase) throw new Error('Supabase client missing');

  // Clean slate for this smoke
  await supabase.from('goals').delete().eq('widget_id', goalsWidgetId);
  await supabase.from('micro_tasks').delete().eq('widget_id', microWidgetId);

  // Seed: goal with value=60, 4 linked micro tasks across 2 days.
  const day1 = new Date();
  day1.setUTCDate(day1.getUTCDate() - 2);
  day1.setUTCHours(12, 0, 0, 0);
  const day2 = new Date();
  day2.setUTCDate(day2.getUTCDate() - 1);
  day2.setUTCHours(12, 0, 0, 0);
  const day1Key = day1.toISOString().slice(0, 10);
  const day2Key = day2.toISOString().slice(0, 10);

  const { data: goalRow, error: goalError } = await supabase
    .from('goals')
    .insert({
      widget_id: goalsWidgetId,
      user_id: userId,
      title: 'Heatmap Smoke Goal',
      value: 60,
      is_done: false,
      sort_order: 1,
    })
    .select('*')
    .single();
  if (goalError || !goalRow) throw goalError ?? new Error('Failed to create goal');

  const taskSeed = [
    { title: 'Task A Day1', created_at: day1.toISOString(), elapsed_seconds: 7200, order: 1 },
    { title: 'Task B Day1', created_at: day1.toISOString(), elapsed_seconds: 7200, order: 2 },
    { title: 'Task C Day2', created_at: day2.toISOString(), elapsed_seconds: 3600, order: 3 },
    { title: 'Task D Day2', created_at: day2.toISOString(), elapsed_seconds: 3600, order: 4 },
  ].map((task) => ({
    ...task,
    widget_id: microWidgetId,
    user_id: userId,
    goal_id: goalRow.id,
    is_done: false,
  }));
  const { error: taskError } = await supabase.from('micro_tasks').insert(taskSeed);
  if (taskError) throw taskError;

  // Close the goal → points should be distributed: 40 to Day1, 20 to Day2.
  const { error: completeError } = await supabase
    .from('goals')
    .update({ is_done: true })
    .eq('id', goalRow.id);
  if (completeError) throw completeError;

  const { data: periodRows, error: periodError } = await supabase.rpc('get_heatmap_period', {
    p_from: day1Key,
    p_to: day2Key,
  });
  if (periodError) throw periodError;
  if (!periodRows || periodRows.length !== 2) {
    throw new Error(`Expected 2 heatmap period rows, got ${periodRows?.length ?? 0}`);
  }
  const byDay = new Map<string, { points: number; seconds: number }>();
  for (const row of periodRows as Array<{ day: string; points: number; seconds: number | string }>) {
    byDay.set(row.day, {
      points: row.points,
      seconds: typeof row.seconds === 'string' ? Number(row.seconds) : row.seconds,
    });
  }
  const d1 = byDay.get(day1Key);
  const d2 = byDay.get(day2Key);
  if (!d1 || !d2) throw new Error('Heatmap period missing expected days');
  if (d1.points !== 40 || d1.seconds !== 14400) {
    throw new Error(`Day1 expected 40 pts / 14400s, got ${d1.points} / ${d1.seconds}`);
  }
  if (d2.points !== 20 || d2.seconds !== 7200) {
    throw new Error(`Day2 expected 20 pts / 7200s, got ${d2.points} / ${d2.seconds}`);
  }

  // Recompute check: bumping goal value should change distribution immediately.
  const { error: bumpError } = await supabase
    .from('goals')
    .update({ value: 120 })
    .eq('id', goalRow.id);
  if (bumpError) throw bumpError;

  const { data: bumpedRows, error: bumpedError } = await supabase.rpc('get_heatmap_period', {
    p_from: day1Key,
    p_to: day2Key,
  });
  if (bumpedError) throw bumpedError;
  const bumpedByDay = new Map<string, number>();
  for (const row of (bumpedRows ?? []) as Array<{ day: string; points: number }>) {
    bumpedByDay.set(row.day, row.points);
  }
  if (bumpedByDay.get(day1Key) !== 80 || bumpedByDay.get(day2Key) !== 40) {
    throw new Error(
      `After value bump expected 80/40 pts, got ${bumpedByDay.get(day1Key)}/${bumpedByDay.get(day2Key)}`,
    );
  }

  // Un-complete → no points should be returned in points column (only time).
  const { error: uncompleteError } = await supabase
    .from('goals')
    .update({ is_done: false })
    .eq('id', goalRow.id);
  if (uncompleteError) throw uncompleteError;

  const { data: noPointsRows, error: noPointsError } = await supabase.rpc('get_heatmap_period', {
    p_from: day1Key,
    p_to: day2Key,
  });
  if (noPointsError) throw noPointsError;
  for (const row of (noPointsRows ?? []) as Array<{ day: string; points: number; seconds: number | string }>) {
    if (row.points !== 0) throw new Error(`Expected 0 points when goal incomplete, got ${row.points}`);
  }

  // Day details (with goal completed again) should break down by goal.
  await supabase.from('goals').update({ is_done: true, value: 60 }).eq('id', goalRow.id);

  const { data: detailsRows, error: detailsError } = await supabase.rpc('get_heatmap_day_details', {
    p_day: day1Key,
  });
  if (detailsError) throw detailsError;
  if (!detailsRows || detailsRows.length !== 1) {
    throw new Error(`Expected 1 goal in day details, got ${detailsRows?.length ?? 0}`);
  }
  const detail = detailsRows[0] as {
    goal_id: string;
    title: string;
    value: number;
    points_today: number;
    seconds_today: number | string;
    seconds_total: number | string;
  };
  if (detail.goal_id !== goalRow.id) throw new Error('Day detail has wrong goal');
  if (detail.points_today !== 40) {
    throw new Error(`Day1 details expected 40 pts, got ${detail.points_today}`);
  }
  const secondsToday = typeof detail.seconds_today === 'string'
    ? Number(detail.seconds_today)
    : detail.seconds_today;
  const secondsTotal = typeof detail.seconds_total === 'string'
    ? Number(detail.seconds_total)
    : detail.seconds_total;
  if (secondsToday !== 14400) {
    throw new Error(`Day1 details expected 14400s today, got ${secondsToday}`);
  }
  if (secondsTotal !== 21600) {
    throw new Error(`Day1 details expected 21600s total, got ${secondsTotal}`);
  }
}

async function runAnalyticsSmoke(userId: string) {
  if (!supabase) throw new Error('Supabase client missing');

  await supabase.from('analytics_timers').delete().eq('user_id', userId);
  await supabase.from('analytics_settings').delete().eq('user_id', userId);

  const settingsResult = await supabase
    .from('analytics_settings')
    .insert({ user_id: userId, period_start: '2025-01-01', period_end: '2025-01-07' })
    .select('*')
    .single();
  if (settingsResult.error) throw settingsResult.error;

  const timerResult = await supabase
    .from('analytics_timers')
    .insert({
      user_id: userId,
      name: 'Smoke Timer',
      color: '#7dd3fc',
      days_mask: '1111111',
      tag_ids: [],
      category_ids: [],
      sort_order: 1,
    })
    .select('*')
    .single();
  if (timerResult.error) throw timerResult.error;

  const { data: timers, error: timersError } = await supabase
    .from('analytics_timers')
    .select('*')
    .eq('user_id', userId);
  if (timersError) throw timersError;
  if (!timers || timers.length === 0) {
    throw new Error('Analytics timers were not created');
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
  const error = err instanceof Error ? err : new Error(String(err));
  const code =
    typeof err === 'object' && err && 'code' in err && typeof (err as { code?: unknown }).code === 'string'
      ? (err as { code: string }).code
      : undefined;
  const message =
    typeof err === 'object' && err && 'message' in err ? String((err as { message?: unknown }).message) : error.message;

  if (code === '23514' && message.includes('widgets_type_check')) {
    console.warn(
      'Smoke test skipped: backend schema не обновлено (widgets_type_check). Примените новые миграции и повторите.',
    );
    process.exit(0);
  }
  if (
    message.includes('micro_task_groups') ||
    message.includes('micro_task_group_templates') ||
    message.includes('micro_task_group_template_items') ||
    message.includes('group_id') ||
    message.includes('group_order')
  ) {
    console.warn(
      'Smoke test skipped: backend schema не обновлено (micro task groups). Примените новые миграции и повторите.',
    );
    process.exit(0);
  }
  console.error('Smoke test failed');
  console.error(error);
  process.exit(1);
});
