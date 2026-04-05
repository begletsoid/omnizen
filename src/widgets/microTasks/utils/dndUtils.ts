import type { MicroTaskRecord, MicroTaskGroup } from '../../../features/microTasks/types';

/* ── ID prefixes & helpers ── */

export const TASK_PREFIX = 'task:';
export const GROUP_PREFIX = 'group:';
export const GEND_PREFIX = 'gend:';

export const toTaskId = (id: string) => `${TASK_PREFIX}${id}`;
export const toGroupId = (id: string) => `${GROUP_PREFIX}${id}`;
export const toGendId = (id: string) => `${GEND_PREFIX}${id}`;

export const isTaskId = (id: string) => id.startsWith(TASK_PREFIX);
export const isGroupId = (id: string) => id.startsWith(GROUP_PREFIX);
export const isGendId = (id: string) => id.startsWith(GEND_PREFIX);

export const extractId = (prefixedId: string) => {
  if (prefixedId.startsWith(TASK_PREFIX)) return prefixedId.slice(TASK_PREFIX.length);
  if (prefixedId.startsWith(GROUP_PREFIX)) return prefixedId.slice(GROUP_PREFIX.length);
  if (prefixedId.startsWith(GEND_PREFIX)) return prefixedId.slice(GEND_PREFIX.length);
  return prefixedId;
};

/* ── Flat list builder ── */

export function buildFlatList(
  tasks: MicroTaskRecord[],
  groups: MicroTaskGroup[],
): string[] {
  const groupById = new Map(groups.map((g) => [g.id, g]));
  const groupTasksMap = new Map<string, MicroTaskRecord[]>();
  const ungroupedTasks: MicroTaskRecord[] = [];

  for (const task of tasks) {
    if (task.group_id && groupById.has(task.group_id)) {
      const list = groupTasksMap.get(task.group_id) ?? [];
      list.push(task);
      groupTasksMap.set(task.group_id, list);
    } else {
      ungroupedTasks.push(task);
    }
  }

  groupTasksMap.forEach((list) =>
    list.sort((a, b) => (a.group_order ?? a.order) - (b.group_order ?? b.order)),
  );
  ungroupedTasks.sort((a, b) => a.order - b.order);

  const sortedGroups = [...groups].sort((a, b) => a.order - b.order);

  type Entry =
    | { kind: 'group'; group: MicroTaskGroup; order: number }
    | { kind: 'task'; task: MicroTaskRecord; order: number };

  const entries: Entry[] = [
    ...sortedGroups.map((g) => ({ kind: 'group' as const, group: g, order: g.order })),
    ...ungroupedTasks.map((t) => ({ kind: 'task' as const, task: t, order: t.order })),
  ].sort((a, b) => a.order - b.order);

  const flat: string[] = [];
  for (const entry of entries) {
    if (entry.kind === 'group') {
      flat.push(toGroupId(entry.group.id));
      const gTasks = groupTasksMap.get(entry.group.id) ?? [];
      for (const t of gTasks) flat.push(toTaskId(t.id));
      flat.push(toGendId(entry.group.id));
    } else {
      flat.push(toTaskId(entry.task.id));
    }
  }

  return flat;
}

/* ── Group block helpers for drag ── */

export function getGroupBlock(flatList: string[], groupId: string): string[] {
  const headId = toGroupId(groupId);
  const endId = toGendId(groupId);
  const start = flatList.indexOf(headId);
  if (start === -1) return [];
  const finish = flatList.indexOf(endId, start);
  if (finish === -1) return flatList.slice(start);
  return flatList.slice(start, finish + 1);
}

/* ── Reorder result from flat list ── */

export type ReorderResult = {
  taskUpdates: Array<{
    id: string;
    order: number;
    group_id: string | null;
    group_order: number | null;
  }>;
  groupUpdates: Array<{ id: string; order: number }>;
};

export function computeReorderFromFlatList(flatList: string[]): ReorderResult {
  const taskUpdates: ReorderResult['taskUpdates'] = [];
  const groupUpdates: ReorderResult['groupUpdates'] = [];

  let currentGroupId: string | null = null;
  let currentGroupOrder = 0;
  let entryOrder = 1;
  let inGroupOrder = 1;

  for (const itemId of flatList) {
    if (isGroupId(itemId)) {
      currentGroupId = extractId(itemId);
      currentGroupOrder = entryOrder;
      groupUpdates.push({ id: currentGroupId, order: entryOrder });
      entryOrder++;
      inGroupOrder = 1;
    } else if (isGendId(itemId)) {
      currentGroupId = null;
    } else if (isTaskId(itemId)) {
      const taskId = extractId(itemId);
      if (currentGroupId) {
        taskUpdates.push({
          id: taskId,
          order: currentGroupOrder,
          group_id: currentGroupId,
          group_order: inGroupOrder++,
        });
      } else {
        taskUpdates.push({
          id: taskId,
          order: entryOrder,
          group_id: null,
          group_order: null,
        });
        entryOrder++;
      }
    }
  }

  return { taskUpdates, groupUpdates };
}
