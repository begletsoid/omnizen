import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { supabase as realSupabase } from '../../../lib/supabaseClient';
import { __setSupabaseClient, fetchNextHabitOrder } from '../api';

const chain = {
  select: vi.fn(),
  eq: vi.fn(),
  order: vi.fn(),
  limit: vi.fn(),
  maybeSingle: vi.fn(),
};

const mockSupabase = {
  rpc: vi.fn(),
  from: vi.fn(() => chain),
};

function resetChain() {
  chain.select.mockReset().mockReturnValue(chain);
  chain.eq.mockReset().mockReturnValue(chain);
  chain.order.mockReset().mockReturnValue(chain);
  chain.limit.mockReset().mockReturnValue(chain);
  chain.maybeSingle.mockReset();
}

beforeEach(() => {
  mockSupabase.rpc.mockReset();
  mockSupabase.from.mockReset().mockReturnValue(chain);
  resetChain();
  __setSupabaseClient(mockSupabase as unknown as typeof realSupabase);
});

afterEach(() => {
  __setSupabaseClient(realSupabase);
});

describe('fetchNextHabitOrder', () => {
  it('возвращает результат RPC, если функция доступна', async () => {
    mockSupabase.rpc.mockResolvedValue({ data: 7, error: null });

    const nextOrder = await fetchNextHabitOrder('widget', 'adopted');

    expect(nextOrder).toBe(7);
    expect(chain.maybeSingle).not.toHaveBeenCalled();
  });

  it('использует fallback SELECT, если RPC недоступна', async () => {
    mockSupabase.rpc.mockResolvedValue({ data: null, error: { code: 'PGRST202' } });
    chain.maybeSingle.mockResolvedValue({ data: { order: 5 }, error: null });

    const nextOrder = await fetchNextHabitOrder('widget', 'in_progress');

    expect(chain.select).toHaveBeenCalledWith('order');
    expect(nextOrder).toBe(6);
  });

  it('fallback возвращает 1, если записей нет', async () => {
    mockSupabase.rpc.mockResolvedValue({ data: null, error: { code: 'PGRST202' } });
    chain.maybeSingle.mockResolvedValue({ data: null, error: null });

    const nextOrder = await fetchNextHabitOrder('widget', 'not_started');

    expect(nextOrder).toBe(1);
  });
});

