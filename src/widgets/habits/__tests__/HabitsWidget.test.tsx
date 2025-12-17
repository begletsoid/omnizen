import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { act, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { beforeAll, beforeEach, describe, expect, it, vi, type MockInstance } from 'vitest';

import type { HabitRecord } from '../../../features/habits/types';
import { HabitsWidget } from '../HabitsWidget';

const mockHabitsState = {
  data: [] as HabitRecord[] | undefined,
  isLoading: false,
  isError: false,
  error: null,
};
const updateHabitMock = { mutateAsync: vi.fn(), mutate: vi.fn() };

vi.mock('../../../features/habits/hooks', () => ({
  useHabits: () => mockHabitsState,
  useCreateHabit: () => ({ mutateAsync: vi.fn() }),
  useUpdateHabit: () => updateHabitMock,
  useSaveHabitOrders: () => ({ mutateAsync: vi.fn() }),
  useDeleteHabit: () => ({ mutate: vi.fn() }),
}));

vi.mock('@dnd-kit/core', () => ({
  DndContext: ({ children }: { children: React.ReactNode }) => <div>{children}</div>,
  closestCorners: vi.fn(),
  PointerSensor: vi.fn(),
  useSensor: () => ({}),
  useSensors: () => [],
  useDroppable: () => ({ setNodeRef: vi.fn(), isOver: false }),
}));

vi.mock('@dnd-kit/sortable', () => ({
  SortableContext: ({ children }: { children: React.ReactNode }) => <div>{children}</div>,
  defaultAnimateLayoutChanges: vi.fn(),
  useSortable: () => ({
    attributes: {},
    listeners: {},
    setNodeRef: vi.fn(),
    transform: null,
    transition: null,
    isDragging: false,
  }),
  verticalListSortingStrategy: vi.fn(),
}));

vi.mock('@dnd-kit/utilities', () => ({
  CSS: {
    Transform: {
      toString: () => '',
    },
  },
}));

describe('HabitsWidget scroll behavior', () => {
  let rafSpy: MockInstance;
  let cafSpy: MockInstance;

  beforeAll(() => {
    rafSpy = vi
      .spyOn(window, 'requestAnimationFrame')
      .mockImplementation((cb: FrameRequestCallback) => {
        const id = window.setTimeout(() => cb(0), 0);
        return id as unknown as number;
      });
    cafSpy = vi
      .spyOn(window, 'cancelAnimationFrame')
      .mockImplementation((id: number) => {
        window.clearTimeout(id);
      });
  });

  afterAll(() => {
    rafSpy.mockRestore();
    cafSpy.mockRestore();
  });

  beforeEach(() => {
    mockHabitsState.data = buildHabits(6);
    updateHabitMock.mutateAsync.mockReset();
    updateHabitMock.mutate.mockReset();
  });

  describe('scroll restoration', () => {
    it('восстанавливает прокрутку из initialScrollTop после загрузки', async () => {
      const { getByTestId } = renderWithClient(
        <HabitsWidget widgetId="w1" initialScrollTop={120} />,
      );
      const scrollable = getByTestId('habits-scrollable');
      mockScrollableMetrics(scrollable, { scrollHeight: 600, clientHeight: 200 });

      await waitFor(() => {
        expect(scrollable.scrollTop).toBe(120);
      });
    });

    it('повторяет попытку восстановления, когда изначально нет переполнения', async () => {
      const { getByTestId } = renderWithClient(
        <HabitsWidget widgetId="w1" initialScrollTop={150} />,
      );
      const scrollable = getByTestId('habits-scrollable');
      mockScrollableMetrics(scrollable, { scrollHeight: 200, clientHeight: 200 });

      await waitFor(() => {
        expect(scrollable.scrollTop).toBe(0);
      });

      mockScrollableMetrics(scrollable, { scrollHeight: 500, clientHeight: 200 });

      await waitFor(() => {
        expect(scrollable.scrollTop).toBe(150);
      });
    });
  });

  it('debounce-сохраняет позицию прокрутки', async () => {
    const onScrollPersist = vi.fn();
    const timers: Array<() => void> = [];
    const originalSetTimeout = window.setTimeout;
    const originalClearTimeout = window.clearTimeout;

    window.setTimeout = ((handler: TimerHandler, timeout?: number, ...args: unknown[]) => {
      if (typeof handler === 'function' && timeout === 250) {
        const index = timers.length;
        timers.push(() => handler(...args));
        return index as unknown as number;
      }
      return originalSetTimeout(handler, timeout ?? 0, ...args);
    }) as typeof window.setTimeout;

    window.clearTimeout = ((id?: number) => {
      if (typeof id === 'number' && timers[id]) {
        timers[id] = () => {};
        return;
      }
      originalClearTimeout(id);
    }) as typeof window.clearTimeout;

    try {
      const { getByTestId } = renderWithClient(
        <HabitsWidget widgetId="w1" initialScrollTop={0} onScrollPersist={onScrollPersist} />,
      );
      const scrollable = getByTestId('habits-scrollable');
      mockScrollableMetrics(scrollable, { scrollHeight: 600, clientHeight: 200 });

      await act(async () => {
        scrollable.scrollTop = 250;
        scrollable.dispatchEvent(new Event('scroll', { bubbles: true }));
      });

      timers.forEach((flush) => flush());
      expect(onScrollPersist).toHaveBeenCalledWith(250);
    } finally {
      window.setTimeout = originalSetTimeout;
      window.clearTimeout = originalClearTimeout;
    }
  });

  it('позволяет редактировать название привычки инлайн', async () => {
    renderWithClient(<HabitsWidget widgetId="w1" />);
    const titleButton = screen.getByText('Habit 0');
    fireEvent.click(titleButton);
    const input = screen.getByDisplayValue('Habit 0');
    fireEvent.change(input, { target: { value: 'Updated habit' } });
    fireEvent.keyDown(input, { key: 'Enter' });

    await waitFor(() => {
      expect(updateHabitMock.mutateAsync).toHaveBeenCalledWith({
        id: 'habit-0',
        title: 'Updated habit',
      });
    });
  });
});

function buildHabits(count: number): HabitRecord[] {
  return Array.from({ length: count }).map((_, index) => ({
    id: `habit-${index}`,
    widget_id: 'w1',
    user_id: 'user-1',
    title: `Habit ${index}`,
    status: 'not_started',
    order: index + 1,
    created_at: new Date().toISOString(),
    updated_at: new Date().toISOString(),
    success_count: 0,
    fail_count: 0,
    success_updated_at: new Date().toISOString(),
  }));
}

function mockScrollableMetrics(
  element: HTMLElement,
  { scrollHeight, clientHeight }: { scrollHeight: number; clientHeight: number },
) {
  Object.defineProperty(element, 'scrollHeight', {
    configurable: true,
    value: scrollHeight,
  });
  Object.defineProperty(element, 'clientHeight', {
    configurable: true,
    value: clientHeight,
  });
}

function renderWithClient(ui: React.ReactElement) {
  const client = new QueryClient();
  return render(<QueryClientProvider client={client}>{ui}</QueryClientProvider>);
}

