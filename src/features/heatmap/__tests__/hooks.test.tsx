import { QueryClient, QueryClientProvider, focusManager } from '@tanstack/react-query';
import { act, renderHook } from '@testing-library/react';
import type { ReactNode } from 'react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const api = vi.hoisted(() => ({ period: vi.fn(), details: vi.fn() }));
vi.mock('../../../lib/supabaseClient', () => ({ supabase: {} }));
vi.mock('../api', () => ({
  fetchHeatmapPeriodStats: api.period,
  fetchHeatmapDayDetails: api.details,
}));

import { useHeatmapDayDetails, useHeatmapPeriodStats, useHeatmapToday } from '../hooks';

describe('live heatmap updates', () => {
  beforeEach(() => {
    vi.useFakeTimers();
    focusManager.setFocused(true);
    vi.clearAllMocks();
  });

  afterEach(() => {
    focusManager.setFocused(undefined);
    vi.useRealTimers();
  });

  it('refreshes both the grid and an open day breakdown after 10 seconds', async () => {
    let seconds = 120;
    api.period.mockImplementation(async () => [{ day: '2026-10-21', points: 0, seconds }]);
    api.details.mockImplementation(async () => [{
      goal_id: 'goal-1', title: 'Working', value: 60, points_today: 0,
      seconds_today: seconds, seconds_total: seconds,
    }]);
    const client = new QueryClient({ defaultOptions: { queries: { retry: false, gcTime: 0 } } });
    const wrapper = ({ children }: { children: ReactNode }) => (
      <QueryClientProvider client={client}>{children}</QueryClientProvider>
    );
    const { result, unmount } = renderHook(() => ({
      period: useHeatmapPeriodStats('2026-10-01', '2026-10-21'),
      details: useHeatmapDayDetails('2026-10-21'),
    }), { wrapper });
    await act(async () => { await vi.advanceTimersByTimeAsync(1); });
    expect(result.current.period.data?.[0].seconds).toBe(120);
    expect(result.current.details.data?.[0].seconds_today).toBe(120);

    seconds = 130;
    await act(async () => { await vi.advanceTimersByTimeAsync(10_001); });
    expect(result.current.period.data?.[0].seconds).toBe(130);
    expect(result.current.details.data?.[0].seconds_today).toBe(130);
    expect(api.period).toHaveBeenCalledTimes(2);
    expect(api.details).toHaveBeenCalledTimes(2);
    unmount();
    await vi.advanceTimersByTimeAsync(10_001);
    expect(api.period).toHaveBeenCalledTimes(2);
    expect(api.details).toHaveBeenCalledTimes(2);
    client.clear();
  });

  it('advances the end of the heatmap period across midnight without a reload', async () => {
    vi.setSystemTime(new Date(2026, 9, 20, 23, 59, 55));
    const { result } = renderHook(() => useHeatmapToday());
    expect(result.current).toBe('2026-10-20');
    await act(async () => { await vi.advanceTimersByTimeAsync(10_000); });
    expect(result.current).toBe('2026-10-21');
  });

  it('recovers the current day on focus after the computer was asleep', () => {
    vi.setSystemTime(new Date(2026, 9, 20, 12));
    const { result } = renderHook(() => useHeatmapToday());
    vi.setSystemTime(new Date(2026, 9, 21, 12));
    act(() => { window.dispatchEvent(new Event('focus')); });
    expect(result.current).toBe('2026-10-21');
  });
});
