import { useCallback, useEffect, useRef } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';

import { supabase } from '../../lib/supabaseClient';
import { fetchLayout, upsertLayout } from './api';
import type { LayoutItem, LayoutRecord } from './types';

const DEBOUNCE_MS = 500;

export function useDashboardLayout(dashboardId: string | null) {
  const enabled = Boolean(dashboardId && supabase);
  const queryClient = useQueryClient();

  const query = useQuery<LayoutRecord | null, Error>({
    queryKey: ['layout', dashboardId],
    queryFn: async () => {
      if (!dashboardId) throw new Error('Missing dashboard id');
      const { data, error } = await fetchLayout(dashboardId);
      if (error) throw error;
      return data as LayoutRecord | null;
    },
    enabled,
  });

  const mutation = useMutation({
    mutationFn: async (layout: LayoutItem[]) => {
      if (!dashboardId) throw new Error('Missing dashboard id');
      const { data, error } = await upsertLayout(dashboardId, layout);
      if (error) throw error;
      return data as LayoutRecord;
    },
    onSuccess: (data) => {
      if (!dashboardId) return;
      queryClient.setQueryData(['layout', dashboardId], data);
    },
  });

  const timerRef = useRef<NodeJS.Timeout | null>(null);
  const pendingLayout = useRef<LayoutItem[] | null>(null);

  const scheduleSave = useCallback(
    (layout: LayoutItem[]) => {
      pendingLayout.current = layout;
      if (timerRef.current) {
        clearTimeout(timerRef.current);
      }
      timerRef.current = setTimeout(() => {
        if (!pendingLayout.current) return;
        mutation.mutate(pendingLayout.current);
        pendingLayout.current = null;
      }, DEBOUNCE_MS);
    },
    [mutation],
  );

  useEffect(() => () => timerRef.current && clearTimeout(timerRef.current), []);

  return {
    ...query,
    saveLayout: scheduleSave,
    isSaving: mutation.isLoading,
  } as const;
}
