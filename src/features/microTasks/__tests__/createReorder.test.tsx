import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { act, renderHook, waitFor } from '@testing-library/react';
import type { ReactNode } from 'react';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import type { MicroTaskGroupTaskUpdatePayload, MicroTaskRecord } from '../types';
import { buildFlatList, computeReorderFromFlatList } from '../../../widgets/microTasks/utils/dndUtils';

const mocks = vi.hoisted(() => ({
  rows: [] as MicroTaskRecord[],
  classify: vi.fn<(title: string) => Promise<string[]>>(),
  create: vi.fn(),
  attach: vi.fn(),
  reorder: vi.fn(),
  reorderSimple: vi.fn(),
  startTimer: vi.fn(),
  delete: vi.fn(),
}));

vi.mock('../../../lib/supabaseClient', () => ({ supabase: {} }));
vi.mock('../../../stores/authStore', () => ({
  useAuthStore: (select: (state: { user: { id: string } }) => unknown) =>
    select({ user: { id: 'user-1' } }),
}));
vi.mock('../api', async (importOriginal) => ({
  ...await importOriginal<typeof import('../api')>(),
  getMicroTasks: vi.fn(async () => ({
    data: mocks.rows.map((row) => ({
      ...row,
      categories: row.categories?.map((category) => ({ task_categories: category })),
    })),
    error: null,
  })),
  getTaskCategoryBuffer: vi.fn(async () => []),
  fetchNextMicroTaskOrder: vi.fn(async () => 3),
  classifyMicrotaskCategories: mocks.classify,
  createMicroTask: mocks.create,
  attachCategoriesToTask: mocks.attach,
  reorderMicroTaskItems: mocks.reorder,
  reorderMicroTasks: mocks.reorderSimple,
  startMicroTaskTimer: mocks.startTimer,
  deleteMicroTask: mocks.delete,
  updateMicroTask: vi.fn(async () => ({ data: null, error: null })),
}));

import {
  useCreateMicroTask, useDeleteMicroTask, useMicroTasks, useReorderMicroTaskItems,
  useReorderMicroTasks, useToggleMicroTaskTimer,
} from '../hooks';

const WIDGET = 'widget-1';
const KEY = ['microTasks', WIDGET];

function deferred<T>() {
  let resolve!: (value: T) => void;
  const promise = new Promise<T>((done) => { resolve = done; });
  return { promise, resolve };
}

function task(id: string, order: number): MicroTaskRecord {
  return {
    id, order, title: id, widget_id: WIDGET, user_id: 'user-1',
    is_done: false, group_id: null, group_order: null,
    elapsed_seconds: 0, timer_state: 'never', last_started_at: null,
    archived_at: null, created_at: '2026-01-01', updated_at: '2026-01-01', categories: [],
  };
}

function saveUpdates(updates: Array<{ id: string; order: number }>) {
  // The real PostgreSQL RPC casts every id to UUID and rolls back the
  // entire batch if a temp-id slips through, including the other rows.
  if (updates.some(({ id }) => id.startsWith('temp-'))) throw new Error('invalid UUID');
  updates.forEach((update) => {
    const row = mocks.rows.find(({ id }) => id === update.id);
    if (row) Object.assign(row, update);
  });
}

function setup() {
  const client = new QueryClient({
    defaultOptions: { queries: { retry: false, gcTime: 0 }, mutations: { retry: false } },
  });
  const wrapper = ({ children }: { children: ReactNode }) => (
    <QueryClientProvider client={client}>{children}</QueryClientProvider>
  );
  const hook = renderHook(() => ({
    list: useMicroTasks(WIDGET),
    create: useCreateMicroTask(WIDGET),
    reorder: useReorderMicroTaskItems(WIDGET),
    reorderSimple: useReorderMicroTasks(WIDGET),
    delete: useDeleteMicroTask(WIDGET),
    toggle: useToggleMicroTaskTimer(WIDGET),
  }), { wrapper });
  const cache = () => client.getQueryData<MicroTaskRecord[]>(KEY) ?? [];
  const refetch = () => act(async () => { await client.refetchQueries({ queryKey: KEY }); });
  return { ...hook, client, cache, refetch };
}

async function beginCreate(harness: ReturnType<typeof setup>, title = 'new task') {
  await waitFor(() => expect(harness.result.current.list.isSuccess).toBe(true));
  act(() => { harness.result.current.create.mutate({ title }); });
  await waitFor(() => expect(mocks.classify).toHaveBeenCalledWith(title));
  return harness.cache().find((row) => row.title === title)!.id;
}

describe('moving a micro-task while it is being created', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    [mocks.classify, mocks.create, mocks.attach, mocks.reorder, mocks.reorderSimple, mocks.startTimer, mocks.delete]
      .forEach((mock) => mock.mockReset());
    mocks.rows.splice(0, mocks.rows.length, task('old-1', 1), task('old-2', 2));
    mocks.create.mockImplementation(async (payload: MicroTaskRecord) => {
      const row = { ...task(`server-${mocks.rows.length}`, payload.order), ...payload };
      mocks.rows.push(row);
      // INSERT responses are snapshots, not live objects that follow later reorders.
      return { data: { ...row }, error: null };
    });
    mocks.attach.mockImplementation(async (id: string) => {
      mocks.rows.find((row) => row.id === id)!.categories = [{
        id: 'category-1', name: 'Work', is_auto: false, user_id: 'user-1',
        created_at: '2026-01-01', updated_at: '2026-01-01',
      }];
    });
    mocks.reorder.mockImplementation(async ({ taskUpdates }: { taskUpdates: MicroTaskGroupTaskUpdatePayload[] }) => {
      saveUpdates(taskUpdates);
    });
    mocks.reorderSimple.mockImplementation(async ({ updates }: { updates: Array<{ id: string; order: number }> }) => {
      saveUpdates(updates);
    });
    mocks.startTimer.mockImplementation(async (id: string) => {
      mocks.rows.find((row) => row.id === id)!.timer_state = 'running';
    });
    mocks.delete.mockImplementation(async (id: string) => {
      mocks.rows.splice(mocks.rows.findIndex((row) => row.id === id), 1);
    });
  });

  it('keeps a move made during classification, including across refetch and category arrival', async () => {
    const classification = deferred<string[]>();
    mocks.classify.mockReturnValue(classification.promise);
    const h = setup();
    const tempId = await beginCreate(h);
    const updates = computeReorderFromFlatList([`task:${tempId}`, 'task:old-1', 'task:old-2']);
    await act(async () => { await h.result.current.reorder.mutateAsync(updates); });
    await h.refetch();
    expect(buildFlatList(h.cache(), [])[0]).toBe(`task:${tempId}`);

    await act(async () => { classification.resolve(['category-1']); });
    await waitFor(() => expect(h.result.current.create.isSuccess).toBe(true));
    await h.refetch();
    const created = mocks.rows.find((row) => row.title === 'new task')!;
    expect(created.order).toBe(1);
    expect(buildFlatList(h.cache(), [])).toEqual([
      `task:${created.id}`, 'task:old-1', 'task:old-2',
    ]);
    expect(h.cache().find((row) => row.id === created.id)?.categories?.[0].id).toBe('category-1');
    expect(h.cache()).toHaveLength(3);
  });

  it.each(['INSERT response', 'category attachment'])('keeps a move made while waiting for %s', async (stage) => {
    const classification = deferred<string[]>();
    const gate = deferred<void>();
    mocks.classify.mockReturnValue(classification.promise);
    const operation = stage === 'INSERT response' ? mocks.create : mocks.attach;
    const original = operation.getMockImplementation()!;
    operation.mockImplementationOnce(async (...args: unknown[]) => {
      const response = await original(...args);
      await gate.promise;
      return response;
    });
    const h = setup();
    const tempId = await beginCreate(h);
    await act(async () => { classification.resolve(['category-1']); });
    await waitFor(() => expect(operation).toHaveBeenCalledTimes(1));
    await act(async () => {
      await h.result.current.reorder.mutateAsync(computeReorderFromFlatList([
        `task:${tempId}`, 'task:old-1', 'task:old-2',
      ]));
    });
    if (stage === 'category attachment') {
      await h.refetch();
      // The INSERT has completed, but its real row must not appear beside its placeholder.
      expect(h.cache().filter((row) => row.title === 'new task')).toHaveLength(1);
      expect(buildFlatList(h.cache(), [])[0]).toBe(`task:${tempId}`);
    }
    await act(async () => { gate.resolve(); });
    await waitFor(() => expect(h.result.current.create.isSuccess).toBe(true));
    await h.refetch();
    expect(mocks.rows.find((row) => row.title === 'new task')?.order).toBe(1);
    expect(buildFlatList(h.cache(), [])[0]).toBe(`task:${mocks.rows[2].id}`);
  });

  it.each(['move again', 'cancel', 'start timer'])('handles "%s" during the final position save', async (action) => {
    const classification = deferred<string[]>();
    const attachment = deferred<void>();
    const saving = deferred<void>();
    mocks.classify.mockReturnValue(classification.promise);
    const attach = mocks.attach.getMockImplementation()!;
    mocks.attach.mockImplementationOnce(async (...args: unknown[]) => {
      await attach(...args);
      await attachment.promise;
    });
    const h = setup();
    const tempId = await beginCreate(h);
    await act(async () => { classification.resolve(['category-1']); });
    await waitFor(() => expect(mocks.attach).toHaveBeenCalledTimes(1));
    await act(async () => {
      await h.result.current.reorder.mutateAsync(computeReorderFromFlatList([
        `task:${tempId}`, 'task:old-1', 'task:old-2',
      ]));
    });
    const save = mocks.reorder.getMockImplementation()!;
    mocks.reorder.mockImplementationOnce(async (...args: unknown[]) => {
      await saving.promise;
      await save(...args);
    });
    const callsBeforeSave = mocks.reorder.mock.calls.length;
    await act(async () => { attachment.resolve(); });
    await waitFor(() => expect(mocks.reorder.mock.calls.length).toBe(callsBeforeSave + 1));
    if (action === 'move again') {
      await act(async () => {
        await h.result.current.reorder.mutateAsync(computeReorderFromFlatList([
          'task:old-1', 'group:group-1', `task:${tempId}`, 'gend:group-1', 'task:old-2',
        ]));
      });
    } else if (action === 'cancel') {
      await act(async () => { await h.result.current.delete.mutateAsync(tempId); });
    } else {
      await act(async () => { await h.result.current.toggle.mutateAsync({ id: tempId, isRunning: false }); });
    }
    await act(async () => { saving.resolve(); });
    await waitFor(() => expect(h.result.current.create.isSuccess).toBe(true));
    await h.refetch();
    if (action === 'cancel') {
      expect(mocks.rows.some((row) => row.title === 'new task')).toBe(false);
      expect(h.cache().some((row) => row.title === 'new task')).toBe(false);
    } else {
      const expected = action === 'move again'
        ? { order: 2, group_id: 'group-1', group_order: 1 }
        : { order: 1, timer_state: 'running' };
      expect(mocks.rows.find((row) => row.title === 'new task')).toMatchObject(expected);
      expect(h.cache().find((row) => row.title === 'new task')).toMatchObject(expected);
    }
  });

  it('rolls back the pending placement if the reorder RPC fails', async () => {
    const classification = deferred<string[]>();
    mocks.classify.mockReturnValue(classification.promise);
    const h = setup();
    const tempId = await beginCreate(h);
    mocks.reorder.mockRejectedValueOnce(new Error('reorder failed'));
    await act(async () => {
      await expect(h.result.current.reorder.mutateAsync(computeReorderFromFlatList([
        `task:${tempId}`, 'task:old-1', 'task:old-2',
      ]))).rejects.toThrow('reorder failed');
    });
    await act(async () => { classification.resolve(['category-1']); });
    await waitFor(() => expect(h.result.current.create.isSuccess).toBe(true));
    await h.refetch();
    expect(mocks.rows.find((row) => row.title === 'new task')?.order).toBe(3);
    expect(buildFlatList(h.cache(), [])[0]).toBe('task:old-1');
  });

  it('preserves the order of two pending creates that finish in reverse order', async () => {
    const first = deferred<string[]>();
    const second = deferred<string[]>();
    mocks.classify.mockImplementation((title) => title === 'first' ? first.promise : second.promise);
    const h = setup();
    const firstId = await beginCreate(h, 'first');
    const secondId = await beginCreate(h, 'second');
    await act(async () => {
      await h.result.current.reorder.mutateAsync(computeReorderFromFlatList([
        `task:${secondId}`, 'task:old-1', `task:${firstId}`, 'task:old-2',
      ]));
    });
    await act(async () => { second.resolve(['category-1']); });
    await waitFor(() => expect(h.cache().some((row) => row.title === 'second' && !row.id.startsWith('temp-'))).toBe(true));
    await h.refetch();
    expect([...h.cache()].sort((a, b) => a.order - b.order).map((row) => row.title))
      .toEqual(['second', 'old-1', 'first', 'old-2']);
    await act(async () => { first.resolve(['category-1']); });
    await waitFor(() => expect(h.cache().every((row) => !row.id.startsWith('temp-'))).toBe(true));
    await h.refetch();
    expect([...h.cache()].sort((a, b) => a.order - b.order).map((row) => row.title))
      .toEqual(['second', 'old-1', 'first', 'old-2']);
  });

  it('also handles the order-only mutation without sending temp IDs to the server', async () => {
    const classification = deferred<string[]>();
    mocks.classify.mockReturnValue(classification.promise);
    const h = setup();
    const tempId = await beginCreate(h);
    await act(async () => {
      await h.result.current.reorderSimple.mutateAsync([
        { id: tempId, order: 1 }, { id: 'old-1', order: 2 }, { id: 'old-2', order: 3 },
      ]);
    });
    await act(async () => { classification.resolve(['category-1']); });
    await waitFor(() => expect(h.result.current.create.isSuccess).toBe(true));
    await h.refetch();
    expect(buildFlatList(h.cache(), [])[0]).toBe(`task:${mocks.rows[2].id}`);
  });
});
