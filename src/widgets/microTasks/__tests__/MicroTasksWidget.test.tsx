import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import type { ReactElement, ReactNode } from 'react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import type { MicroTaskGroup, MicroTaskGroupTemplate, MicroTaskRecord } from '../../../features/microTasks/types';
import { MicroTasksWidget } from '../MicroTasksWidget';

const mockTasksState = {
  data: [] as MicroTaskRecord[] | undefined,
  isLoading: false,
  isError: false,
  error: null,
};
const mockGroupsState = { data: [] as MicroTaskGroup[] | undefined };
const mockTemplatesState = { data: [] as MicroTaskGroupTemplate[] | undefined };

const updateTaskMock = { mutateAsync: vi.fn() };
const archiveTaskMock = { mutateAsync: vi.fn(), isPending: false, variables: undefined as string | undefined };
const updateCategoryColorMock = createMutationMock();
const reorderItemsMock = { mutate: vi.fn() };
const createGroupTemplateMock = { mutateAsync: vi.fn() };


function createMutationMock() {
  return { mutate: vi.fn(), mutateAsync: vi.fn() };
}

vi.mock('../../../features/microTasks/hooks', () => ({
  useMicroTasks: () => mockTasksState,
  useMicroTaskGroups: () => mockGroupsState,
  useMicroTaskGroupTemplates: () => mockTemplatesState,
  useCreateMicroTask: () => ({ mutateAsync: vi.fn() }),
  useCreateMicroTaskGroup: () => ({ mutateAsync: vi.fn() }),
  useUpdateMicroTaskGroup: () => ({ mutateAsync: vi.fn() }),
  useDeleteMicroTaskGroup: () => ({ mutateAsync: vi.fn() }),
  useCreateMicroTaskGroupTemplate: () => createGroupTemplateMock,
  useDeleteMicroTaskGroupTemplate: () => ({ mutate: vi.fn() }),
  useUpdateMicroTask: () => updateTaskMock,
  useDeleteMicroTask: () => ({ mutateAsync: vi.fn() }),
  useArchiveMicroTask: () => archiveTaskMock,
  useReorderMicroTaskItems: () => reorderItemsMock,
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

let dndContextCallCount = 0;
vi.mock('@dnd-kit/core', () => ({
  DndContext: ({ children }: { children: React.ReactNode }) => {
    dndContextCallCount += 1;
    return <div data-testid={`dnd-context-${dndContextCallCount}`}>{children}</div>;
  },
  PointerSensor: vi.fn(),
  useSensor: () => ({}),
  useSensors: () => [],
}));

vi.mock('@dnd-kit/sortable', () => ({
  SortableContext: ({ children }: { children: React.ReactNode }) => <div>{children}</div>,
  useSortable: () => ({
    attributes: {},
    listeners: {},
    setNodeRef: vi.fn(),
    transform: null,
    transition: null,
    isDragging: false,
  }),
  horizontalListSortingStrategy: vi.fn(),
}));

vi.mock('@dnd-kit/utilities', () => ({
  CSS: {
    Transform: {
      toString: () => '',
    },
  },
}));

describe('MicroTasksWidget', () => {
  beforeEach(() => {
    mockTasksState.data = buildTasks();
    mockGroupsState.data = [];
    mockTemplatesState.data = [];
    dndContextCallCount = 0;
    updateTaskMock.mutateAsync.mockReset();
    archiveTaskMock.mutateAsync.mockReset();
    archiveTaskMock.isPending = false;
    archiveTaskMock.variables = undefined;
    updateCategoryColorMock.mutate.mockReset();
    updateCategoryColorMock.mutateAsync.mockReset();
    reorderItemsMock.mutate.mockReset();
    createGroupTemplateMock.mutateAsync.mockReset();
  });

  it('изменение названия задачи инлайн', async () => {
    renderWithClient(<MicroTasksWidget widgetId="w1" />);
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
    renderWithClient(<MicroTasksWidget widgetId="w1" />);

    const archiveButtons = screen.getAllByRole('button', { name: 'Архивировать задачу' });
    expect(archiveButtons[1]).toBeDisabled();
    fireEvent.click(archiveButtons[0]);

    await waitFor(() => {
      expect(archiveTaskMock.mutateAsync).toHaveBeenCalledWith('task-0');
    });
  });

  it('позволяет вручную изменить время задачи', async () => {
    renderWithClient(<MicroTasksWidget widgetId="w1" />);

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
    renderWithClient(<MicroTasksWidget widgetId="w1" />);

    const toggleButtons = screen.getAllByLabelText('Отметить как выполненную');
    fireEvent.click(toggleButtons[0]);

    await waitFor(() => {
      expect(updateTaskMock.mutateAsync).toHaveBeenCalledWith({ id: 'task-0', is_done: true });
    });
    expect(reorderItemsMock.mutate).toHaveBeenCalledWith({
      taskUpdates: [
        { id: 'task-1', order: 1, group_id: null, group_order: null },
        { id: 'task-0', order: 2, group_id: null, group_order: null },
        { id: 'task-2', order: 3, group_id: null, group_order: null },
      ],
      groupUpdates: [],
    });
    expect(reorderItemsMock.mutate).toHaveBeenCalledTimes(1);
  });

  it('перемещает выполненную задачу наверх группы', async () => {
    mockGroupsState.data = [buildGroup('group-1', 1)];
    mockTasksState.data = [
      { ...buildTask('task-0', 1), group_id: 'group-1', group_order: 1, is_done: false },
      { ...buildTask('task-1', 2), group_id: 'group-1', group_order: 2, is_done: false },
      { ...buildTask('task-2', 3), group_id: 'group-1', group_order: 3, is_done: false },
    ];
    renderWithClient(<MicroTasksWidget widgetId="w1" />);

    const toggleButtons = screen.getAllByLabelText('Отметить как выполненную');
    fireEvent.click(toggleButtons[1]);

    await waitFor(() => {
      expect(updateTaskMock.mutateAsync).toHaveBeenCalledWith({ id: 'task-1', is_done: true });
    });
    expect(reorderItemsMock.mutate).toHaveBeenCalledWith({
      taskUpdates: [
        { id: 'task-1', order: 2, group_id: 'group-1', group_order: 1 },
        { id: 'task-0', order: 1, group_id: 'group-1', group_order: 2 },
        { id: 'task-2', order: 3, group_id: 'group-1', group_order: 3 },
      ],
      groupUpdates: [],
    });
  });

  it('рендерит список задач', () => {
    renderWithClient(<MicroTasksWidget widgetId="w1" />);
    expect(screen.getByText('Task 0')).toBeTruthy();
    expect(screen.getByText('Task 1')).toBeTruthy();
  });

  it('сохраняет шаблон группы без ошибки при дубле имени', async () => {
    mockGroupsState.data = [buildGroup('group-1', 1)];
    mockTasksState.data = [
      { ...buildTask('task-0', 1), group_id: 'group-1', group_order: 1 },
    ];
    createGroupTemplateMock.mutateAsync.mockResolvedValue({});

    renderWithClient(<MicroTasksWidget widgetId="w1" />);
    const saveButton = screen.getByLabelText('Сохранить группу как шаблон');
    fireEvent.click(saveButton);

    await waitFor(() => {
      expect(createGroupTemplateMock.mutateAsync).toHaveBeenCalled();
    });
  });

  it('позволяет вернуть задачу из завершённых в активные', async () => {
    renderWithClient(<MicroTasksWidget widgetId="w1" />);
    const toggleButton = screen.getAllByLabelText('Отметить как выполненную')[0];
    fireEvent.click(toggleButton);

    await waitFor(() => {
      expect(updateTaskMock.mutateAsync).toHaveBeenCalledWith({ id: 'task-0', is_done: true });
    });

    mockTasksState.data = [
      { ...buildTask('task-0', 1), is_done: true },
      { ...buildTask('task-1', 2), is_done: false },
    ];
    renderWithClient(<MicroTasksWidget widgetId="w1" />);
    updateTaskMock.mutateAsync.mockClear();
    const revertButton = await screen.findByLabelText('Вернуть в активные');
    fireEvent.click(revertButton);

    await waitFor(() => {
      expect(updateTaskMock.mutateAsync).toHaveBeenCalledWith({ id: 'task-0', is_done: false });
    });
    expect(reorderItemsMock.mutate).toHaveBeenCalledTimes(1);
  });
});

function renderWithClient(ui: ReactElement) {
  const client = new QueryClient({
    defaultOptions: {
      queries: { retry: false },
      mutations: { retry: false },
    },
  });
  const Wrapper = ({ children }: { children?: ReactNode }) => (
    <QueryClientProvider client={client}>{children}</QueryClientProvider>
  );
  return render(ui, { wrapper: Wrapper });
}

function buildTasks(): MicroTaskRecord[] {
  return Array.from({ length: 2 }).map((_, index) => ({
    id: `task-${index}`,
    widget_id: 'w1',
    user_id: 'user-1',
    title: `Task ${index}`,
    is_done: false,
    order: index + 1,
    group_id: null,
    group_order: null,
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
    group_id: null,
    group_order: null,
    elapsed_seconds: 0,
    timer_state: 'paused',
    last_started_at: null,
    archived_at: null,
    created_at: new Date().toISOString(),
    updated_at: new Date().toISOString(),
    categories: [],
  };
}

function buildGroup(id: string, order: number): MicroTaskGroup {
  return {
    id,
    widget_id: 'w1',
    user_id: 'user-1',
    name: 'Group A',
    order,
    created_at: new Date().toISOString(),
    updated_at: new Date().toISOString(),
  };
}
