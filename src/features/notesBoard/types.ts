export type Note = {
  id: string;
  /** Rendered HTML (allows <b>/<strong> for Ctrl+B bold). */
  html: string;
  /** Canvas-space coordinates in pixels. */
  x: number;
  y: number;
  /**
   * Optional user-set width in pixels (for line wrapping). When unset, the
   * note sizes itself to content up to an automatic cap.
   */
  width?: number;
};

export type NotesBoardConfig = {
  title?: string;
  notes?: Note[];
  /** When true, the widget renders only its header (content area collapsed). */
  collapsed?: boolean;
};

/** Minimum width the user can drag a note down to. */
export const NOTES_NOTE_MIN_WIDTH = 80;
/** Upper bound so one note can't eat the whole canvas by mistake. */
export const NOTES_NOTE_MAX_WIDTH = 600;

/** Fine grid step — matches draw.io's near-invisible snap. */
export const NOTES_GRID_STEP = 5;
/**
 * Canvas dimensions are quantised to this step. Small step = smooth small
 * growth increments; the canvas only jumps by `NOTES_CANVAS_STEP` pixels when
 * a note crosses the growth threshold (`NOTES_CANVAS_EDGE`).
 */
export const NOTES_CANVAS_STEP = 60;
/**
 * How close a note can get to the current canvas edge before growth triggers.
 * 0.9 means: as long as the note's right edge is within 90% of the canvas
 * width, no growth; cross that line and the canvas extends by one step.
 */
export const NOTES_CANVAS_EDGE = 0.9;
/** Minimum canvas dimensions, in steps. */
export const NOTES_CANVAS_MIN_STEPS = 4;
