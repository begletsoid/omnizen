import {
  NOTES_CANVAS_EDGE,
  NOTES_CANVAS_MIN_STEPS,
  NOTES_CANVAS_STEP,
  NOTES_GRID_STEP,
  type Note,
} from './types';

export function snapToGrid(value: number, step = NOTES_GRID_STEP): number {
  return Math.round(value / step) * step;
}

/** Bounds of a note including an estimated text size (notes grow with content). */
export function estimateNoteSize(note: Note): { width: number; height: number } {
  // Text length heuristic: HTML stripped, character width ~7px, min 80, max 300.
  const text = note.html.replace(/<[^>]+>/g, '').trim();
  const est = Math.min(300, Math.max(80, text.length * 7));
  const lines = Math.max(1, Math.ceil(text.length / 40));
  return { width: est, height: 24 * lines + 12 };
}

/**
 * Compute the minimum canvas size that keeps every note within
 * `NOTES_CANVAS_EDGE` (90%) of the canvas area, then quantise up to the
 * nearest `NOTES_CANVAS_STEP` so small drags within an already-fitted note
 * don't grow the canvas pixel-by-pixel.
 *
 * Growth triggers only when a note's far edge crosses the 90% line; growth is
 * by a single `NOTES_CANVAS_STEP` at a time.
 */
export function computeCanvasBounds(notes: Note[]): { width: number; height: number } {
  let maxX = 0;
  let maxY = 0;
  for (const n of notes) {
    const size = estimateNoteSize(n);
    const right = n.x + size.width;
    const bottom = n.y + size.height;
    if (right > maxX) maxX = right;
    if (bottom > maxY) maxY = bottom;
  }
  const desiredW = maxX / NOTES_CANVAS_EDGE;
  const desiredH = maxY / NOTES_CANVAS_EDGE;
  const minSize = NOTES_CANVAS_MIN_STEPS * NOTES_CANVAS_STEP;
  const width = Math.max(minSize, Math.ceil(desiredW / NOTES_CANVAS_STEP) * NOTES_CANVAS_STEP);
  const height = Math.max(minSize, Math.ceil(desiredH / NOTES_CANVAS_STEP) * NOTES_CANVAS_STEP);
  return { width, height };
}

/** Axis-aligned bounding-box intersection test. */
export function rectsIntersect(
  a: { left: number; top: number; right: number; bottom: number },
  b: { left: number; top: number; right: number; bottom: number },
): boolean {
  return a.left < b.right && a.right > b.left && a.top < b.bottom && a.bottom > b.top;
}

/** Notes that overlap the given canvas-space rectangle. */
export function findNotesInRect(
  notes: Note[],
  rect: { left: number; top: number; right: number; bottom: number },
): Set<string> {
  const hit = new Set<string>();
  for (const n of notes) {
    const size = estimateNoteSize(n);
    const noteRect = { left: n.x, top: n.y, right: n.x + size.width, bottom: n.y + size.height };
    if (rectsIntersect(rect, noteRect)) hit.add(n.id);
  }
  return hit;
}
