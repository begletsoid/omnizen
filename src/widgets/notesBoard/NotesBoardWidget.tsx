import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { nanoid } from 'nanoid';
import clsx from 'clsx';

import type { Note, NotesBoardConfig } from '../../features/notesBoard/types';
import {
  NOTES_NOTE_MAX_WIDTH,
  NOTES_NOTE_MIN_WIDTH,
} from '../../features/notesBoard/types';
import {
  computeCanvasBounds,
  findNotesInRect,
  snapToGrid,
} from '../../features/notesBoard/utils';

type NotesBoardWidgetProps = {
  widgetId: string | null;
  config?: Record<string, unknown> | null;
  onUpdateConfig?: (patch: Record<string, unknown>) => void;
};

function readNotes(config: Record<string, unknown> | null | undefined): Note[] {
  const cfg = (config ?? {}) as NotesBoardConfig;
  return cfg.notes ?? [];
}

function readCollapsed(config: Record<string, unknown> | null | undefined): boolean {
  const cfg = (config ?? {}) as NotesBoardConfig;
  return Boolean(cfg.collapsed);
}

/**
 * If a contenteditable is currently focused, commit its content by blurring.
 * The element's own onBlur handler runs synchronously (React dispatches it in
 * the same task), saving the edit before the caller mutates state that would
 * unmount it. Without this, clicking on the canvas to start a rubber-band or
 * grabbing another note would drop the text the user just typed.
 */
function commitActiveEdit() {
  const active = document.activeElement;
  if (active instanceof HTMLElement && active.isContentEditable) {
    active.blur();
  }
}

export function NotesBoardWidget({ config, onUpdateConfig }: NotesBoardWidgetProps) {
  const serverNotes = readNotes(config);
  const collapsed = readCollapsed(config);
  const [notes, setNotes] = useState<Note[]>(serverNotes);
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [editingId, setEditingId] = useState<string | null>(null);
  const sectionRef = useRef<HTMLElement>(null);

  // Sync local notes from widget.config when it changes externally (cross-device).
  const serverSignature = useMemo(() => JSON.stringify(serverNotes), [serverNotes]);
  const localSignature = useRef(serverSignature);
  useEffect(() => {
    if (serverSignature !== localSignature.current) {
      localSignature.current = serverSignature;
      // eslint-disable-next-line react-hooks/set-state-in-effect
      setNotes(serverNotes);
    }
  }, [serverSignature, serverNotes]);

  // Refs kept in sync so imperative pointer handlers always see latest values.
  const notesRef = useRef(notes);
  useEffect(() => { notesRef.current = notes; }, [notes]);
  const selectedRef = useRef(selected);
  useEffect(() => { selectedRef.current = selected; }, [selected]);

  const persist = useCallback(
    (next: Note[]) => {
      localSignature.current = JSON.stringify(next);
      onUpdateConfig?.({ notes: next });
    },
    [onUpdateConfig],
  );

  const toggleCollapsed = useCallback(() => {
    onUpdateConfig?.({ collapsed: !collapsed });
  }, [collapsed, onUpdateConfig]);

  // Clear selection when the user clicks anywhere outside the widget's section.
  useEffect(() => {
    if (selected.size === 0) return;
    const handler = (e: PointerEvent) => {
      const sec = sectionRef.current;
      if (sec && !sec.contains(e.target as Node)) {
        setSelected(new Set());
      }
    };
    window.addEventListener('pointerdown', handler);
    return () => window.removeEventListener('pointerdown', handler);
  }, [selected.size]);

  const viewportRef = useRef<HTMLDivElement>(null);
  const canvasRef = useRef<HTMLDivElement>(null);
  const bounds = useMemo(() => computeCanvasBounds(notes), [notes]);

  const clientToCanvas = useCallback((clientX: number, clientY: number) => {
    const el = canvasRef.current;
    if (!el) return { x: clientX, y: clientY };
    const rect = el.getBoundingClientRect();
    return { x: clientX - rect.left, y: clientY - rect.top };
  }, []);

  // --- Rubber-band selection, attached imperatively so nothing slips past an
  // asynchronous listener swap. Before, listeners lived in a useEffect keyed by
  // `rubber`/`isDragging`; each setRubber call tore them down and reattached,
  // and a pointerup in that gap left the rubber band stuck on screen.
  const [rubber, setRubber] = useState<{
    start: { x: number; y: number };
    current: { x: number; y: number };
  } | null>(null);

  const handleCanvasPointerDown = useCallback(
    (e: React.PointerEvent) => {
      if (e.button !== 0) return;
      if (e.target !== canvasRef.current) return;

      commitActiveEdit();

      const start = clientToCanvas(e.clientX, e.clientY);
      const initial = e.shiftKey ? new Set(selectedRef.current) : new Set<string>();
      if (!e.shiftKey) setSelected(new Set());
      setRubber({ start, current: start });

      let current = start;

      const handleMove = (ev: PointerEvent) => {
        current = clientToCanvas(ev.clientX, ev.clientY);
        setRubber({ start, current });
      };
      const handleUp = () => {
        window.removeEventListener('pointermove', handleMove);
        window.removeEventListener('pointerup', handleUp);
        window.removeEventListener('keydown', handleKey);
        const left = Math.min(start.x, current.x);
        const right = Math.max(start.x, current.x);
        const top = Math.min(start.y, current.y);
        const bottom = Math.max(start.y, current.y);
        const hit = findNotesInRect(notesRef.current, { left, right, top, bottom });
        setSelected(new Set([...initial, ...hit]));
        setRubber(null);
      };
      const handleKey = (ev: KeyboardEvent) => {
        if (ev.key === 'Escape') {
          window.removeEventListener('pointermove', handleMove);
          window.removeEventListener('pointerup', handleUp);
          window.removeEventListener('keydown', handleKey);
          setRubber(null);
        }
      };
      window.addEventListener('pointermove', handleMove);
      window.addEventListener('pointerup', handleUp);
      window.addEventListener('keydown', handleKey);
    },
    [clientToCanvas],
  );

  // --- Note drag (with group move when multiple notes are selected).
  const [dragState, setDragState] = useState<{ draggedId: string | null; hasDelta: boolean }>(
    { draggedId: null, hasDelta: false },
  );

  const beginDrag = useCallback(
    (noteId: string, clientX: number, clientY: number, shift: boolean) => {
      commitActiveEdit();

      let active = selectedRef.current;
      if (!active.has(noteId)) {
        active = shift ? new Set([...active, noteId]) : new Set([noteId]);
        setSelected(active);
      }

      // Snapshot origin positions of the notes we're going to move.
      const origins = new Map<string, { x: number; y: number }>();
      for (const n of notesRef.current) {
        if (active.has(n.id)) origins.set(n.id, { x: n.x, y: n.y });
      }

      const startClient = { x: clientX, y: clientY };
      let hasMoved = false;
      setDragState({ draggedId: noteId, hasDelta: false });

      const handleMove = (ev: PointerEvent) => {
        const dx = ev.clientX - startClient.x;
        const dy = ev.clientY - startClient.y;
        if (!hasMoved && Math.hypot(dx, dy) < 3) return;
        hasMoved = true;
        setDragState({ draggedId: noteId, hasDelta: true });
        setNotes((prev) =>
          prev.map((n) => {
            const origin = origins.get(n.id);
            if (!origin) return n;
            return {
              ...n,
              x: Math.max(0, snapToGrid(origin.x + dx)),
              y: Math.max(0, snapToGrid(origin.y + dy)),
            };
          }),
        );
      };
      const handleUp = () => {
        window.removeEventListener('pointermove', handleMove);
        window.removeEventListener('pointerup', handleUp);
        window.removeEventListener('keydown', handleKey);
        setDragState({ draggedId: null, hasDelta: false });
        if (hasMoved) {
          persist(notesRef.current);
        }
      };
      const handleKey = (ev: KeyboardEvent) => {
        if (ev.key === 'Escape') {
          window.removeEventListener('pointermove', handleMove);
          window.removeEventListener('pointerup', handleUp);
          window.removeEventListener('keydown', handleKey);
          // Roll back positions.
          setNotes((prev) =>
            prev.map((n) => {
              const origin = origins.get(n.id);
              return origin ? { ...n, x: origin.x, y: origin.y } : n;
            }),
          );
          setDragState({ draggedId: null, hasDelta: false });
        }
      };
      window.addEventListener('pointermove', handleMove);
      window.addEventListener('pointerup', handleUp);
      window.addEventListener('keydown', handleKey);
    },
    [persist],
  );

  const beginResize = useCallback(
    (noteId: string, clientX: number) => {
      commitActiveEdit();
      const origin = notesRef.current.find((n) => n.id === noteId);
      if (!origin) return;
      const startClient = clientX;
      const initialWidth = origin.width ?? 200;

      const handleMove = (ev: PointerEvent) => {
        const dx = ev.clientX - startClient;
        const next = Math.max(
          NOTES_NOTE_MIN_WIDTH,
          Math.min(NOTES_NOTE_MAX_WIDTH, snapToGrid(initialWidth + dx)),
        );
        setNotes((prev) => prev.map((n) => (n.id === noteId ? { ...n, width: next } : n)));
      };
      const handleUp = () => {
        window.removeEventListener('pointermove', handleMove);
        window.removeEventListener('pointerup', handleUp);
        persist(notesRef.current);
      };
      window.addEventListener('pointermove', handleMove);
      window.addEventListener('pointerup', handleUp);
    },
    [persist],
  );

  const addNote = useCallback(() => {
    const canvas = canvasRef.current;
    const viewport = viewportRef.current;
    let x = 24;
    let y = 24;
    if (canvas && viewport) {
      x = snapToGrid(viewport.scrollLeft + 24);
      y = snapToGrid(viewport.scrollTop + 24);
    }
    const note: Note = { id: nanoid(), html: '', x, y };
    const next = [...notes, note];
    setNotes(next);
    persist(next);
    setSelected(new Set([note.id]));
    setEditingId(note.id);
  }, [notes, persist]);

  const commitNoteText = useCallback(
    (id: string, html: string) => {
      const trimmed = html.trim();
      // Use ref so we work with the latest notes even if an outer event already
      // triggered a partial update in the same tick.
      const current = notesRef.current;
      const next = trimmed
        ? current.map((n) => (n.id === id ? { ...n, html: trimmed } : n))
        : current.filter((n) => n.id !== id);
      setNotes(next);
      persist(next);
      if (!trimmed) {
        setSelected((prev) => {
          const copy = new Set(prev);
          copy.delete(id);
          return copy;
        });
      }
    },
    [persist],
  );

  const removeSelected = useCallback(() => {
    if (selectedRef.current.size === 0) return;
    const next = notesRef.current.filter((n) => !selectedRef.current.has(n.id));
    setNotes(next);
    persist(next);
    setSelected(new Set());
  }, [persist]);

  useEffect(() => {
    const handler = (e: KeyboardEvent) => {
      if (editingId) return;
      if ((e.key === 'Delete' || e.key === 'Backspace') && selectedRef.current.size > 0) {
        const active = document.activeElement;
        if (
          active &&
          (active.tagName === 'INPUT' ||
            active.tagName === 'TEXTAREA' ||
            (active as HTMLElement).isContentEditable)
        ) {
          return;
        }
        e.preventDefault();
        removeSelected();
      }
    };
    window.addEventListener('keydown', handler);
    return () => window.removeEventListener('keydown', handler);
  }, [editingId, removeSelected]);

  return (
    <section
      ref={sectionRef}
      className={clsx(
        'flex flex-col gap-2 rounded-[2.5rem] border border-white/10 bg-background/40 px-4 py-4',
        collapsed ? 'h-auto min-h-0' : 'h-full min-h-[16rem]',
      )}
    >
      <header className="flex items-center gap-2">
        <button
          type="button"
          onClick={addNote}
          disabled={collapsed}
          className="rounded-full border border-dashed border-white/20 px-3 py-0.5 text-xs text-muted transition hover:border-white/40 hover:text-text disabled:opacity-40"
        >
          + Заметка
        </button>
        {!collapsed && selected.size > 0 && (
          <button
            type="button"
            onClick={removeSelected}
            className="rounded-full border border-white/10 px-3 py-0.5 text-xs text-muted transition hover:border-rose-400/40 hover:text-rose-300"
          >
            Удалить {selected.size}
          </button>
        )}
        {!collapsed && (
          <span className="ml-auto hidden text-[0.6rem] uppercase tracking-widest text-muted sm:inline">
            2× клик — редакт. · Ctrl+B — жирный · тяни за правый-нижний угол
          </span>
        )}
        <button
          type="button"
          onClick={toggleCollapsed}
          aria-label={collapsed ? 'Развернуть' : 'Свернуть'}
          title={collapsed ? 'Развернуть' : 'Свернуть'}
          className={clsx(
            'flex h-6 w-6 shrink-0 items-center justify-center rounded-full border border-white/20 text-muted transition hover:border-white/40 hover:text-text',
            collapsed ? '' : 'ml-auto sm:ml-0',
          )}
        >
          <svg
            xmlns="http://www.w3.org/2000/svg"
            viewBox="0 0 24 24"
            fill="none"
            stroke="currentColor"
            strokeWidth={2}
            strokeLinecap="round"
            strokeLinejoin="round"
            className={clsx('h-3 w-3 transition-transform', collapsed && '-rotate-180')}
            aria-hidden
          >
            <polyline points="18 15 12 9 6 15" />
          </svg>
        </button>
      </header>

      {!collapsed && (
        <div
          ref={viewportRef}
          className="relative flex-1 overflow-auto overscroll-contain rounded-2xl border border-white/5 bg-black/30"
        >
          <div
            ref={canvasRef}
            onPointerDown={handleCanvasPointerDown}
            className="relative cursor-default"
            style={{
              width: Math.max(bounds.width, 0),
              height: Math.max(bounds.height, 0),
              minWidth: '100%',
              minHeight: '100%',
            }}
          >
            {notes.map((note) => (
              <NoteView
                key={note.id}
                note={note}
                isSelected={selected.has(note.id)}
                isEditing={editingId === note.id}
                onPointerDown={(e) => beginDrag(note.id, e.clientX, e.clientY, e.shiftKey)}
                onStartEdit={() => setEditingId(note.id)}
                onCommit={(html) => {
                  setEditingId(null);
                  commitNoteText(note.id, html);
                }}
                onResizeStart={(e) => beginResize(note.id, e.clientX)}
              />
            ))}
            {rubber && <RubberBandRect start={rubber.start} current={rubber.current} />}
          </div>
        </div>
      )}
      {dragState.draggedId && !dragState.hasDelta && null}
    </section>
  );
}

function RubberBandRect({
  start,
  current,
}: {
  start: { x: number; y: number };
  current: { x: number; y: number };
}) {
  const left = Math.min(start.x, current.x);
  const top = Math.min(start.y, current.y);
  const width = Math.abs(current.x - start.x);
  const height = Math.abs(current.y - start.y);
  return (
    <div
      aria-hidden
      className="pointer-events-none absolute rounded-sm border border-emerald-400/60 bg-emerald-400/10"
      style={{ left, top, width, height }}
    />
  );
}

function NoteView(props: {
  note: Note;
  isSelected: boolean;
  isEditing: boolean;
  onPointerDown: (e: React.PointerEvent) => void;
  onStartEdit: () => void;
  onCommit: (html: string) => void;
  onResizeStart: (e: React.PointerEvent) => void;
}) {
  if (props.isEditing) {
    return (
      <EditableNote note={props.note} onCommit={props.onCommit} onResizeStart={props.onResizeStart} />
    );
  }
  return (
    <DisplayNote
      note={props.note}
      isSelected={props.isSelected}
      onPointerDown={props.onPointerDown}
      onStartEdit={props.onStartEdit}
      onResizeStart={props.onResizeStart}
    />
  );
}

function DisplayNote({
  note,
  isSelected,
  onPointerDown,
  onStartEdit,
  onResizeStart,
}: {
  note: Note;
  isSelected: boolean;
  onPointerDown: (e: React.PointerEvent) => void;
  onStartEdit: () => void;
  onResizeStart: (e: React.PointerEvent) => void;
}) {
  return (
    <div
      onPointerDown={onPointerDown}
      onDoubleClick={(e) => {
        e.preventDefault();
        onStartEdit();
      }}
      className={clsx(
        'group absolute cursor-move select-none rounded-lg px-2 py-1 text-center text-sm leading-tight text-white shadow-sm',
        !note.width && 'max-w-[20rem]',
        isSelected && 'ring-1 ring-white/70',
      )}
      style={{
        left: note.x,
        top: note.y,
        width: note.width ?? undefined,
        background: 'rgba(0,0,0,0.55)',
      }}
    >
      <div
        className="break-words"
        dangerouslySetInnerHTML={{ __html: note.html }}
      />
      <ResizeHandle onPointerDown={onResizeStart} visible={isSelected} />
    </div>
  );
}

function ResizeHandle({
  onPointerDown,
  visible,
}: {
  onPointerDown: (e: React.PointerEvent) => void;
  visible: boolean;
}) {
  return (
    <div
      onPointerDown={(e) => {
        e.stopPropagation();
        onPointerDown(e);
      }}
      aria-label="Изменить ширину"
      className={clsx(
        'absolute bottom-0 right-0 h-3 w-3 cursor-ew-resize rounded-br-lg transition',
        visible ? 'bg-white/15 opacity-80' : 'opacity-0 group-hover:opacity-60 group-hover:bg-white/10',
      )}
      style={{
        backgroundImage:
          'linear-gradient(135deg, transparent 40%, rgba(255,255,255,0.6) 40%, rgba(255,255,255,0.6) 55%, transparent 55%)',
      }}
    />
  );
}

function EditableNote({
  note,
  onCommit,
  onResizeStart,
}: {
  note: Note;
  onCommit: (html: string) => void;
  onResizeStart: (e: React.PointerEvent) => void;
}) {
  const ref = useRef<HTMLDivElement>(null);

  // Seed innerHTML once on mount. This component unmounts on commit, so
  // external html changes don't need to be reconciled.
  useEffect(() => {
    const el = ref.current;
    if (!el) return;
    el.innerHTML = note.html;
    el.focus();
    const range = document.createRange();
    range.selectNodeContents(el);
    range.collapse(false);
    const sel = window.getSelection();
    sel?.removeAllRanges();
    sel?.addRange(range);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const handleBlur = () => {
    if (ref.current) onCommit(ref.current.innerHTML);
  };

  const handleKeyDown = (e: React.KeyboardEvent<HTMLDivElement>) => {
    if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === 'b') {
      e.preventDefault();
      document.execCommand('bold');
    } else if (e.key === 'Escape') {
      e.preventDefault();
      e.currentTarget.blur();
    }
  };

  return (
    <div
      className={clsx(
        'group absolute cursor-text rounded-lg px-2 py-1 text-center text-sm leading-tight text-white shadow-sm ring-1 ring-emerald-400',
        !note.width && 'max-w-[20rem]',
      )}
      style={{
        left: note.x,
        top: note.y,
        width: note.width ?? undefined,
        background: 'rgba(0,0,0,0.55)',
      }}
    >
      <div
        ref={ref}
        contentEditable
        suppressContentEditableWarning
        onBlur={handleBlur}
        onKeyDown={handleKeyDown}
        className="min-w-[3rem] whitespace-pre-wrap break-words outline-none"
      />
      <ResizeHandle onPointerDown={onResizeStart} visible />
    </div>
  );
}
