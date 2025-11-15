import { supabase } from '../../lib/supabaseClient';
import type { HabitInsert, HabitRecord, HabitStatus, HabitUpdate } from './types';

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

export async function reorderHabits(
  updates: Array<Pick<HabitRecord, 'id'> & { order: number }>,
) {
  if (!supabase) throw new Error('Supabase client unavailable');
  if (!updates.length) return { data: [], error: null } as const;

  return supabase.from('habits').upsert(updates.map(({ id, order }) => ({ id, order }))).select('id,order');
}
