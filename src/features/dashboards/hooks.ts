import { useQuery, useQueryClient } from '@tanstack/react-query';

import { supabase } from '../../lib/supabaseClient';

import { bootstrapDashboard } from './api';
import type { BootstrapResult } from './types';

export function useBootstrapDashboard(userId: string | null) {
  const queryClient = useQueryClient();

  return useQuery<BootstrapResult, Error>({
    queryKey: ['dashboard', userId],
    queryFn: async () => {
      if (!userId) throw new Error('Missing user id');
      const result = await bootstrapDashboard(userId);
      // кэшируем виджеты/лейаут в соответствующие ключи, чтобы меньше запросов
      queryClient.setQueryData(['widgets', result.dashboard.id], result.widgets);
      queryClient.setQueryData(['layout', result.dashboard.id], result.layout);
      return result;
    },
    enabled: Boolean(userId && supabase),
    staleTime: Infinity,
  });
}
