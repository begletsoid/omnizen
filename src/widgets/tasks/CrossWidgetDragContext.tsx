import { createContext, useCallback, useContext, useRef, useState } from 'react';
import type { GoalRecord } from '../../features/tasks/types';

type DragPayload = {
  goal: GoalRecord;
  pointerX: number;
  pointerY: number;
};

type CrossWidgetDragContextValue = {
  dragPayload: DragPayload | null;
  startDrag: (goal: GoalRecord, x: number, y: number) => void;
  updateDrag: (x: number, y: number) => void;
  endDrag: () => DragPayload | null;
  cancelDrag: () => void;
  registerDropZone: (id: string, el: HTMLElement | null) => void;
  findDropZone: (x: number, y: number) => string | null;
};

const CrossWidgetDragCtx = createContext<CrossWidgetDragContextValue | null>(null);

export function CrossWidgetDragProvider({ children }: { children: React.ReactNode }) {
  const [dragPayload, setDragPayload] = useState<DragPayload | null>(null);
  const payloadRef = useRef<DragPayload | null>(null);
  const dropZonesRef = useRef(new Map<string, HTMLElement>());

  const startDrag = useCallback((goal: GoalRecord, x: number, y: number) => {
    const p = { goal, pointerX: x, pointerY: y };
    payloadRef.current = p;
    setDragPayload(p);
  }, []);

  const updateDrag = useCallback((x: number, y: number) => {
    if (!payloadRef.current) return;
    const p = { ...payloadRef.current, pointerX: x, pointerY: y };
    payloadRef.current = p;
    setDragPayload(p);
  }, []);

  const endDrag = useCallback((): DragPayload | null => {
    const payload = payloadRef.current;
    payloadRef.current = null;
    setDragPayload(null);
    return payload;
  }, []);

  const cancelDrag = useCallback(() => {
    payloadRef.current = null;
    setDragPayload(null);
  }, []);

  const registerDropZone = useCallback((id: string, el: HTMLElement | null) => {
    if (el) dropZonesRef.current.set(id, el);
    else dropZonesRef.current.delete(id);
  }, []);

  const findDropZone = useCallback((x: number, y: number): string | null => {
    for (const [id, el] of dropZonesRef.current) {
      const rect = el.getBoundingClientRect();
      if (x >= rect.left && x <= rect.right && y >= rect.top && y <= rect.bottom) {
        return id;
      }
    }
    return null;
  }, []);

  return (
    <CrossWidgetDragCtx.Provider value={{ dragPayload, startDrag, updateDrag, endDrag, cancelDrag, registerDropZone, findDropZone }}>
      {children}
      {dragPayload && (
        <div
          style={{
            position: 'fixed',
            left: dragPayload.pointerX + 12,
            top: dragPayload.pointerY - 16,
            pointerEvents: 'none',
            zIndex: 9999,
          }}
          className="rounded-2xl border border-white/20 bg-surface/95 px-4 py-2 text-sm text-text shadow-xl backdrop-blur"
        >
          {dragPayload.goal.title}
        </div>
      )}
    </CrossWidgetDragCtx.Provider>
  );
}

export function useCrossWidgetDrag() {
  const ctx = useContext(CrossWidgetDragCtx);
  if (!ctx) throw new Error('useCrossWidgetDrag must be inside CrossWidgetDragProvider');
  return ctx;
}
