import { supabase } from '../../lib/supabaseClient';
import type { LayoutItem } from './types';

if (!supabase) {
  console.warn('Supabase client unavailable - layout API disabled.');
}

export async function fetchLayout(dashboardId: string) {
  if (!supabase) throw new Error('Supabase client unavailable');
  return supabase.from('widget_layouts').select('*').eq('dashboard_id', dashboardId).maybeSingle();
}

export async function upsertLayout(dashboardId: string, layout: LayoutItem[]) {
  if (!supabase) throw new Error('Supabase client unavailable');
  return supabase
    .from('widget_layouts')
    .upsert({ dashboard_id: dashboardId, layout }, { onConflict: 'dashboard_id' })
    .select('*')
    .single();
}
