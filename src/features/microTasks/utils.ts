import type {
  MicroTaskGroup,
  MicroTaskGroupOrderUpdatePayload,
  MicroTaskGroupTaskUpdatePayload,
  MicroTaskInsert,
  MicroTaskOrderUpdatePayload,
  MicroTaskRecord,
  MicroTaskTimerState,
} from './types';

export function buildMicroTaskOrderUpdates(tasks: MicroTaskRecord[]): MicroTaskOrderUpdatePayload[] {
  return tasks.map((task, index) => ({
    id: task.id,
    order: index + 1,
  }));
}

export function formatDuration(totalSeconds?: number | null): string {
  const numericValue =
    typeof totalSeconds === 'number' && Number.isFinite(totalSeconds) ? totalSeconds : 0;
  const safeSeconds = Math.max(0, Math.floor(numericValue));
  const hours = Math.floor(safeSeconds / 3600);
  const minutesValue = Math.floor((safeSeconds % 3600) / 60);
  const minutes = hours > 0 ? minutesValue.toString().padStart(2, '0') : minutesValue.toString();
  const seconds = Math.floor(safeSeconds % 60)
    .toString()
    .padStart(2, '0');
  if (hours > 0) {
    return `${hours}:${minutes}:${seconds}`;
  }
  return `${minutes}:${seconds}`;
}

export function normalizeTimerState(state: MicroTaskTimerState | null | undefined) {
  if (state === 'paused' || state === 'running' || state === 'never') {
    return state;
  }
  return 'never';
}

export function parseDurationInput(value: string): number | null {
  if (!value) return null;
  const cleaned = value.trim();
  if (!cleaned) return null;
  const parts = cleaned.split(':');
  if (parts.some((part) => part.trim() === '' || Number.isNaN(Number(part)))) {
    return null;
  }
  let seconds = 0;
  if (parts.length === 1) {
    seconds = Number(parts[0]);
  } else if (parts.length === 2) {
    seconds = Number(parts[0]) * 60 + Number(parts[1]);
  } else if (parts.length === 3) {
    seconds = Number(parts[0]) * 3600 + Number(parts[1]) * 60 + Number(parts[2]);
  } else {
    return null;
  }
  if (!Number.isFinite(seconds) || seconds < 0) return null;
  return seconds;
}

type TemplateItemInput = {
  title: string;
  category_ids: string[];
  order: number;
};export function buildTemplateTaskPayloads(params: {
  items: TemplateItemInput[];
  baseOrder: number;
  groupId: string;
}): Array<{ insert: Omit<MicroTaskInsert, 'widget_id' | 'user_id'>; categoryIds: string[] }> {
  const sorted = [...params.items].sort((a, b) => a.order - b.order);
  return sorted.map((item, index) => ({
    insert: {
      title: item.title,
      order: params.baseOrder + index,
      group_id: params.groupId,
      group_order: index + 1,
      elapsed_seconds: 0,
      timer_state: 'never',
      last_started_at: null,
      is_done: false,
    },
    categoryIds: item.category_ids,
  }));
}export function buildGroupReorderUpdates(params: {
  nextKeys: string[];
  taskById: Map<string, MicroTaskRecord>;
  groupById: Map<string, MicroTaskGroup>;
  taskGroupOverrides?: Map<string, string | null>;
}): {
  taskUpdates: MicroTaskGroupTaskUpdatePayload[];
  groupUpdates: MicroTaskGroupOrderUpdatePayload[];
} {
  const { nextKeys, taskById, groupById, taskGroupOverrides } = params;
  const groupUpdates: MicroTaskGroupOrderUpdatePayload[] = [];
  const taskUpdates: MicroTaskGroupTaskUpdatePayload[] = [];
  const groupCounters = new Map<string, number>();
  let entryOrder = 1;  const parseKey = (key: string) => {
    if (key.startsWith('group:')) {
      return { type: 'group' as const, id: key.slice('group:'.length) };
    }
    return { type: 'task' as const, id: key.slice('task:'.length) };
  };  nextKeys.forEach((key) => {
    const info = parseKey(key);
    if (info.type === 'group') {
      if (!groupById.has(info.id)) return;
      groupUpdates.push({ id: info.id, order: entryOrder });
      entryOrder += 1;
      return;
    }
    const task = taskById.get(info.id);
    if (!task) return;
    const override = taskGroupOverrides?.has(task.id) ? taskGroupOverrides.get(task.id) ?? null : undefined;
    const nextGroupId = override !== undefined ? override : task.group_id ?? null;
    if (nextGroupId) {
      const nextOrder = (groupCounters.get(nextGroupId) ?? 0) + 1;
      groupCounters.set(nextGroupId, nextOrder);
      taskUpdates.push({
        id: task.id,
        order: task.order,
        group_id: nextGroupId,
        group_order: nextOrder,
      });
      return;
    }
    taskUpdates.push({
      id: task.id,
      order: entryOrder,
      group_id: null,
      group_order: null,
    });
    entryOrder += 1;
  });  return { taskUpdates, groupUpdates };
}