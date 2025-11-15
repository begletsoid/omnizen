import { supabase } from '../../lib/supabaseClient';
import type { HabitInsert, HabitOrderUpdatePayload, HabitStatus, HabitUpdate } from './types';

if (!supabase) {
  console.warn('Supabase client unavailable - habits API disabled.');
}

export async function getHabits(widgetId: string) {
  if (!supabase) throw new Error('Supabase client unavailable');
  return supabase
    .from('habits')
    .select('*')
    .eq('widget_id', widgetId)
    .order('order', { ascending: true });
}

export async function createHabit(payload: HabitInsert) {
  if (!supabase) throw new Error('Supabase client unavailable');
  return supabase.from('habits').insert(payload).select('*').single();
}

export async function updateHabit(id: string, payload: HabitUpdate) {
  if (!supabase) throw new Error('Supabase client unavailable');
  return supabase.from('habits').update(payload).eq('id', id).select('*').single();
}

export async function deleteHabit(id: string) {
  if (!supabase) throw new Error('Supabase client unavailable');
  return supabase.from('habits').delete().eq('id', id);
}

export async function moveHabit(id: string, status: HabitStatus, order: number) {
  return updateHabit(id, { status, order });
}

export async function fetchNextHabitOrder(widgetId: string, status: HabitStatus) {
  if (!supabase) throw new Error('Supabase client unavailable');
  const { data, error } = await supabase.rpc('next_habit_order', {
    p_widget_id: widgetId,
    p_status: status,
  });
  if (error) throw error;
  return data as number;
}

export async function saveHabitOrders(updates: HabitOrderUpdatePayload[]) {
  if (!supabase) throw new Error('Supabase client unavailable');
  if (!updates.length) return;
  const { error } = await supabase.from('habits').upsert(updates, { onConflict: 'id' });
  if (error) throw error;
}
