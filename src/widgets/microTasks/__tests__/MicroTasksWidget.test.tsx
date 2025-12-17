import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import type { MicroTaskRecord } from '../../../features/microTasks/types';
import { MicroTasksWidget } from '../MicroTasksWidget';

const mockTasksState = {
  data: [] as MicroTaskRecord[] | undefined,
  isLoading: false,
  isError: false,
  error: null,
};

const updateTaskMock = { mutateAsync: vi.fn() };
const archiveTaskMock = { mutateAsync: vi.fn(), isPending: false, variables: undefined as string | undefined };
const updateCategoryColorMock = createMutationMock();
const reorderTasksMock = { mutate: vi.fn() };

function createMutationMock() {
  return {
    mutate: vi.fn(),
    mutateAsync: vi.fn(),
  };
}

vi.mock('../../../features/microTasks/hooks', () => ({
  useMicroTasks: () => mockTasksState,
  useCreateMicroTask: () => ({ mutateAsync: vi.fn() }),
  useUpdateMicroTask: () => updateTaskMock,
  useDeleteMicroTask: () => ({ mutateAsync: vi.fn() }),
  useArchiveMicroTask: () => archiveTaskMock,
  useReorderMicroTasks: () => reorderTasksMock,
  useToggleMicroTaskTimer: () => ({ mutateAsync: vi.fn() }),
  useAttachCategoryToTask: createMutationMock,
  useDetachCategoryFromTask: createMutationMock,
  useSetTaskCategoryBuffer: createMutationMock,
  useTaskTags: () => ({ data: [] }),
  useTaskCategories: () => ({ data: [] }),
  useCreateTaskTag: createMutationMock,
  useDeleteTaskTag: createMutationMock,
  useCreateTaskCategory: createMutationMock,
  useRenameTaskCategory: createMutationMock,
  useDeleteTaskCategory: createMutationMock,
  useAttachTagToCategory: createMutationMock,
  useDetachTagFromCategory: createMutationMock,
  useUpdateTaskCategoryColor: () => updateCategoryColorMock,
}));

vi.mock('@dnd-kit/core', () => ({
  DndContext: ({ children }: { children: React.ReactNode }) => <div>{children}</div>,
  PointerSensor: vi.fn(),
  useSensor: () => ({}),
  useSensors: () => [],
  closestCorners: vi.fn(),
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
  horizontalListSortingStrategy: vi.fn(),
}));

vi.mock('@dnd-kit/utilities', () => ({
  CSS: {
    Transform: {
      toString: () => '',
    },
  },
}));

describe('MicroTasksWidget inline editing', () => {
  beforeEach(() => {
    mockTasksState.data = buildTasks();
    updateTaskMock.mutateAsync.mockReset();
    archiveTaskMock.mutateAsync.mockReset();
    archiveTaskMock.isPending = false;
    archiveTaskMock.variables = undefined;
    updateCategoryColorMock.mutate.mockReset();
    updateCategoryColorMock.mutateAsync.mockReset();
    reorderTasksMock.mutate.mockReset();
  });

  it('измение названия задачи инлайн', async () => {
    render(<MicroTasksWidget widgetId="w1" />);
    const titleButton = screen.getByText('Task 0');
    fireEvent.click(titleButton);
    const input = screen.getByDisplayValue('Task 0');
    fireEvent.change(input, { target: { value: 'Updated micro task' } });
    fireEvent.keyDown(input, { key: 'Enter' });

    await waitFor(() => {
      expect(updateTaskMock.mutateAsync).toHaveBeenCalledWith({
        id: 'task-0',
        title: 'Updated micro task',
      });
    });
  });

  it('архивирует выполненную задачу', async () => {
    mockTasksState.data = buildTasks().map((task, index) =>
      index === 0 ? { ...task, is_done: true } : task,
    );
    render(<MicroTasksWidget widgetId="w1" />);

    const archiveButtons = screen.getAllByRole('button', { name: 'Архивировать задачу' });
    expect(archiveButtons[1]).toBeDisabled();
    fireEvent.click(archiveButtons[0]);

    await waitFor(() => {
      expect(archiveTaskMock.mutateAsync).toHaveBeenCalledWith('task-0');
    });
  });

  it('позволяет вручную изменить время задачи', async () => {
    render(<MicroTasksWidget widgetId="w1" />);

    const timeButton = screen.getByLabelText('Редактировать время задачи Task 0');
    fireEvent.click(timeButton);

    const input = screen.getByDisplayValue('0:00');
    fireEvent.change(input, { target: { value: '01:30:00' } });
    fireEvent.keyDown(input, { key: 'Enter' });

    await waitFor(() => {
      expect(updateTaskMock.mutateAsync).toHaveBeenCalledWith({
        id: 'task-0',
        elapsed_seconds: 5400,
        timer_state: 'paused',
        last_started_at: null,
      });
    });
  });

  it('перемещает завершённую задачу под блок выполненных', async () => {
    mockTasksState.data = [
      { ...buildTask('task-0', 1), is_done: false },
      { ...buildTask('task-1', 2), is_done: true },
      { ...buildTask('task-2', 3), is_done: false },
    ];
    render(<MicroTasksWidget widgetId="w1" />);

    const toggleButtons = screen.getAllByLabelText('Отметить как выполненную');
    fireEvent.click(toggleButtons[0]);

    await waitFor(() => {
      expect(updateTaskMock.mutateAsync).toHaveBeenCalledWith({ id: 'task-0', is_done: true });
    });
    expect(reorderTasksMock.mutate).toHaveBeenCalledWith([
      { id: 'task-1', order: 1 },
      { id: 'task-0', order: 2 },
      { id: 'task-2', order: 3 },
    ]);
    expect(reorderTasksMock.mutate).toHaveBeenCalledTimes(1);
  });

  it('позволяет вернуть задачу из завершённых в активные', async () => {
    render(<MicroTasksWidget widgetId="w1" />);
    const toggleButton = screen.getAllByLabelText('Отметить как выполненную')[0];
    fireEvent.click(toggleButton);

    await waitFor(() => {
      expect(updateTaskMock.mutateAsync).toHaveBeenCalledWith({ id: 'task-0', is_done: true });
    });

    updateTaskMock.mutateAsync.mockClear();
    const revertButton = await screen.findByLabelText('Вернуть в активные');
    fireEvent.click(revertButton);

    await waitFor(() => {
      expect(updateTaskMock.mutateAsync).toHaveBeenCalledWith({ id: 'task-0', is_done: false });
    });
    expect(reorderTasksMock.mutate).toHaveBeenCalledTimes(1);
  });
});

function buildTasks(): MicroTaskRecord[] {
  return Array.from({ length: 2 }).map((_, index) => ({
    id: `task-${index}`,
    widget_id: 'w1',
    user_id: 'user-1',
    title: `Task ${index}`,
    is_done: false,
    order: index + 1,
    elapsed_seconds: 0,
    timer_state: 'paused',
    last_started_at: null,
    archived_at: null,
    created_at: new Date().toISOString(),
    updated_at: new Date().toISOString(),
    categories: [],
  }));
}

function buildTask(id: string, order: number): MicroTaskRecord {
  return {
    id,
    widget_id: 'w1',
    user_id: 'user-1',
    title: `Task ${order}`,
    is_done: false,
    order,
    elapsed_seconds: 0,
    timer_state: 'paused',
    last_started_at: null,
    archived_at: null,
    created_at: new Date().toISOString(),
    updated_at: new Date().toISOString(),
    categories: [],
  };
}

