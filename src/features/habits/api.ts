import { supabase } from '../../lib/supabaseClient';
import type { HabitInsert, HabitOrderUpdatePayload, HabitStatus, HabitUpdate } from './types';

let supabaseClient = supabase;

if (!supabaseClient) {
  console.warn('Supabase client unavailable - habits API disabled.');
}

export function __setSupabaseClient(client: typeof supabase) {
  supabaseClient = client;
}

function requireSupabase() {
  if (!supabaseClient) throw new Error('Supabase client unavailable');
  return supabaseClient;
}

export async function getHabits(widgetId: string) {
  const client = requireSupabase();
  return client
    .from('habits')
    .select('*')
    .eq('widget_id', widgetId)
    .order('order', { ascending: true });
}

export async function createHabit(payload: HabitInsert) {
  const client = requireSupabase();
  return client.from('habits').insert(payload).select('*').single();
}

export async function updateHabit(id: string, payload: HabitUpdate) {
  const client = requireSupabase();
  return client.from('habits').update(payload).eq('id', id).select('*').single();
}

export async function deleteHabit(id: string) {
  const client = requireSupabase();
  return client.from('habits').delete().eq('id', id);
}

export async function moveHabit(id: string, status: HabitStatus, order: number) {
  return updateHabit(id, { status, order });
}

export async function fetchNextHabitOrder(widgetId: string, status: HabitStatus) {
  const client = requireSupabase();
  const { data, error } = await client.rpc('next_habit_order', {
    p_widget_id: widgetId,
    p_status: status,
  });
  if (error) {
    if (error.code === 'PGRST202') {
      return fetchNextHabitOrderFromQuery(widgetId, status);
    }
    throw error;
  }
  if (typeof data === 'number') return data;
  return fetchNextHabitOrderFromQuery(widgetId, status);
}

export async function saveHabitOrders(params: {
  widgetId: string;
  userId: string;
  updates: HabitOrderUpdatePayload[];
}) {
  const client = requireSupabase();
  const { widgetId, userId, updates } = params;
  if (!updates.length) return;
  const { error } = await client.rpc('reorder_habits', {
    p_widget_id: widgetId,
    p_user_id: userId,
    p_updates: updates,
  });
  if (error) throw error;
}

export async function fetchNextHabitOrderFromQuery(widgetId: string, status: HabitStatus) {
  const client = requireSupabase();
  const { data, error } = await client
    .from('habits')
    .select('order')
    .eq('widget_id', widgetId)
    .eq('status', status)
    .order('order', { ascending: false })
    .limit(1)
    .maybeSingle();
  if (error) throw error;
  const maxOrder = typeof data?.order === 'number' ? data.order : 0;
  return maxOrder + 1;
}
