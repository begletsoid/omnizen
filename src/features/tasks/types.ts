import type { TaskCategory } from '../microTasks/types';

export type GoalRecord = {
  id: string;
  widget_id: string;
  user_id: string;
  title: string;
  is_done: boolean;
  is_locked: boolean;
  is_recurring: boolean;
  value: number;
  expected_hours: number;
  sort_order: number;
  archived_at: string | null;
  created_at: string;
  updated_at: string;
  categories?: TaskCategory[];
  elapsed_seconds?: number;
};

export type GoalOrderUpdatePayload = { id: string };

export type GoalInsert = {
  title: string;
  widget_id: string;
  user_id?: string;
  is_done?: boolean;
  is_locked?: boolean;
  is_recurring?: boolean;
  value?: number;
  expected_hours?: number;
  sort_order?: number;
  archived_at?: string | null;
};

export type GoalUpdate = Partial<
  Pick<
    GoalRecord,
    | 'title'
    | 'is_done'
    | 'is_locked'
    | 'is_recurring'
    | 'value'
    | 'expected_hours'
    | 'archived_at'
  >
>;

export type RecurringGoalRecord = {
  id: string;
  widget_id: string;
  user_id: string;
  title: string;
  value: number;
  expected_hours: number;
  cron_expression: string;
  last_triggered_at: string | null;
  created_at: string;
  updated_at: string;
};

export type RecurringGoalInsert = {
  widget_id: string;
  user_id?: string;
  title: string;
  value?: number;
  expected_hours?: number;
  cron_expression: string;
};
