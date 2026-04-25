import { useQuery } from '@tanstack/react-query';

import { supabase } from '../../lib/supabaseClient';
import { fetchHeatmapDayDetails, fetchHeatmapPeriodStats } from './api';
import type { HeatmapDayDetail, HeatmapDayStats } from './types';

const HEATMAP_REFETCH_INTERVAL_MS = 10_000;

export function useHeatmapPeriodStats(from: string | null, to: string | null) {
  return useQuery<HeatmapDayStats[], Error>({
    queryKey: ['heatmap', 'period', from, to],
    queryFn: async () => {
      if (!from || !to) return [];
      return fetchHeatmapPeriodStats(from, to);
    },
    enabled: Boolean(from && to && supabase),
    refetchInterval: HEATMAP_REFETCH_INTERVAL_MS,
    refetchIntervalInBackground: false,
  });
}

export function useHeatmapDayDetails(day: string | null) {
  return useQuery<HeatmapDayDetail[], Error>({
    queryKey: ['heatmap', 'day', day],
    queryFn: async () => {
      if (!day) return [];
      return fetchHeatmapDayDetails(day);
    },
    enabled: Boolean(day && supabase),
    // Tooltip details don't need background polling; user opens & closes explicitly.
  });
}
