import { fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import type { MicroTaskRecord, TaskCategory, TaskTag } from '../types';
import { MicroTasksWidget } from '../../../widgets/microTasks/MicroTasksWidget';

const buildMutation = () => ({
  mutate: vi.fn(),
  mutateAsync: vi.fn().mockResolvedValue(undefined),
});

const attachCategoryToTaskMutation = buildMutation();
const detachCategoryFromTaskMutation = buildMutation();
const setCategoryBufferMutation = buildMutation();
const createTaskTagMutation = buildMutation();
const deleteTaskTagMutation = buildMutation();
const createTaskCategoryMutation = buildMutation();
const renameTaskCategoryMutation = buildMutation();
const deleteTaskCategoryMutation = buildMutation();
const attachTagToCategoryMutation = buildMutation();
const detachTagFromCategoryMutation = buildMutation();
const createMicroTaskMutation = buildMutation();
const updateMicroTaskMutation = buildMutation();
const deleteMicroTaskMutation = buildMutation();
const toggleTimerMutation = buildMutation();
const reorderMicroTasksMutation = vi.fn();
const archiveMicroTaskMutation = { ...buildMutation(), isPending: false, variables: undefined as string | undefined };
const updateCategoryColorMutation = buildMutation();

let mockTags: TaskTag[] = [];
let mockCategories: TaskCategory[] = [];
let mockTasks: MicroTaskRecord[] = [];

const mockTasksState = {
  data: mockTasks,
  isLoading: false,
  isError: false,
  error: null,
};

vi.mock('../../../features/microTasks/hooks', () => ({
  useMicroTasks: () => mockTasksState,
  useCreateMicroTask: () => createMicroTaskMutation,
  useUpdateMicroTask: () => updateMicroTaskMutation,
  useDeleteMicroTask: () => deleteMicroTaskMutation,
  useReorderMicroTasks: () => ({ mutate: reorderMicroTasksMutation }),
  useToggleMicroTaskTimer: () => ({ mutateAsync: toggleTimerMutation.mutateAsync }),
  useArchiveMicroTask: () => archiveMicroTaskMutation,
  useTaskTags: () => ({ data: mockTags }),
  useTaskCategories: () => ({ data: mockCategories }),
  useCreateTaskTag: () => createTaskTagMutation,
  useDeleteTaskTag: () => deleteTaskTagMutation,
  useCreateTaskCategory: () => createTaskCategoryMutation,
  useRenameTaskCategory: () => renameTaskCategoryMutation,
  useDeleteTaskCategory: () => deleteTaskCategoryMutation,
  useAttachTagToCategory: () => attachTagToCategoryMutation,
  useDetachTagFromCategory: () => detachTagFromCategoryMutation,
  useAttachCategoryToTask: () => attachCategoryToTaskMutation,
  useDetachCategoryFromTask: () => detachCategoryFromTaskMutation,
  useSetTaskCategoryBuffer: () => setCategoryBufferMutation,
  useTaskCategoryBuffer: () => ({ data: [] }),
  useUpdateTaskCategoryColor: () => updateCategoryColorMutation,
}));

describe('Micro task taxonomy', () => {
  beforeEach(() => {
    mockTags = [
      buildTag('tag-auto', 'AutoFocus'),
      buildTag('tag-extra', 'Deep Work'),
    ];
    mockCategories = [
      buildCategory('cat-auto', 'AutoFocus', true, [mockTags[0]]),
      buildCategory('cat-manual', 'Manual Bucket', false, []),
    ];
    mockTasks = [
      buildTask('task-1', 'Первое дело', ['cat-auto']),
    ];
    mockTasksState.data = mockTasks;

    resetMutation(attachCategoryToTaskMutation);
    resetMutation(detachCategoryFromTaskMutation);
    resetMutation(setCategoryBufferMutation);
    resetMutation(createTaskTagMutation);
    resetMutation(deleteTaskTagMutation);
    resetMutation(createTaskCategoryMutation);
    resetMutation(renameTaskCategoryMutation);
    resetMutation(deleteTaskCategoryMutation);
    resetMutation(attachTagToCategoryMutation);
    resetMutation(detachTagFromCategoryMutation);
    resetMutation(createMicroTaskMutation);
    resetMutation(updateMicroTaskMutation);
    resetMutation(deleteMicroTaskMutation);
    resetMutation(toggleTimerMutation);
    resetMutation(archiveMicroTaskMutation);
    resetMutation(updateCategoryColorMutation);
    archiveMicroTaskMutation.isPending = false;
    archiveMicroTaskMutation.variables = undefined;
    reorderMicroTasksMutation.mockReset();
  });

  it('creates a tag inline and auto category request is sent', async () => {
    render(<MicroTasksWidget widgetId="widget-1" />);
    await openManager();

    const input = screen.getByPlaceholderText('Новый тег');
    fireEvent.change(input, { target: { value: 'Focus' } });
    fireEvent.submit(input.closest('form') as HTMLFormElement);

    await waitFor(() =>
      expect(createTaskTagMutation.mutateAsync).toHaveBeenCalledWith('Focus'),
    );
  });

  it('deletes a tag through the manager badge', async () => {
    render(<MicroTasksWidget widgetId="widget-1" />);
    await openManager();

    const button = screen.getByLabelText('Удалить тег AutoFocus');
    fireEvent.click(button);

    await waitFor(() =>
      expect(deleteTaskTagMutation.mutateAsync).toHaveBeenCalledWith('tag-auto'),
    );
  });

  it('creates and renames a manual category inline', async () => {
    render(<MicroTasksWidget widgetId="widget-1" />);
    await openManager();

    const categoryInput = screen.getByPlaceholderText('Новая категория');
    fireEvent.change(categoryInput, { target: { value: 'Energy' } });
    fireEvent.submit(categoryInput.closest('form') as HTMLFormElement);

    await waitFor(() =>
      expect(createTaskCategoryMutation.mutateAsync).toHaveBeenCalledWith('Energy'),
    );

    const renameButton = screen.getByLabelText('Переименовать');
    fireEvent.click(renameButton);
    const inlineInput = screen.getByDisplayValue('Manual Bucket');
    fireEvent.change(inlineInput, { target: { value: 'Focus Bucket' } });
    fireEvent.keyDown(inlineInput, { key: 'Enter' });

    await waitFor(() =>
      expect(renameTaskCategoryMutation.mutateAsync).toHaveBeenCalledWith({
        id: 'cat-manual',
        name: 'Focus Bucket',
      }),
    );
  });

  it('deletes a manual category via toolbar button', async () => {
    render(<MicroTasksWidget widgetId="widget-1" />);
    await openManager();

    const manualCard = screen.getByTestId('category-card-cat-manual');
    const deleteButton = within(manualCard).getByLabelText('Удалить категорию');
    fireEvent.click(deleteButton);

    await waitFor(() =>
      expect(deleteTaskCategoryMutation.mutateAsync).toHaveBeenCalledWith('cat-manual'),
    );
  });

  it('shows auto categories, запрещает переименование, но позволяет выбрать цвет', async () => {
    render(<MicroTasksWidget widgetId="widget-1" />);
    await openManager();

    const autoCard = screen.getByTestId('category-card-cat-auto');
    expect(autoCard).toBeInTheDocument();

    expect(
      within(autoCard).queryByLabelText('Переименовать'),
    ).not.toBeInTheDocument();
    const colorButton = within(autoCard).getByLabelText('Выбрать цвет категории');
    expect(colorButton).not.toBeDisabled();
  });

  it('attaches tags inside the category section with instant action and search', async () => {
    render(<MicroTasksWidget widgetId="widget-1" />);
    await openManager();

    const manualCard = screen.getByTestId('category-card-cat-manual');
    const select = within(manualCard).getByRole('combobox', {
      name: 'Добавить тег в категорию Manual Bucket',
    });
    fireEvent.focus(select);
    fireEvent.change(select, { target: { value: 'Deep' } });
    const option = screen.getByRole('option', { name: 'Deep Work' });
    fireEvent.click(option);

    await waitFor(() =>
      expect(attachTagToCategoryMutation.mutateAsync).toHaveBeenCalledWith({
        categoryId: 'cat-manual',
        tagId: 'tag-extra',
      }),
    );
    expect(screen.getByTestId('taxonomy-manager')).toBeInTheDocument();
  });

  it('detaches tags from manual categories', async () => {
    mockCategories = [
      buildCategory('cat-auto', 'AutoFocus', true, [mockTags[0]]),
      buildCategory('cat-manual', 'Manual Bucket', false, [mockTags[1]]),
    ];
    render(<MicroTasksWidget widgetId="widget-1" />);
    await openManager();

    const manualCard = screen.getByTestId('category-card-cat-manual');
    const removeTagButton = within(manualCard).getByLabelText('Удалить связанный тег Deep Work');
    fireEvent.click(removeTagButton);

    await waitFor(() =>
      expect(detachTagFromCategoryMutation.mutateAsync).toHaveBeenCalledWith({
        categoryId: 'cat-manual',
        tagId: 'tag-extra',
      }),
    );
  });

  it('attaches a category to task through the card popover and updates buffer', async () => {
    render(<MicroTasksWidget widgetId="widget-1" />);
    await openTaskCategoryPopover();

    const popover = screen.getByTestId('task-category-popover');
    const select = within(popover).getByRole('combobox', { name: 'Добавить категорию' });
    fireEvent.focus(select);
    fireEvent.change(select, { target: { value: 'Manual' } });
    const option = screen.getByRole('option', { name: 'Manual Bucket' });
    fireEvent.click(option);

    await waitFor(() =>
      expect(attachCategoryToTaskMutation.mutateAsync).toHaveBeenCalledWith({
        taskId: 'task-1',
        categoryId: 'cat-manual',
      }),
    );
    expect(setCategoryBufferMutation.mutateAsync).toHaveBeenCalledWith(['cat-auto', 'cat-manual']);
    expect(screen.getByTestId('task-category-popover')).toBeInTheDocument();
  });

  it('detaches a category from a task via popover badge', async () => {
    render(<MicroTasksWidget widgetId="widget-1" />);
    await openTaskCategoryPopover();

    const popover = screen.getByTestId('task-category-popover');
    const removeButton = within(popover).getByRole('button', {
      name: 'Удалить категорию AutoFocus',
    });
    fireEvent.click(removeButton);

    await waitFor(() =>
      expect(detachCategoryFromTaskMutation.mutateAsync).toHaveBeenCalledWith({
        taskId: 'task-1',
        categoryId: 'cat-auto',
      }),
    );
    expect(setCategoryBufferMutation.mutateAsync).toHaveBeenCalledWith([]);
  });
});

async function openManager() {
  const button = screen.getByLabelText('Управление тегами и категориями');
  fireEvent.click(button);
  await screen.findByTestId('taxonomy-manager');
}

async function openTaskCategoryPopover() {
  const button = screen.getByLabelText('Категории задачи');
  fireEvent.click(button);
  await screen.findByTestId('task-category-popover');
}

function resetMutation(mutation: { mutate: ReturnType<typeof vi.fn>; mutateAsync: ReturnType<typeof vi.fn> }) {
  mutation.mutate.mockReset();
  mutation.mutateAsync.mockReset();
  mutation.mutateAsync.mockResolvedValue(undefined);
}

function buildTag(id: string, name: string): TaskTag {
  return {
    id,
    name,
    user_id: 'user-1',
    created_at: new Date().toISOString(),
    updated_at: new Date().toISOString(),
  };
}

function buildCategory(
  id: string,
  name: string,
  isAuto: boolean,
  tags: TaskTag[],
): TaskCategory {
  return {
    id,
    name,
    is_auto: isAuto,
    color: null,
    user_id: 'user-1',
    created_at: new Date().toISOString(),
    updated_at: new Date().toISOString(),
    tags,
  };
}

function buildTask(id: string, title: string, categoryIds: string[]): MicroTaskRecord {
  return {
    id,
    widget_id: 'widget-1',
    user_id: 'user-1',
    title,
    is_done: false,
    order: 1,
    elapsed_seconds: 0,
    timer_state: 'never',
    last_started_at: null,
    archived_at: null,
    created_at: new Date().toISOString(),
    updated_at: new Date().toISOString(),
    categories: categoryIds.map((categoryId) =>
      mockCategories.find((category) => category.id === categoryId) ?? buildCategory(categoryId, categoryId, false, []),
    ),
  };
}
