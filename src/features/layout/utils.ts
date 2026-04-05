import type { LayoutItem } from './types';

export const GRID_COLUMNS = 12;
export const GRID_SUBDIVISIONS = 3;
export const GRID_GAP_PX = 24;
export const DEFAULT_ROW_HEIGHT_PX = 180;

export function clampGridPosition(
  candidate: { x: number; y: number },
  _item: LayoutItem,
): { x: number; y: number } {
  const snap = 1 / GRID_SUBDIVISIONS;
  const roundToSubgrid = (value: number) => Math.round(value / snap) * snap;
  return {
    x: Math.max(0, roundToSubgrid(candidate.x)),
    y: Math.max(0, roundToSubgrid(candidate.y)),
  };
}

export function sortLayoutByZ(items: LayoutItem[]): LayoutItem[] {
  return items.slice().sort((a, b) => (a.z ?? 0) - (b.z ?? 0));
}
