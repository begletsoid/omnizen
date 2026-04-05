import { supabase } from '../../lib/supabaseClient';
import type { GoalInsert, GoalUpdate, RecurringGoalInsert } from './types';

let supabaseClient = supabase;

if (!supabaseClient) {
  console.warn('Supabase client unavailable - tasks API disabled.');
}

export function __setSupabaseClient(client: typeof supabase) {
  supabaseClient = client;
}

function requireSupabase() {
  if (!supabaseClient) throw new Error('Supabase client unavailable');
  return supabaseClient;
}

export async function listGoals(widgetId: string) {
  const client = requireSupabase();
  return client
    .from('goals')
    .select('*, categories:goal_category_links(category:task_categories(*))')
    .eq('widget_id', widgetId)
    .is('archived_at', null)
    .order('created_at', { ascending: true });
}

export async function createGoal(data: GoalInsert) {
  const client = requireSupabase();
  return client.from('goals').insert(data).select('*').single();
}

export async function updateGoal(id: string, data: GoalUpdate) {
  const client = requireSupabase();
  return client.from('goals').update(data).eq('id', id).select('*').single();
}

export async function deleteGoal(id: string) {
  const client = requireSupabase();
  return client.from('goals').delete().eq('id', id);
}

export async function archiveGoal(id: string) {
  const client = requireSupabase();
  return client
    .from('goals')
    .update({ archived_at: new Date().toISOString() })
    .eq('id', id);
}

export async function fetchGoalElapsedSeconds(goalId: string): Promise<number> {
  const client = requireSupabase();
  const { data } = await client
    .from('micro_tasks')
    .select('elapsed_seconds')
    .eq('goal_id', goalId);
  if (!data) return 0;
  return data.reduce((sum, row) => sum + (row.elapsed_seconds ?? 0), 0);
}

export async function attachCategoryToGoal(goalId: string, categoryId: string) {
  const client = requireSupabase();
  return client.from('goal_category_links').insert({ goal_id: goalId, category_id: categoryId });
}

export async function detachCategoryFromGoal(goalId: string, categoryId: string) {
  const client = requireSupabase();
  return client
    .from('goal_category_links')
    .delete()
    .eq('goal_id', goalId)
    .eq('category_id', categoryId);
}

export async function listRecurringGoals(widgetId: string) {
  const client = requireSupabase();
  return client
    .from('recurring_goals')
    .select('*')
    .eq('widget_id', widgetId)
    .order('created_at', { ascending: true });
}

export async function createRecurringGoal(data: RecurringGoalInsert) {
  const client = requireSupabase();
  return client.from('recurring_goals').insert(data).select('*').single();
}

export async function updateRecurringGoal(id: string, data: Partial<RecurringGoalInsert & { last_triggered_at: string }>) {
  const client = requireSupabase();
  return client.from('recurring_goals').update(data).eq('id', id).select('*').single();
}

export async function deleteRecurringGoal(id: string) {
  const client = requireSupabase();
  return client.from('recurring_goals').delete().eq('id', id);
}
