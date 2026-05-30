import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { act, renderHook, waitFor } from '@testing-library/react';
import type { ReactNode } from 'react';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import type { MicroTaskRecord } from '../types';

// All mock state lives inside vi.hoisted so the (hoisted) vi.mock factory
// below can reference it without a "cannot access before initialization"
// error.
const mocks = vi.hoisted(() => {
  const serverRows: MicroTaskRecord[] = [];
  const state: { resolveClassify: ((ids: string[]) => void) | null } = {
    resolveClassify: null,
  };
  return {
    serverRows,
    state,
    createMicroTaskMock: vi.fn(async (payload: Record<string, unknown>) => {
      const { start_timer: _s, started_offset_seconds: _o, ...row } = payload;
      const built = {
        id: `srv-${serverRows.length + 1}`,
        elapsed_seconds: 0,
        timer_state: 'never',
        last_started_at: null,
        archived_at: null,
        created_at: '2026-01-01T00:00:00Z',
        updated_at: '2026-01-01T00:00:00Z',
        categories: [],
        ...row,
      } as unknown as MicroTaskRecord;
      serverRows.push(built);
      return { data: built, error: null };
    }),
    deleteMicroTaskMock: vi.fn(async (id: string) => {
      const idx = serverRows.findIndex((r) => r.id === id);
      if (idx >= 0) serverRows.splice(idx, 1);
      return { error: null };
    }),
    classifyMock: vi.fn(
      () => new Promise<string[]>((resolve) => {
        state.resolveClassify = resolve;
      }),
    ),
  };
});

vi.mock('../../../lib/supabaseClient', () => ({ supabase: {} }));

vi.mock('../../../stores/authStore', () => ({
  useAuthStore: (selector: (s: { user: { id: string } }) => unknown) =>
    selector({ user: { id: 'user-1' } }),
}));

vi.mock('../api', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../api')>();
  return {
    ...actual,
    getMicroTasks: vi.fn(async () => ({ data: mocks.serverRows.map((r) => ({ ...r })), error: null })),
    getMicroTaskGroups: vi.fn(async () => ({ data: [], error: null })),
    getTaskCategoryBuffer: vi.fn(async () => []),
    fetchNextMicroTaskOrder: vi.fn(async () => 1),
    classifyMicrotaskCategories: mocks.classifyMock,
    createMicroTask: mocks.createMicroTaskMock,
    deleteMicroTask: mocks.deleteMicroTaskMock,
    attachCategoriesToTask: vi.fn(async () => undefined),
    updateMicroTask: vi.fn(async () => ({ data: null, error: null })),
  };
});

// Imported AFTER mocks are declared.
import { useCreateMicroTask, useDeleteMicroTask, useMicroTasks } from '../hooks';

const WIDGET = 'w1';

function makeWrapper() {
  const qc = new QueryClient({
    defaultOptions: {
      queries: { retry: false, gcTime: 0 },
      // Match production (AppProviders): mutations retry once. This is the
      // configuration that exposed Bug G — a throw-based cancel triggered a
      // retry whose second pass created the task.
      mutations: { retry: 1 },
    },
  });
  const wrapper = ({ children }: { children: ReactNode }) => (
    <QueryClientProvider client={qc}>{children}</QueryClientProvider>
  );
  return { qc, wrapper };
}

function readCache(qc: QueryClient): MicroTaskRecord[] {
  return qc.getQueryData<MicroTaskRecord[]>(['microTasks', WIDGET]) ?? [];
}

describe('create + cancel race (Bug G)', () => {
  beforeEach(() => {
    mocks.serverRows.length = 0;
    mocks.state.resolveClassify = null;
    vi.clearAllMocks();
  });

  it('pressing ✕ on the loading temp-row aborts the create — no server row, no leftover temp', async () => {
    const { qc, wrapper } = makeWrapper();
    const { result } = renderHook(
      () => ({
        create: useCreateMicroTask(WIDGET),
        del: useDeleteMicroTask(WIDGET),
        list: useMicroTasks(WIDGET),
      }),
      { wrapper },
    );

    await waitFor(() => expect(result.current.list.isSuccess).toBe(true));

    // Kick off the create. classifyMicrotaskCategories is parked (deferred),
    // so mutationFn sits in the "loading" window — exactly when the user
    // sees the grey temp-row.
    act(() => {
      result.current.create.mutate({ title: 'Maybe delete me' });
    });

    // The optimistic temp-row is in the cache.
    let tempId = '';
    await waitFor(() => {
      const temp = readCache(qc).find((t) => t.id.startsWith('temp-'));
      expect(temp).toBeTruthy();
      tempId = temp!.id;
    });

    // User presses ✕ while it's still loading.
    act(() => {
      result.current.del.mutate(tempId);
    });

    // A refetch landing mid-flight must NOT resurrect the cancelled temp.
    await act(async () => {
      await qc.refetchQueries({ queryKey: ['microTasks', WIDGET] });
    });
    expect(readCache(qc).some((t) => t.id === tempId)).toBe(false);

    // Let the classify finish — the create should abort, not INSERT.
    await act(async () => {
      mocks.state.resolveClassify?.([]);
      await Promise.resolve();
    });

    await waitFor(() => {
      expect(result.current.create.isPending).toBe(false);
    });

    // Decisive: no INSERT happened, the server has no row, and the cache
    // holds neither the temp nor any created row.
    expect(mocks.createMicroTaskMock).not.toHaveBeenCalled();
    expect(mocks.serverRows).toHaveLength(0);
    expect(readCache(qc)).toHaveLength(0);
  });

  it('normal create (no cancel) still produces the task', async () => {
    const { qc, wrapper } = makeWrapper();
    const { result } = renderHook(
      () => ({
        create: useCreateMicroTask(WIDGET),
        list: useMicroTasks(WIDGET),
      }),
      { wrapper },
    );

    await waitFor(() => expect(result.current.list.isSuccess).toBe(true));

    act(() => {
      result.current.create.mutate({ title: 'Keep me' });
    });
    await waitFor(() => expect(readCache(qc).some((t) => t.id.startsWith('temp-'))).toBe(true));

    await act(async () => {
      mocks.state.resolveClassify?.([]);
      await Promise.resolve();
    });

    await waitFor(() => {
      expect(mocks.createMicroTaskMock).toHaveBeenCalledTimes(1);
      expect(mocks.serverRows).toHaveLength(1);
      expect(mocks.serverRows[0].title).toBe('Keep me');
    });
  });
});
