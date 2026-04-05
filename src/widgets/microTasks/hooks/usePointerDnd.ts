import { useCallback, useEffect, useMemo, useRef, useState } from 'react';

import type {
  MicroTaskRecord,
  MicroTaskGroup,
} from '../../../features/microTasks/types';
import {
  buildFlatList,
  computeReorderFromFlatList,
  extractId,
  getGroupBlock,
  isGendId,
  isGroupId,
  type ReorderResult,
} from '../utils/dndUtils';

const ACTIVATION_DISTANCE = 6;

export type DropTarget = {
  id: string;
  position: 'before' | 'after';
};

export type DragState = {
  draggedId: string;
  pointerX: number;
  pointerY: number;
  dropTarget: DropTarget | null;
};

type UsePointerDndParams = {
  tasks: MicroTaskRecord[];
  groups: MicroTaskGroup[];
  onReorder: (result: ReorderResult) => void;
};

export function usePointerDnd({ tasks, groups, onReorder }: UsePointerDndParams) {
  const [dragState, setDragState] = useState<DragState | null>(null);

  const baseFlatList = useMemo(
    () => buildFlatList(tasks, groups),
    [tasks, groups],
  );

  const taskById = useMemo(
    () => new Map(tasks.map((t) => [t.id, t])),
    [tasks],
  );
  const groupById = useMemo(
    () => new Map(groups.map((g) => [g.id, g])),
    [groups],
  );

  const itemRefsMap = useRef(new Map<string, HTMLElement>());
  const pendingRef = useRef<{
    itemId: string;
    startX: number;
    startY: number;
    initialCenterY: number;
  } | null>(null);

  const registerRef = useCallback((itemId: string, el: HTMLElement | null) => {
    if (el) {
      itemRefsMap.current.set(itemId, el);
    } else {
      itemRefsMap.current.delete(itemId);
    }
  }, []);

  const findDropTarget = useCallback(
    (pointerY: number, draggedId: string): DropTarget | null => {
      const isDraggingGroup = isGroupId(draggedId);
      const draggedBlock = isDraggingGroup
        ? new Set(getGroupBlock(baseFlatList, extractId(draggedId)))
        : new Set([draggedId]);

      const items: { id: string; hitY: number }[] = [];

      let insideOtherGroup = false;
      for (const id of baseFlatList) {
        if (draggedBlock.has(id)) continue;

        if (isGroupId(id)) {
          insideOtherGroup = true;
          if (isDraggingGroup) {
            const el = itemRefsMap.current.get(id);
            if (el) {
              const rect = el.getBoundingClientRect();
              items.push({ id, hitY: rect.top + rect.height / 2 });
            }
          } else {
            const el = itemRefsMap.current.get(id);
            if (el) {
              const rect = el.getBoundingClientRect();
              items.push({ id, hitY: rect.top + rect.height / 2 });
            }
          }
          continue;
        }

        if (isGendId(id)) {
          insideOtherGroup = false;
          if (!isDraggingGroup) {
            const el = itemRefsMap.current.get(id);
            if (el) {
              const rect = el.getBoundingClientRect();
              items.push({ id, hitY: rect.top + rect.height / 2 });
            }
          }
          continue;
        }

        if (isDraggingGroup && insideOtherGroup) continue;

        const el = itemRefsMap.current.get(id);
        if (!el) continue;
        const rect = el.getBoundingClientRect();
        items.push({ id, hitY: rect.top + rect.height / 2 });
      }

      if (items.length === 0) return null;

      if (pointerY <= items[0].hitY) {
        return { id: items[0].id, position: 'before' };
      }

      if (pointerY >= items[items.length - 1].hitY) {
        return { id: items[items.length - 1].id, position: 'after' };
      }

      for (let i = 0; i < items.length - 1; i++) {
        if (pointerY >= items[i].hitY && pointerY < items[i + 1].hitY) {
          return { id: items[i + 1].id, position: 'before' };
        }
      }

      return { id: items[0].id, position: 'before' };
    },
    [baseFlatList],
  );

  useEffect(() => {
    const getEffectiveY = (pointerY: number): number => {
      const p = pendingRef.current;
      if (!p) return pointerY;
      return p.initialCenterY + (pointerY - p.startY);
    };

    const handleMove = (e: PointerEvent) => {
      const pending = pendingRef.current;

      if (pending && !dragState) {
        const dx = e.clientX - pending.startX;
        const dy = e.clientY - pending.startY;
        if (Math.sqrt(dx * dx + dy * dy) >= ACTIVATION_DISTANCE) {
          const effectiveY = getEffectiveY(e.clientY);
          const target = findDropTarget(effectiveY, pending.itemId);
          setDragState({
            draggedId: pending.itemId,
            pointerX: e.clientX,
            pointerY: e.clientY,
            dropTarget: target,
          });
        }
        return;
      }

      if (dragState) {
        const effectiveY = getEffectiveY(e.clientY);
        const target = findDropTarget(effectiveY, dragState.draggedId);
        setDragState((prev) =>
          prev
            ? { ...prev, pointerX: e.clientX, pointerY: e.clientY, dropTarget: target }
            : null,
        );
      }
    };

    const handleUp = () => {
      pendingRef.current = null;

      if (dragState?.dropTarget) {
        const { draggedId, dropTarget } = dragState;

        const movedIds = isGroupId(draggedId)
          ? getGroupBlock(baseFlatList, extractId(draggedId))
          : [draggedId];

        const movedSet = new Set(movedIds);
        const workingList = baseFlatList.filter((id) => !movedSet.has(id));

        const targetIndex = workingList.indexOf(dropTarget.id);
        if (targetIndex !== -1) {
          let insertAt: number;
          if (dropTarget.position === 'before') {
            insertAt = targetIndex;
          } else {
            insertAt = targetIndex + 1;
            if (isGroupId(dropTarget.id)) {
              const gId = extractId(dropTarget.id);
              const gendIdx = workingList.indexOf(`gend:${gId}`);
              if (gendIdx !== -1) insertAt = gendIdx + 1;
            }
          }
          workingList.splice(insertAt, 0, ...movedIds);
        }

        const result = computeReorderFromFlatList(workingList);
        onReorder(result);
      }

      setDragState(null);
    };

    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        pendingRef.current = null;
        setDragState(null);
      }
    };

    window.addEventListener('pointermove', handleMove);
    window.addEventListener('pointerup', handleUp);
    window.addEventListener('keydown', handleKeyDown);
    return () => {
      window.removeEventListener('pointermove', handleMove);
      window.removeEventListener('pointerup', handleUp);
      window.removeEventListener('keydown', handleKeyDown);
    };
  }, [dragState, baseFlatList, findDropTarget, onReorder]);

  const handlePointerDown = useCallback(
    (itemId: string, e: React.PointerEvent) => {
      if (e.button !== 0) return;
      const el = itemRefsMap.current.get(itemId);
      const rect = el?.getBoundingClientRect();
      const initialCenterY = rect ? rect.top + rect.height / 2 : e.clientY;
      pendingRef.current = { itemId, startX: e.clientX, startY: e.clientY, initialCenterY };
    },
    [],
  );

  return {
    dragState,
    flatList: baseFlatList,
    taskById,
    groupById,
    registerRef,
    handlePointerDown,
  };
}
