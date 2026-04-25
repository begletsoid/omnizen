import { supabase } from '../../lib/supabaseClient';
import type { HeatmapDayDetail, HeatmapDayStats } from './types';

function requireSupabase() {
  if (!supabase) throw new Error('Supabase client unavailable');
  return supabase;
}

/**
 * Aggregate per-day stats for [from, to] inclusive.
 * Computed server-side on the fly — no denormalized table to keep in sync.
 * "Points" are the per-day share of `goals.value` for completed goals, distributed
 * proportionally to time on each day; "seconds" covers ALL goal-linked micro tasks.
 */
export async function fetchHeatmapPeriodStats(from: string, to: string): Promise<HeatmapDayStats[]> {
  const client = requireSupabase();
  const { data, error } = await client.rpc('get_heatmap_period', {
    p_from: from,
    p_to: to,
  });
  if (error) throw error;
  type Row = { day: string; points: number; seconds: number | string };
  return ((data as Row[]) ?? []).map((row) => ({
    day: row.day,
    points: row.points ?? 0,
    // bigint values come back from postgrest as strings.
    seconds: typeof row.seconds === 'string' ? Number(row.seconds) : row.seconds ?? 0,
  }));
}

export async function fetchHeatmapDayDetails(day: string): Promise<HeatmapDayDetail[]> {
  const client = requireSupabase();
  const { data, error } = await client.rpc('get_heatmap_day_details', { p_day: day });
  if (error) throw error;
  type Row = {
    goal_id: string;
    title: string;
    value: number;
    points_today: number;
    seconds_today: number | string;
    seconds_total: number | string;
  };
  return ((data as Row[]) ?? []).map((row) => ({
    goal_id: row.goal_id,
    title: row.title,
    value: row.value,
    points_today: row.points_today ?? 0,
    seconds_today: typeof row.seconds_today === 'string' ? Number(row.seconds_today) : row.seconds_today ?? 0,
    seconds_total: typeof row.seconds_total === 'string' ? Number(row.seconds_total) : row.seconds_total ?? 0,
  }));
}
