import {
  createContext,
  useCallback,
  useContext,
  useMemo,
  useRef,
  useState,
} from 'react';
import type { GoalRecord } from '../../features/tasks/types';

type EndDragPayload = {
  goal: GoalRecord;
  pointerX: number;
  pointerY: number;
};

type CrossWidgetDragContextValue = {
  dragGoal: GoalRecord | null;
  hoveredZoneId: string | null;
  startDrag: (goal: GoalRecord, x: number, y: number) => void;
  updateDrag: (x: number, y: number) => void;
  endDrag: () => EndDragPayload | null;
  cancelDrag: () => void;
  registerDropZone: (id: string, el: HTMLElement | null) => void;
  findDropZone: (x: number, y: number) => string | null;
};

const CrossWidgetDragCtx = createContext<CrossWidgetDragContextValue | null>(null);

export function CrossWidgetDragProvider({ children }: { children: React.ReactNode }) {
  const [dragGoal, setDragGoal] = useState<GoalRecord | null>(null);
  const [hoveredZoneId, setHoveredZoneId] = useState<string | null>(null);

  const goalRef = useRef<GoalRecord | null>(null);
  const pointerRef = useRef<{ x: number; y: number }>({ x: 0, y: 0 });
  const floatingRef = useRef<HTMLDivElement | null>(null);
  const dropZonesRef = useRef(new Map<string, HTMLElement>());

  const findDropZone = useCallback((x: number, y: number): string | null => {
    for (const [id, el] of dropZonesRef.current) {
      const rect = el.getBoundingClientRect();
      if (x >= rect.left && x <= rect.right && y >= rect.top && y <= rect.bottom) {
        return id;
      }
    }
    return null;
  }, []);

  const positionFloating = useCallback((x: number, y: number) => {
    if (!floatingRef.current) return;
    floatingRef.current.style.transform = `translate(${x + 12}px, ${y - 16}px)`;
  }, []);

  const startDrag = useCallback(
    (goal: GoalRecord, x: number, y: number) => {
      goalRef.current = goal;
      pointerRef.current = { x, y };
      setDragGoal(goal);
      if (floatingRef.current) {
        floatingRef.current.style.display = 'block';
      }
      positionFloating(x, y);
      const zoneId = findDropZone(x, y);
      setHoveredZoneId(zoneId);
    },
    [findDropZone, positionFloating],
  );

  const updateDrag = useCallback(
    (x: number, y: number) => {
      if (!goalRef.current) return;
      pointerRef.current = { x, y };
      positionFloating(x, y);
      const zoneId = findDropZone(x, y);
      setHoveredZoneId((prev) => (prev === zoneId ? prev : zoneId));
    },
    [findDropZone, positionFloating],
  );

  const endDrag = useCallback((): EndDragPayload | null => {
    const goal = goalRef.current;
    const { x, y } = pointerRef.current;
    goalRef.current = null;
    setDragGoal(null);
    setHoveredZoneId(null);
    if (floatingRef.current) floatingRef.current.style.display = 'none';
    return goal ? { goal, pointerX: x, pointerY: y } : null;
  }, []);

  const cancelDrag = useCallback(() => {
    goalRef.current = null;
    setDragGoal(null);
    setHoveredZoneId(null);
    if (floatingRef.current) floatingRef.current.style.display = 'none';
  }, []);

  const registerDropZone = useCallback((id: string, el: HTMLElement | null) => {
    if (el) dropZonesRef.current.set(id, el);
    else dropZonesRef.current.delete(id);
  }, []);

  const value = useMemo<CrossWidgetDragContextValue>(
    () => ({
      dragGoal,
      hoveredZoneId,
      startDrag,
      updateDrag,
      endDrag,
      cancelDrag,
      registerDropZone,
      findDropZone,
    }),
    [dragGoal, hoveredZoneId, startDrag, updateDrag, endDrag, cancelDrag, registerDropZone, findDropZone],
  );

  return (
    <CrossWidgetDragCtx.Provider value={value}>
      {children}
      <div
        ref={floatingRef}
        aria-hidden
        style={{
          position: 'fixed',
          left: 0,
          top: 0,
          pointerEvents: 'none',
          zIndex: 9999,
          display: 'none',
          willChange: 'transform',
        }}
        className="rounded-2xl border border-white/20 bg-surface/95 px-4 py-2 text-sm text-text shadow-xl backdrop-blur"
      >
        {dragGoal?.title}
      </div>
    </CrossWidgetDragCtx.Provider>
  );
}

export function useCrossWidgetDrag() {
  const ctx = useContext(CrossWidgetDragCtx);
  if (!ctx) throw new Error('useCrossWidgetDrag must be inside CrossWidgetDragProvider');
  return ctx;
}
