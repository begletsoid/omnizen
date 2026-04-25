export type HeatmapMode = 'value' | 'time';

/** Aggregated activity for a single day within a heatmap period. */
export type HeatmapDayStats = {
  /** ISO date (YYYY-MM-DD). */
  day: string;
  /** Total points earned on this day across all completed goals. */
  points: number;
  /** Total seconds spent on goal-linked micro tasks on this day. */
  seconds: number;
};

/** Per-goal breakdown of activity on a given day (from `get_heatmap_day_details` RPC). */
export type HeatmapDayDetail = {
  goal_id: string;
  title: string;
  /** Full goal value (used as denominator: "points_today / value"). */
  value: number;
  /** Points attributed to this day for this goal (only set for completed goals). */
  points_today: number;
  /** Seconds logged on this day for micro tasks linked to this goal. */
  seconds_today: number;
  /** Seconds logged in total across history for micro tasks linked to this goal. */
  seconds_total: number;
};
