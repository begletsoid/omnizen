import { describe, expect, it } from 'vitest';

import type { Note } from '../types';
import { NOTES_CANVAS_EDGE, NOTES_CANVAS_STEP, NOTES_GRID_STEP } from '../types';
import {
  computeCanvasBounds,
  findNotesInRect,
  rectsIntersect,
  snapToGrid,
} from '../utils';

const note = (overrides: Partial<Note> = {}): Note => ({
  id: 'n',
  html: 'hi',
  x: 0,
  y: 0,
  ...overrides,
});

describe('snapToGrid', () => {
  it('rounds to the nearest grid step', () => {
    expect(snapToGrid(0)).toBe(0);
    expect(snapToGrid(3)).toBe(5); // rounds up at .5 of step
    expect(snapToGrid(7)).toBe(5);
    expect(snapToGrid(8)).toBe(10);
    expect(snapToGrid(2.4)).toBe(0);
    expect(snapToGrid(2.5)).toBe(5);
  });

  it('matches the default step constant', () => {
    expect(snapToGrid(NOTES_GRID_STEP)).toBe(NOTES_GRID_STEP);
    expect(snapToGrid(NOTES_GRID_STEP * 2)).toBe(NOTES_GRID_STEP * 2);
  });
});

describe('rectsIntersect', () => {
  it('detects overlap', () => {
    const a = { left: 0, top: 0, right: 10, bottom: 10 };
    const b = { left: 5, top: 5, right: 15, bottom: 15 };
    expect(rectsIntersect(a, b)).toBe(true);
  });

  it('reports no overlap when rects only touch edges', () => {
    const a = { left: 0, top: 0, right: 10, bottom: 10 };
    const b = { left: 10, top: 0, right: 20, bottom: 10 };
    expect(rectsIntersect(a, b)).toBe(false);
  });

  it('reports no overlap when disjoint', () => {
    const a = { left: 0, top: 0, right: 5, bottom: 5 };
    const b = { left: 10, top: 10, right: 20, bottom: 20 };
    expect(rectsIntersect(a, b)).toBe(false);
  });
});

describe('computeCanvasBounds', () => {
  it('stays quantised to the canvas step (no pixel-by-pixel growth)', () => {
    const a = computeCanvasBounds([note({ x: 10, y: 10, html: 'x' })]);
    expect(a.width % NOTES_CANVAS_STEP).toBe(0);
    expect(a.height % NOTES_CANVAS_STEP).toBe(0);
  });

  it('only extends the canvas when a note crosses the edge threshold', () => {
    // Keep a note well inside the canvas: right edge < EDGE% of width → bounds don't change.
    const inside = computeCanvasBounds([note({ x: 10, y: 10, html: 'x' })]);
    const stillInside = computeCanvasBounds([note({ x: 30, y: 10, html: 'x' })]);
    expect(inside.width).toBe(stillInside.width);

    // Push the note so its right edge sits just past the EDGE% line — growth triggers.
    const farX = Math.floor(inside.width * NOTES_CANVAS_EDGE) + 1;
    const beyond = computeCanvasBounds([note({ x: farX, y: 10, html: 'x' })]);
    expect(beyond.width).toBeGreaterThan(inside.width);
  });

  it('grows by at least one step (and stays quantised) when crossing the threshold', () => {
    const base = computeCanvasBounds([note({ x: 0, y: 0, html: 'x' })]);
    // Step slightly past the edge triggers growth. Exact delta depends on note
    // width vs step, but it must be a whole-step multiple — never pixel-level.
    const triggerX = Math.floor(base.width * NOTES_CANVAS_EDGE) + 1;
    const grown = computeCanvasBounds([note({ x: triggerX, y: 0, html: 'x' })]);
    const delta = grown.width - base.width;
    expect(delta).toBeGreaterThanOrEqual(NOTES_CANVAS_STEP);
    expect(delta % NOTES_CANVAS_STEP).toBe(0);
  });

  it('returns the minimum canvas when there are no notes', () => {
    const bounds = computeCanvasBounds([]);
    expect(bounds.width).toBeGreaterThan(0);
    expect(bounds.width % NOTES_CANVAS_STEP).toBe(0);
  });
});

describe('findNotesInRect', () => {
  it('selects notes whose bounding box intersects the rect', () => {
    const notes = [
      note({ id: 'inside', x: 20, y: 20, html: 'a' }),
      note({ id: 'partial', x: 80, y: 80, html: 'b' }),
      note({ id: 'outside', x: 400, y: 400, html: 'c' }),
    ];
    const hit = findNotesInRect(notes, { left: 0, top: 0, right: 100, bottom: 100 });
    expect(hit.has('inside')).toBe(true);
    expect(hit.has('outside')).toBe(false);
  });

  it('returns an empty set for an empty rect', () => {
    const notes = [note({ x: 0, y: 0 })];
    const hit = findNotesInRect(notes, { left: 500, top: 500, right: 510, bottom: 510 });
    expect(hit.size).toBe(0);
  });
});
