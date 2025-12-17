import { describe, expect, it } from 'vitest';

import type { LayoutItem } from '../types';
import {
  clampGridPosition,
  sortLayoutByZ,
  GRID_COLUMNS,
  GRID_SUBDIVISIONS,
} from '../utils';

describe('layout utils', () => {
  const buildLayout = (count: number): LayoutItem[] =>
    Array.from({ length: count }, (_, idx) => ({
      widget_id: `widget-${idx}`,
      type: 'habits',
      x: 0,
      y: 0,
      w: 4,
      h: 3,
      z: idx,
    }));

  it('clampGridPosition ограничивает координаты по сетке с субделениями', () => {
    const item = buildLayout(1)[0];
    const result = clampGridPosition({ x: GRID_COLUMNS + 5.6, y: -3.2 }, item);
    expect(result).toMatchObject({
      x: GRID_COLUMNS - item.w!,
      y: 0,
    });
  });

  it('clampGridPosition привязывает координату к шагу 1/GRID_SUBDIVISIONS', () => {
    const item = buildLayout(1)[0];
    const snap = 1 / GRID_SUBDIVISIONS;
    const result = clampGridPosition({ x: snap * 1.4, y: 0 }, item);
    expect(result.x).toBeCloseTo(snap);
  });

  it('sortLayoutByZ упорядочивает элементы по z', () => {
    const layout: LayoutItem[] = [
      { ...buildLayout(1)[0], widget_id: 'b', z: 5 },
      { ...buildLayout(1)[0], widget_id: 'a', z: 1 },
      { ...buildLayout(1)[0], widget_id: 'c', z: 3 },
    ];

    const result = sortLayoutByZ(layout);
    expect(result.map((item) => item.widget_id)).toEqual(['a', 'c', 'b']);
  });

  it('GRID_COLUMNS равно 12 (ширина сетки)', () => {
    expect(GRID_COLUMNS).toBe(12);
    expect(GRID_SUBDIVISIONS).toBe(3);
  });
});

