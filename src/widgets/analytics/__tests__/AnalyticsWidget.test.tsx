import { fireEvent, render, screen } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import type { AnalyticsSettings, AnalyticsTimer, CompletedTaskWithCategories } from '../../../features/analytics/types';
import { AnalyticsWidget } from '../AnalyticsWidget';

const mockSettings: AnalyticsSettings = {
  user_id: 'user-1',
  period_start: '2025-01-01',
  period_end: '2025-01-07',
  updated_at: '2025-01-01T00:00:00Z',
};

const mockTimers: AnalyticsTimer[] = [
  {
    id: 'timer-1',
    user_id: 'user-1',
    name: 'Таймер 1',
    color: '#7dd3fc',
    days_mask: '1111111',
    tag_ids: ['tag-1'],
    category_ids: ['cat-1'],
    sort_order: 0,
    created_at: '2025-01-01T00:00:00Z',
    updated_at: '2025-01-01T00:00:00Z',
  },
];

const mockTasks: CompletedTaskWithCategories[] = [
  {
    id: 'task-1',
    widget_id: 'widget-1',
    user_id: 'user-1',
    title: 'Задача',
    created_at: '2025-01-05T10:00:00Z',
    updated_at: '2025-01-05T10:00:00Z',
    elapsed_seconds: 65,
    is_done: true,
    categories: [
      {
        id: 'cat-1',
        name: 'Работа',
        color: 'rose',
        is_auto: false,
        tags: [
          {
            id: 'tag-1',
            name: 'Дом',
            user_id: 'user-1',
            created_at: '2025-01-01T00:00:00Z',
            updated_at: '2025-01-01T00:00:00Z',
          },
        ],
      },
    ],
  },
  {
    id: 'task-2',
    widget_id: 'widget-1',
    user_id: 'user-1',
    title: 'Задача 2',
    created_at: '2025-01-04T10:00:00Z',
    updated_at: '2025-01-04T10:00:00Z',
    elapsed_seconds: 3665,
    is_done: true,
    categories: [
      {
        id: 'cat-1',
        name: 'Работа',
        color: 'rose',
        is_auto: false,
        tags: [
          {
            id: 'tag-1',
            name: 'Дом',
            user_id: 'user-1',
            created_at: '2025-01-01T00:00:00Z',
            updated_at: '2025-01-01T00:00:00Z',
          },
        ],
      },
    ],
  },
];

const queryClientMock = {
  invalidateQueries: vi.fn(),
};

vi.mock('@tanstack/react-query', () => ({
  useInfiniteQuery: () => ({
    data: { pages: [mockTasks] },
    fetchNextPage: vi.fn(),
    hasNextPage: false,
    isFetchingNextPage: false,
  }),
  useMutation: () => ({ mutate: vi.fn() }),
  useQueryClient: () => queryClientMock,
}));

vi.mock('../../../features/analytics/hooks', () => ({
  useAnalyticsSettings: () => ({ data: mockSettings }),
  useUpsertAnalyticsSettings: () => ({ mutate: vi.fn() }),
  useAnalyticsTimers: () => ({ data: mockTimers }),
  useCreateAnalyticsTimer: () => ({ mutateAsync: vi.fn() }),
  useUpdateAnalyticsTimer: () => ({ mutate: vi.fn() }),
  useDeleteAnalyticsTimer: () => ({ mutate: vi.fn() }),
}));

vi.mock('../../../features/microTasks/hooks', () => ({
  useAttachCategoryToTask: () => ({ mutateAsync: vi.fn() }),
  useDetachCategoryFromTask: () => ({ mutateAsync: vi.fn() }),
  useTaskTags: () => ({ data: [{ id: 'tag-1', name: 'Дом' }] }),
  useTaskCategories: () => ({ data: [{ id: 'cat-1', name: 'Работа', color: 'rose', is_auto: false }] }),
}));

vi.mock('../../../stores/authStore', () => ({
  useAuthStore: (selector: (state: { user: { id: string } }) => void) =>
    selector({ user: { id: 'user-1' } }),
}));

describe('AnalyticsWidget UI', () => {
  beforeEach(() => {
    queryClientMock.invalidateQueries.mockClear();
  });

  it('renders chart legend with larger text class', () => {
    render(<AnalyticsWidget widgetId="analytics" />);
    const matches = screen.getAllByText('Таймер 1');
    const hasLegend = matches.some((node) => node.closest('div')?.className.includes('text-2xl'));
    expect(hasLegend).toBe(true);
  });

  it('renders task date in DD.MM.YYYY and time in MM:SS format', () => {
    render(<AnalyticsWidget widgetId="analytics" />);
    expect(screen.getAllByText('05.01.2025').length).toBeGreaterThan(0);
    expect(screen.getAllByText('01:05').length).toBeGreaterThan(0);
  });

  it('renders time without leading zero hour when hours present', () => {
    render(<AnalyticsWidget widgetId="analytics" />);
    expect(screen.getAllByText('1:01:05').length).toBeGreaterThan(0);
  });

  it('uses full week day count for avg metric', () => {
    render(<AnalyticsWidget widgetId="analytics" />);
    fireEvent.click(screen.getByText('Недели'));
    fireEvent.click(screen.getByText('Среднее'));
    expect(screen.getByText('0.2ч/день')).toBeInTheDocument();
  });

  it('does not render tab toggle buttons', () => {
    render(<AnalyticsWidget widgetId="analytics" />);
    expect(screen.queryByRole('button', { name: 'Задачи' })).not.toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Графики' })).not.toBeInTheDocument();
  });

  it('renders tasks and charts together', () => {
    render(<AnalyticsWidget widgetId="analytics" />);
    expect(screen.getByText('Задача')).toBeInTheDocument();
    expect(screen.getByText('Сумма')).toBeInTheDocument();
  });

  it('shows per-bucket percent values', () => {
    render(<AnalyticsWidget widgetId="analytics" />);
    fireEvent.click(screen.getByText('%'));
    expect(screen.getAllByText('100.0%').length).toBeGreaterThan(0);
  });

  it('shows add tag button in timer section', () => {
    render(<AnalyticsWidget widgetId="analytics" />);
    expect(screen.getByText('Добавить тег')).toBeInTheDocument();
  });
});
