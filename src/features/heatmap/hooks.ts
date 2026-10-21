import { useEffect, useState } from 'react';
import { useQuery } from '@tanstack/react-query';

import { supabase } from '../../lib/supabaseClient';
import { fetchHeatmapDayDetails, fetchHeatmapPeriodStats } from './api';
import type { HeatmapDayDetail, HeatmapDayStats } from './types';
import { toDayKey } from './utils';

const HEATMAP_REFETCH_INTERVAL_MS = 10_000;

export function useHeatmapToday() {
  const [today, setToday] = useState(() => toDayKey(new Date()));
  useEffect(() => {
    const refresh = () => setToday(toDayKey(new Date()));
    // Polling also covers sleep/wake without a focus or visibility event.
    const interval = window.setInterval(refresh, HEATMAP_REFETCH_INTERVAL_MS);
    window.addEventListener('focus', refresh);
    document.addEventListener('visibilitychange', refresh);
    return () => {
      window.clearInterval(interval);
      window.removeEventListener('focus', refresh);
      document.removeEventListener('visibilitychange', refresh);
    };
  }, []);
  return today;
}

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
    refetchInterval: HEATMAP_REFETCH_INTERVAL_MS,
    refetchIntervalInBackground: false,
  });
}
